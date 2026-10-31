import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { isBankAccountingEntry, isInternalTransferDescription } from "../bbva/bank-entries";
import { isPeriodDebtSource } from "../import/source";
import { isConsumosHiddenPayment } from "../reintegro-hogar";
import { isExpenseRow } from "./monthly-expenses";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { consumosVisibleSql, EXPENSE_SQL } from "../../../worker/sql";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

/**
 * The lite dashboard classifies in SQL. These rows are the phrases that
 * disagreed with `isExpenseRow` on a production backup (wallet transfers,
 * retiros) plus spends that must stay.
 *
 * Numeric-only descriptions are the documented SQL difference: legacy
 * `isBankAccountingEntry` treats every amount-only tipo as accounting, while
 * SQL counts them unless a Fiwind echo twin exists within 2 days.
 */
const ROWS: Array<{
  id: string;
  description: string;
  source?: string;
  isPayment?: number;
  isCredit?: number;
  linked?: string | null;
  bank?: string | null;
  date?: string;
  amountArs?: string | null;
  householdId?: string;
  expense: boolean;
  /** When set, SQL is allowed to disagree with `isExpenseRow`. */
  sqlExpense?: boolean;
}> = [
  { id: "n1", description: "391048.03", bank: "Fiwind", date: "2026-08-01", amountArs: "391048.03", expense: false, sqlExpense: true },
  { id: "n2", description: "18.07", bank: "Fiwind", date: "2026-08-02", amountArs: "18.07", expense: false, sqlExpense: true },
  { id: "n3", description: "16000", bank: "Fiwind", date: "2026-08-03", amountArs: "16000.00", expense: false, sqlExpense: true },
  { id: "echo", description: "15420.50", bank: "Fiwind", date: "2026-08-18", amountArs: "15420.50", expense: false, sqlExpense: false },
  { id: "twin", description: "Pago a DIA", bank: "Fiwind", date: "2026-08-18", amountArs: "15420.50", expense: true },
  { id: "far", description: "59900", bank: "Fiwind", date: "2026-08-10", amountArs: "59900.00", expense: false, sqlExpense: true },
  { id: "w1", description: "TRANSFERENCIA ARS", expense: false },
  { id: "w2", description: "TRANSFERENCIA USDC", expense: false },
  { id: "w3", description: "Retiro", expense: false },
  { id: "w4", description: "Compra KO", expense: false },
  { id: "w5", description: "Venta KO", expense: false },
  { id: "w6", description: "Compra USDC", expense: false },
  { id: "w7", description: "Deposito salario", expense: false },
  { id: "w8", description: "Conversion USDC ARS", expense: false },
  { id: "w9", description: "Rendimiento diario", expense: false },
  { id: "w10", description: "Ganancia KO", expense: false },
  { id: "w11", description: "De una cuenta tuya", expense: false },
  { id: "w12", description: "TRANSF. POR PESIFICACION.", expense: false },
  { id: "w13", description: "CREDITOS VS EN USD-INTER-", expense: false },
  { id: "w14", description: "CR TBE INM COE", expense: false },
  { id: "w15", description: "Transferencia inmediata", expense: false },
  { id: "s1", description: "COMPRA SUPER ARS", expense: true },
  { id: "s2", description: "Pago a DIA", date: "2026-08-04", amountArs: "10.00", expense: true },
  { id: "s3", description: "TRANSFERENCIA A JUAN", expense: true },
  { id: "s4", description: "MERPAGO*TEMBICI", expense: true },
  { id: "s5", description: "TRANSF CREDITO Nro:215857", expense: false },
  { id: "s6", description: "COMPRA MERCADOLIBRE", expense: true },
  { id: "s7", description: "Retiro a Ana", expense: true },
  { id: "s8", description: "SU PAGO EN PESOS", isPayment: 1, expense: false },
  { id: "s9", description: "Resumen", source: "bbva_pdf", expense: false },
  { id: "s10", description: "Luz hogar", linked: "other", source: "csv_import", expense: false },
  { id: "s11", description: "Uber", linked: "x", source: "invoice_iog", expense: true },
];

function expected(row: (typeof ROWS)[number]): boolean {
  return isExpenseRow({
    isPayment: Boolean(row.isPayment),
    isCredit: Boolean(row.isCredit),
    descriptionNormalized: row.description,
    source: row.source ?? "bbva_import",
    linkedTransactionId: row.linked ?? null,
  });
}

