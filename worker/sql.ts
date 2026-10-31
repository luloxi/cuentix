/**
 * Money columns are TEXT decimals. Aggregates use CAST(x AS REAL), which is
 * an IEEE approximation good enough for dashboard display. Exact row amounts
 * stay strings until the client calls Number() on a single value.
 *
 * Dashboard expense rows approximate `isExpenseRow` in SQL so we never pull
 * the household into JS:
 * - not a payment, not a credit
 * - not a period-xls / resumen-pdf source (bbva_period, bbva_pdf)
 * - Casita rows linked to Invoice IOG are excluded; invoice_iog itself counts
 * - a fixed LIKE list covers the common bank-accounting phrases
 *   (cuenta tuya, cambio de moneda, pesificación, transf deuda, compra/venta KO).
 *   The full JS classifier (`isBankAccountingEntry`) is not run per row.
 *
 * Consumos visibility approximates `isConsumosHiddenPayment`: card payments
 * stay hidden unless the category is transferencia-interna / a hogar utility,
 * or the description matches the reintegro and internal-transfer phrases.
 */

export const EXPENSE_SQL = `
  t.is_payment = 0
  AND t.is_credit = 0
  AND IFNULL(t.source, '') NOT IN ('bbva_period', 'bbva_pdf')
  AND (t.linked_transaction_id IS NULL OR t.source = 'invoice_iog')
  AND upper(t.description_normalized) NOT LIKE '%CAMBIO DE MONEDA%'
  AND upper(t.description_normalized) NOT LIKE '%CAMBIO MONEDA%'
  AND upper(t.description_normalized) NOT LIKE '%CUENTA TUYA%'
  AND upper(t.description_normalized) NOT LIKE '%CUENTA PROPIA%'
  AND upper(t.description_normalized) NOT LIKE '%ENTRE CUENTAS%'
  AND upper(t.description_normalized) NOT LIKE '%PESIFICACION%'
  AND upper(t.description_normalized) NOT LIKE '%PESIFICACIÓN%'
  AND upper(t.description_normalized) NOT LIKE '%TRANSFERENCIA DEUDA%'
  AND upper(t.description_normalized) NOT LIKE '%TRANSF%DEUDA%'
  AND upper(t.description_normalized) NOT LIKE '%CREDITOS VS EN USD%'
  AND upper(t.description_normalized) NOT LIKE '%CREDITO VS EN USD%'
  AND upper(t.description_normalized) NOT LIKE '%COMPRA KO%'
  AND upper(t.description_normalized) NOT LIKE '%VENTA KO%'
`;

export const ARS_EXPR = `
  CASE
    WHEN ABS(CAST(IFNULL(t.amount_usd, '0') AS REAL)) > 0
     AND ABS(CAST(IFNULL(t.amount_ars, '0') AS REAL)) > 0
    THEN 0
    ELSE ABS(CAST(IFNULL(t.amount_ars, '0') AS REAL))
  END
`;

export const USD_EXPR = `ABS(CAST(IFNULL(t.amount_usd, '0') AS REAL))`;

/** Rows Consumos is allowed to show (payments only when they are special tipos). */
/** Roommate payee SQL (names come from the REINTEGRO_PAYEES config, never from the repo). */
export function reintegroPayeeSql(raw: string | undefined): string {
  const groups = String(raw ?? "")
    .toUpperCase()
    .split(",")
    .map((g) => g.split("+").map((t) => t.replace(/[^A-Z0-9]/g, "")).filter(Boolean))
    .filter((g) => g.length > 0);
  return groups
    .map(
      (g) =>
        `    OR (${g
          .map((t) => `upper(t.description_normalized) LIKE '%${t}%'`)
          .join(" AND ")})`,
    )
    .join("\n");
}

export function consumosVisibleSql(reintegroPayees?: string): string {
  return CONSUMOS_VISIBLE_SQL.replace("/*REINTEGRO_PAYEES*/", reintegroPayeeSql(reintegroPayees));
}

const CONSUMOS_VISIBLE_SQL = `
  (
    t.is_payment = 0
    OR IFNULL(c.slug, '') = 'transferencia-interna'
    OR IFNULL(c.slug, '') IN ('alquiler', 'luz', 'agua', 'gas', 'internet', 'expensas')
    /*REINTEGRO_PAYEES*/
    OR upper(t.description_normalized) LIKE '%CUENTA TUYA%'
    OR upper(t.description_normalized) LIKE '%CUENTA PROPIA%'
    OR upper(t.description_normalized) LIKE '%CR TBE%'
    OR upper(t.description_normalized) LIKE '%CR TRF%'
    OR upper(t.description_normalized) LIKE '%INM COE%'
  )
  AND (
    t.is_credit = 0
    OR IFNULL(c.slug, '') = 'transferencia-interna'
    OR upper(t.description_normalized) LIKE '%CUENTA TUYA%'
    OR upper(t.description_normalized) LIKE '%CR TBE%'
    OR upper(t.description_normalized) LIKE '%CR TRF%'
    OR upper(t.description_normalized) LIKE '%INM COE%'
  )
  AND IFNULL(t.source, '') NOT IN ('bbva_period', 'bbva_pdf')
`;
