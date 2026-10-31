import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { isBankAccountingEntry, isInternalTransferDescription } from "../bbva/bank-entries";
import { isPeriodDebtSource } from "../import/source";
import { isConsumosHiddenPayment } from "../reintegro-hogar";
import { isExpenseRow } from "./monthly-expenses";
import { consumosVisibleSql, EXPENSE_SQL } from "../../../worker/sql";

/**
 * The lite dashboard classifies in SQL. These rows are the phrases that
 * disagreed with `isExpenseRow` on a production backup (Fiwind amount-only
 * tipos, wallet transfers, retiros) plus spends that must stay.
 */
const ROWS: Array<{
  description: string;
  source?: string;
  isPayment?: number;
  isCredit?: number;
  linked?: string | null;
  expense: boolean;
}> = [
  { description: "391048.03", expense: false },
  { description: "18.07", expense: false },
  { description: "16000", expense: false },
  { description: "TRANSFERENCIA ARS", expense: false },
  { description: "TRANSFERENCIA USDC", expense: false },
  { description: "Retiro", expense: false },
  { description: "Compra KO", expense: false },
  { description: "Venta KO", expense: false },
  { description: "Compra USDC", expense: false },
  { description: "Deposito salario", expense: false },
  { description: "Conversion USDC ARS", expense: false },
  { description: "Rendimiento diario", expense: false },
  { description: "Ganancia KO", expense: false },
  { description: "De una cuenta tuya", expense: false },
  { description: "TRANSF. POR PESIFICACION.", expense: false },
  { description: "CREDITOS VS EN USD-INTER-", expense: false },
  { description: "CR TBE INM COE", expense: false },
  { description: "Transferencia inmediata", expense: false },
  { description: "COMPRA SUPER ARS", expense: true },
  { description: "Pago a DIA", expense: true },
  { description: "TRANSFERENCIA A JUAN", expense: true },
  { description: "MERPAGO*TEMBICI", expense: true },
  { description: "TRANSF CREDITO Nro:215857", expense: false },
  { description: "COMPRA MERCADOLIBRE", expense: true },
  { description: "Retiro a Ana", expense: true },
  { description: "SU PAGO EN PESOS", isPayment: 1, expense: false },
  { description: "Resumen", source: "bbva_pdf", expense: false },
  { description: "Luz hogar", linked: "other", source: "csv_import", expense: false },
  { description: "Uber", linked: "x", source: "invoice_iog", expense: true },
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
  it("agrees row by row", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE transactions (
        description_normalized text,
        source text,
        is_payment integer,
        is_credit integer,
        linked_transaction_id text
      );
    `);
    const insert = db.prepare(
      `INSERT INTO transactions (description_normalized, source, is_payment, is_credit, linked_transaction_id)
       VALUES (?, ?, ?, ?, ?)`,
    );
    for (const row of ROWS) {
      insert.run(
        row.description,
        row.source ?? "bbva_import",
        row.isPayment ?? 0,
        row.isCredit ?? 0,
        row.linked ?? null,
      );
    }
    const matched = db
      .prepare(
        `SELECT description_normalized AS description FROM transactions t WHERE ${EXPENSE_SQL}`,
      )
      .all() as Array<{ description: string }>;
    const kept = new Set(matched.map((row) => row.description));
    for (const row of ROWS) {
      const want = expected(row);
      assert.equal(want, row.expense, `${row.description} fixture`);
      assert.equal(kept.has(row.description), want, row.description);
    }
  });
});

describe("consumosVisibleSql matches the legacy list filter", () => {
  it("hides bank accounting that is not an internal transfer", () => {
    const rows = [
      { description: "18.07", visible: false },
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
        description_normalized text,
        source text,
        is_payment integer,
        is_credit integer,
        category_id text
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
      assert.equal(legacy, row.visible, `${row.description} legacy`);
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