describe("EXPENSE_SQL matches isExpenseRow on the phrases that drifted", () => {
  it("agrees row by row, except unpaired numeric tipos", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE transactions (
        id text,
        household_id text,
        date text,
        description_normalized text,
        source text,
        is_payment integer,
        is_credit integer,
        linked_transaction_id text,
        bank text,
        amount_ars text,
        amount_usd text
      );
    `);
    const insert = db.prepare(
      `INSERT INTO transactions (
         id, household_id, date, description_normalized, source, is_payment, is_credit,
         linked_transaction_id, bank, amount_ars, amount_usd
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const row of ROWS) {
      insert.run(
        row.id,
        row.householdId ?? "hh",
        row.date ?? "2026-08-18",
        row.description,
        row.source ?? "bbva_import",
        row.isPayment ?? 0,
        row.isCredit ?? 0,
        row.linked ?? null,
        row.bank ?? null,
        row.amountArs ?? null,
        null,
      );
    }
    const matched = db
      .prepare(
        `SELECT id FROM transactions t WHERE ${EXPENSE_SQL}`,
      )
      .all() as Array<{ id: string }>;
    const kept = new Set(matched.map((row) => row.id));
    for (const row of ROWS) {
      const legacy = expected(row);
      assert.equal(legacy, row.expense, `${row.description} fixture`);
      const sqlKept = kept.has(row.id);
      if (row.sqlExpense != null) {
        assert.equal(isBankAccountingEntry(row.description), true, `${row.description} legacy numeric`);
        assert.equal(legacy, false, `${row.description} legacy excludes amount-only`);
        assert.equal(sqlKept, row.sqlExpense, `${row.description} sql`);
        if (row.sqlExpense) {
          assert.notEqual(sqlKept, legacy, `${row.description} sql keeps unpaired numeric`);
        }
      } else {
        assert.equal(sqlKept, legacy, row.description);
      }
    }
    assert.equal(kept.has("echo"), false);
    assert.equal(kept.has("twin"), true);
    assert.equal(kept.has("s1"), true);
    assert.equal(kept.has("w4"), false);
    assert.equal(kept.has("w1"), false);
    assert.equal(kept.has("s3"), true);
  });

  it("uses tx_household_date_idx for the echo lookup", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = OFF");
    for (const file of ["0001_app.sql", "0002_auth.sql", "0003_serpix_sync.sql", "0004_card_closed.sql"]) {
      db.exec(readFileSync(join(root, "migrations", file), "utf8"));
    }
    const plan = db
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT 1 FROM transactions echo
         WHERE echo.household_id = ?
           AND echo.id <> ?
           AND echo.date >= date(?, '-2 days')
           AND echo.date <= date(?, '+2 days')
           AND abs(julianday(echo.date) - julianday(?)) <= 2`,
      )
      .all("hh", "t1", "2026-08-18", "2026-08-18", "2026-08-18") as Array<{ detail: string }>;
    assert.match(plan.map((row) => row.detail).join("\n"), /tx_household_date_idx/);
  });
});

describe("consumosVisibleSql matches the legacy list filter", () => {
  it("hides bank accounting that is not an internal transfer", () => {
    const rows = [
      { description: "18.07", visible: true, numeric: true },
      { description: "TRANSF. POR PESIFICACION.", visible: false },
      { description: "CREDITOS VS EN USD-INTER-", visible: false },
      { description: "Retiro", visible: false },
      { description: "Compra KO", visible: false },
      { description: "TRANSFERENCIA ARS", visible: false },
      { description: "COMPRA SUPER ARS", visible: true },
      { description: "TRANSFERENCIA A JUAN", visible: true },
      { description: "MERPAGO*TEMBICI", visible: true },
      { description: "CR TBE INM COE", visible: true },
      { description: "De una cuenta tuya", isPayment: 1, visible: true },
      { description: "SU PAGO EN PESOS", isPayment: 1, visible: false },
      { description: "Luz hogar", isPayment: 1, slug: "luz", visible: true },
      { description: "Resumen", source: "bbva_pdf", visible: false },
      { description: "Devolución de MERPAGO*TEMBICI", isCredit: 1, visible: false },
      { description: "COMPRA MERCADOLIBRE", visible: true },
    ];
    const db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE categories (id text, slug text);
      CREATE TABLE transactions (
        id text,
        household_id text,
        date text,
        description_normalized text,
        source text,
        is_payment integer,
        is_credit integer,
        category_id text,
        bank text,
        amount_ars text,
        amount_usd text,
        linked_transaction_id text
      );
      INSERT INTO categories (id, slug) VALUES ('luz', 'luz');
    `);
    const insert = db.prepare(
      `INSERT INTO transactions (description_normalized, source, is_payment, is_credit, category_id)
       VALUES (?, ?, ?, ?, ?)`,
    );
    for (const row of rows) {
      insert.run(
        row.description,
        row.source ?? "bbva_import",
        row.isPayment ?? 0,
        row.isCredit ?? 0,
        row.slug ?? null,
      );
      const slug = row.slug ?? null;
      const legacy =
        !isConsumosHiddenPayment(Boolean(row.isPayment), row.description, slug) &&
        !(
          row.isCredit &&
          slug !== "transferencia-interna" &&
          !isInternalTransferDescription(row.description)
        ) &&
        !(
          isBankAccountingEntry(row.description) &&
          slug !== "transferencia-interna" &&
          !isInternalTransferDescription(row.description)
        ) &&
        !isPeriodDebtSource(row.source ?? "bbva_import");
      if (row.numeric) {
        assert.equal(legacy, false, `${row.description} legacy still hides amount-only`);
        assert.equal(row.visible, true, `${row.description} sql keeps unpaired numeric visible`);
      } else {
        assert.equal(legacy, row.visible, `${row.description} legacy`);
      }
    }
    const matched = db
      .prepare(
        `SELECT t.description_normalized AS description
         FROM transactions t
         LEFT JOIN categories c ON c.id = t.category_id
         WHERE ${consumosVisibleSql()}`,
      )
      .all() as Array<{ description: string }>;
    const kept = new Set(matched.map((row) => row.description));
    for (const row of rows) {
      assert.equal(kept.has(row.description), row.visible, row.description);
    }
  });
});
