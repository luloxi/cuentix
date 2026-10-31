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
 * Numeric-only descriptions are a documented SQL difference: legacy
 * `isBankAccountingEntry` treats every amount-only tipo as accounting, while
 * SQL counts them unless the Ockham 1:1 Fiwind echo rule drops them.
 * "Transferencia inmediata" and a bare "TRANSFERENCIA" are the other
 * difference: SQL counts them as spends. JS still treats both as internal
 * on the income side.
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
  { id: "w15", description: "Transferencia inmediata", expense: false, sqlExpense: true },
  { id: "w16", description: "TRANSFERENCIA", expense: false, sqlExpense: true },
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
  it("agrees row by row, except documented SQL differences", () => {
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
        assert.equal(isBankAccountingEntry(row.description), true, `${row.description} legacy accounting`);
        assert.equal(legacy, false, `${row.description} legacy excludes`);
        assert.equal(sqlKept, row.sqlExpense, `${row.description} sql`);
        if (row.sqlExpense) {
          assert.notEqual(sqlKept, legacy, `${row.description} sql keeps what legacy drops`);
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
    assert.equal(kept.has("w15"), true);
    assert.equal(kept.has("w16"), true);
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
    const grouped = db
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT echo.date
         FROM transactions echo
         WHERE echo.household_id = ?
           AND echo.date >= date(?, '-2 days')
           AND echo.date <= date(?, '+2 days')
           AND abs(julianday(echo.date) - julianday(?)) <= 2
           AND (
             (
               abs(CAST(IFNULL(?, '0') AS REAL)) >= 0.01
               AND abs(CAST(IFNULL(echo.amount_ars, '0') AS REAL) - CAST(IFNULL(?, '0') AS REAL)) < 0.01
             )
             OR (
               abs(CAST(IFNULL(?, '0') AS REAL)) >= 0.005
               AND abs(CAST(IFNULL(echo.amount_usd, '0') AS REAL) - CAST(IFNULL(?, '0') AS REAL)) < 0.005
             )
           )
         GROUP BY echo.date`,
      )
      .all("hh", "2026-08-18", "2026-08-18", "2026-08-18", "10", "10", "0", "0") as Array<{ detail: string }>;
    assert.match(grouped.map((row) => row.detail).join("\n"), /tx_household_date_idx/);
  });
});

type EchoRow = {
  id: string;
  description: string;
  householdId?: string;
  date?: string;
  bank?: string | null;
  amountArs?: string | null;
  amountUsd?: string | null;
  isPayment?: number;
  isCredit?: number;
  source?: string;
};

function keptExpenses(rows: EchoRow[]): Set<string> {
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
     ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
  );
  for (const row of rows) {
    insert.run(
      row.id,
      row.householdId ?? "hh",
      row.date ?? "2026-08-18",
      row.description,
      row.source ?? "bbva_import",
      row.isPayment ?? 0,
      row.isCredit ?? 0,
      row.bank ?? null,
      row.amountArs ?? null,
      row.amountUsd ?? null,
    );
  }
  const matched = db.prepare(`SELECT id FROM transactions t WHERE ${EXPENSE_SQL}`).all() as Array<{ id: string }>;
  return new Set(matched.map((row) => row.id));
}

describe("Ockham Fiwind numeric echoes", () => {
  it("drops a same-day named expense of the same amount", () => {
    const kept = keptExpenses([
      { id: "num", description: "15420.50", bank: "Fiwind", date: "2026-08-18", amountArs: "15420.50" },
      { id: "named", description: "Pago a DIA", bank: "BBVA", date: "2026-08-18", amountArs: "15420.50", source: "manual" },
    ]);
    assert.equal(kept.has("num"), false);
    assert.equal(kept.has("named"), true);
  });

  it("drops a named expense one day away and keeps one three days away", () => {
    const near = keptExpenses([
      { id: "num", description: "100.00", bank: "Fiwind", date: "2026-08-10", amountArs: "100.00" },
      { id: "named", description: "Kiosco", date: "2026-08-11", amountArs: "100.00" },
    ]);
    assert.equal(near.has("num"), false);
    assert.equal(near.has("named"), true);
    const edge = keptExpenses([
      { id: "num", description: "101.00", bank: "Fiwind", date: "2026-08-10", amountArs: "101.00" },
      { id: "named", description: "Kiosco", date: "2026-08-08", amountArs: "101.00" },
    ]);
    assert.equal(edge.has("num"), false);
    const far = keptExpenses([
      { id: "num", description: "102.00", bank: "Fiwind", date: "2026-08-10", amountArs: "102.00" },
      { id: "named", description: "Kiosco", date: "2026-08-13", amountArs: "102.00" },
    ]);
    assert.equal(far.has("num"), true);
    assert.equal(far.has("named"), true);
  });

  it("keeps the numeric row when the same amount is in another household", () => {
    const kept = keptExpenses([
      { id: "num", description: "80.00", bank: "Fiwind", date: "2026-08-18", amountArs: "80.00", householdId: "hh-a" },
      { id: "named", description: "Pago a DIA", date: "2026-08-18", amountArs: "80.00", householdId: "hh-b" },
    ]);
    assert.equal(kept.has("num"), true);
    assert.equal(kept.has("named"), true);
  });

  it("payment/credit named twin does cancel (1:1)", () => {
    const kept = keptExpenses([
      { id: "num-pay", description: "40.00", bank: "Fiwind", date: "2026-08-18", amountArs: "40.00" },
      { id: "num-pay-2", description: "40.00", bank: "Fiwind", date: "2026-08-18", amountArs: "40.00" },
      { id: "pay", description: "Alquiler", date: "2026-08-18", amountArs: "40.00", isPayment: 1 },
      { id: "num-cr", description: "41.00", bank: "Fiwind", date: "2026-08-18", amountArs: "41.00" },
      { id: "num-cr-2", description: "41.00", bank: "Fiwind", date: "2026-08-18", amountArs: "41.00" },
      { id: "cr", description: "Devolucion super", date: "2026-08-18", amountArs: "41.00", isCredit: 1 },
    ]);
    assert.equal(kept.has("num-pay"), false);
    assert.equal(kept.has("num-pay-2"), true);
    assert.equal(kept.has("pay"), false);
    assert.equal(kept.has("num-cr"), false);
    assert.equal(kept.has("num-cr-2"), true);
    assert.equal(kept.has("cr"), false);
  });

  it("pairs one named twin with one of two numeric rows, ordered by id", () => {
    const kept = keptExpenses([
      { id: "n1", description: "50.00", bank: "Fiwind", date: "2026-08-18", amountArs: "50.00" },
      { id: "n2", description: "50.00", bank: "Fiwind", date: "2026-08-18", amountArs: "50.00" },
      { id: "named", description: "Cafe", date: "2026-08-18", amountArs: "50.00" },
    ]);
    assert.equal(kept.has("n1"), false);
    assert.equal(kept.has("n2"), true);
    assert.equal(kept.has("named"), true);
    assert.equal([...kept].filter((id) => id === "n1" || id === "n2").length, 1);
  });

  it("drops both numeric rows when two named twins exist", () => {
    const kept = keptExpenses([
      { id: "n1", description: "70.00", bank: "Fiwind", date: "2026-08-18", amountArs: "70.00" },
      { id: "n2", description: "70.00", bank: "Fiwind", date: "2026-08-18", amountArs: "70.00" },
      { id: "a", description: "Uno", date: "2026-08-18", amountArs: "70.00" },
      { id: "b", description: "Dos", date: "2026-08-18", amountArs: "70.00" },
    ]);
    assert.equal(kept.has("n1"), false);
    assert.equal(kept.has("n2"), false);
    assert.equal(kept.has("a"), true);
    assert.equal(kept.has("b"), true);
  });

  it("keeps both numeric rows when no named twin exists", () => {
    const kept = keptExpenses([
      { id: "n1", description: "9.00", bank: "Fiwind", date: "2026-08-18", amountArs: "9.00" },
      { id: "n2", description: "9.00", bank: "Fiwind", date: "2026-08-18", amountArs: "9.00" },
    ]);
    assert.equal(kept.has("n1"), true);
    assert.equal(kept.has("n2"), true);
  });

  it("matches ARS within 0.01 and USD within 0.005, and ignores a wider gap", () => {
    const arsNear = keptExpenses([
      { id: "num", description: "200.00", bank: "Fiwind", date: "2026-08-18", amountArs: "200.00" },
      { id: "named", description: "Near", date: "2026-08-18", amountArs: "200.004" },
    ]);
    assert.equal(arsNear.has("num"), false);
    const arsFar = keptExpenses([
      { id: "num", description: "201.00", bank: "Fiwind", date: "2026-08-18", amountArs: "201.00" },
      { id: "named", description: "Far", date: "2026-08-18", amountArs: "201.02" },
    ]);
    assert.equal(arsFar.has("num"), true);
    const usdNear = keptExpenses([
      { id: "num", description: "8.00", bank: "Fiwind", date: "2026-08-18", amountArs: "0", amountUsd: "8.00" },
      { id: "named", description: "USD shop", bank: "BBVA", date: "2026-08-18", amountUsd: "8.004", source: "manual" },
    ]);
    assert.equal(usdNear.has("num"), false);
    assert.equal(usdNear.has("named"), true);
    const usdFar = keptExpenses([
      { id: "num", description: "8.50", bank: "Fiwind", date: "2026-08-18", amountUsd: "8.50" },
      { id: "named", description: "USD far", date: "2026-08-18", amountUsd: "8.52" },
    ]);
    assert.equal(usdFar.has("num"), true);
    const usdOnly = keptExpenses([
      { id: "num", description: "12.50", bank: "Fiwind", date: "2026-08-18", amountArs: null, amountUsd: "12.50" },
      { id: "named", description: "Spotify", date: "2026-08-18", amountArs: "999.00", amountUsd: "12.50" },
    ]);
    assert.equal(usdOnly.has("num"), false);
  });

  it("prefers a same-day named twin over an earlier numeric in the window", () => {
    const kept = keptExpenses([
      { id: "early", description: "100.00", bank: "Fiwind", date: "2026-08-01", amountArs: "100.00" },
      { id: "later", description: "100.00", bank: "Fiwind", date: "2026-08-02", amountArs: "100.00" },
      { id: "named", description: "Pago a DIA", bank: "BBVA", date: "2026-08-02", amountArs: "100.00", source: "csv_import" },
    ]);
    assert.equal(kept.has("early"), true);
    assert.equal(kept.has("later"), false);
    assert.equal(kept.has("named"), true);
  });

  it("does not treat a numeric row from another bank as a Fiwind echo", () => {
    const kept = keptExpenses([
      { id: "num", description: "60.00", bank: "BBVA", date: "2026-08-18", amountArs: "60.00" },
      { id: "named", description: "Pago a DIA", date: "2026-08-18", amountArs: "60.00" },
    ]);
    assert.equal(kept.has("num"), true);
    assert.equal(kept.has("named"), true);
  });
});

describe("consumosVisibleSql matches the legacy list filter", () => {
  it("hides bank accounting that is not an internal transfer", () => {
    const rows: Array<{
      description: string;
      visible: boolean;
      numeric?: boolean;
      isPayment?: number;
      isCredit?: number;
      slug?: string;
      source?: string;
      id?: string;
      bank?: string | null;
      date?: string;
      amountArs?: string | null;
    }> = [
      { description: "18.07", bank: "Fiwind", amountArs: "18.07", visible: true, numeric: true },
      { id: "echo-c", description: "15420.50", bank: "Fiwind", date: "2026-08-18", amountArs: "15420.50", visible: false },
      { id: "twin-c", description: "Pago a DIA", bank: "BBVA", date: "2026-08-18", amountArs: "15420.50", source: "manual", visible: true },
      { description: "TRANSF. POR PESIFICACION.", visible: false },
      { description: "CREDITOS VS EN USD-INTER-", visible: false },
      { description: "Retiro", visible: false },
      { description: "Compra KO", visible: false },
      { description: "TRANSFERENCIA ARS", visible: false },
      { description: "Transferencia inmediata", visible: true },
      { description: "TRANSFERENCIA", visible: true },
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
      `INSERT INTO transactions (
         id, household_id, date, description_normalized, source, is_payment, is_credit,
         category_id, bank, amount_ars
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const row of rows) {
      insert.run(
        row.id ?? row.description,
        "hh",
        row.date ?? "2026-08-18",
        row.description,
        row.source ?? "bbva_import",
        row.isPayment ?? 0,
        row.isCredit ?? 0,
        row.slug ?? null,
        row.bank ?? null,
        row.amountArs ?? null,
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
