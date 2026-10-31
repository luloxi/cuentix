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
 * - `BANK_ACCOUNTING_SQL` covers the phrases `isBankAccountingEntry` /
 *   Fiwind tipos use: cuenta tuya, cambio de moneda, pesificación, transf
 *   deuda, compra/venta KO, amount-only tipos, RETIRO, DEPOSITO, CONVERSION,
 *   yields, and wallet TRANSFERENCIA ARS.
 *   The full JS classifier is not run per row.
 *
 * Consumos shows real spends plus internal transfers and the payment
 * exceptions in `isConsumosHiddenPayment`. Other bank-accounting lines
 * (numeric Fiwind tipos, pesificación, Retiro) stay out of the list, matching
 * `listTransactions` in src/lib/transactions.ts.
 */

/** True when the description is bank accounting (not a household spend). */
export const BANK_ACCOUNTING_SQL = `(
  upper(t.description_normalized) LIKE '%CAMBIO DE MONEDA%'
  OR upper(t.description_normalized) LIKE '%CAMBIO MONEDA%'
  OR upper(t.description_normalized) LIKE '%CUENTA TUYA%'
  OR upper(t.description_normalized) LIKE '%CUENTA PROPIA%'
  OR upper(t.description_normalized) LIKE '%ENTRE CUENTAS%'
  OR upper(t.description_normalized) LIKE '%PESIFICACION%'
  OR upper(t.description_normalized) LIKE '%PESIFICACIÓN%'
  OR upper(t.description_normalized) LIKE '%TRANSFERENCIA DEUDA%'
  OR upper(t.description_normalized) LIKE '%TRANSF%DEUDA%'
  OR upper(t.description_normalized) LIKE '%CREDITOS VS EN USD%'
  OR upper(t.description_normalized) LIKE '%CREDITO VS EN USD%'
  OR upper(t.description_normalized) LIKE '%COMPRA KO%'
  OR upper(t.description_normalized) LIKE '%VENTA KO%'
  OR upper(t.description_normalized) LIKE '%TRANSFERENCIA INMEDIATA%'
  OR upper(t.description_normalized) LIKE '%TRANSFERENCIA INTERNA%'
  OR upper(t.description_normalized) LIKE '%CUENTA A CUENTA%'
  OR upper(t.description_normalized) LIKE '%CTA A CTA%'
  OR upper(t.description_normalized) LIKE '%CR TRF%'
  OR upper(t.description_normalized) LIKE '%CR TBE%'
  OR upper(t.description_normalized) LIKE '%INM COE%'
  OR upper(t.description_normalized) LIKE '%TRANSF CREDITO%'
  OR upper(t.description_normalized) LIKE '%TRANSF. CREDITO%'
  OR upper(t.description_normalized) LIKE '%TRANSFERENCIA CREDITO%'
  OR upper(t.description_normalized) LIKE '%OPERACION DE CAMBIO%'
  OR upper(t.description_normalized) LIKE '%OPERACIONES DE CAMBIO%'
  OR upper(t.description_normalized) LIKE '%OPERACION CAMBIO%'
  OR upper(t.description_normalized) LIKE '%OPERACIONES CAMBIO%'
  OR upper(trim(t.description_normalized)) GLOB 'COMPRA ME'
  OR upper(trim(t.description_normalized)) GLOB 'COMPRA ME *'
  OR upper(trim(t.description_normalized)) GLOB '* COMPRA ME'
  OR upper(trim(t.description_normalized)) GLOB '* COMPRA ME *'
  OR upper(trim(t.description_normalized)) GLOB 'VENTA ME'
  OR upper(trim(t.description_normalized)) GLOB 'VENTA ME *'
  OR upper(trim(t.description_normalized)) GLOB '* VENTA ME'
  OR upper(trim(t.description_normalized)) GLOB '* VENTA ME *'
  OR upper(trim(t.description_normalized)) = 'RETIRO'
  OR upper(trim(t.description_normalized)) GLOB 'DEPOSITO'
  OR upper(trim(t.description_normalized)) GLOB 'DEPOSITO *'
  OR upper(trim(t.description_normalized)) GLOB 'CONVERSION*'
  OR upper(trim(t.description_normalized)) GLOB 'GANANCIA*'
  OR upper(trim(t.description_normalized)) GLOB 'RENDIMIENTO*'
  OR upper(trim(t.description_normalized)) = 'TRANSFERENCIA'
  OR (
    upper(trim(t.description_normalized)) GLOB 'TRANSFERENCIA [A-Z0-9.]*'
    AND instr(substr(upper(trim(t.description_normalized)), 15), ' ') = 0
    AND length(substr(upper(trim(t.description_normalized)), 15)) BETWEEN 2 AND 10
  )
  OR (
    (
      upper(trim(t.description_normalized)) GLOB 'COMPRA [A-Z0-9.]*'
      OR upper(trim(t.description_normalized)) GLOB 'VENTA [A-Z0-9.]*'
    )
    AND instr(substr(upper(trim(t.description_normalized)), 8), ' ') = 0
    AND length(
      substr(
        upper(trim(t.description_normalized)),
        instr(upper(trim(t.description_normalized)), ' ') + 1
      )
    ) BETWEEN 1 AND 10
    AND upper(trim(t.description_normalized)) NOT GLOB 'COMPRA SUPER*'
    AND upper(trim(t.description_normalized)) NOT GLOB 'VENTA SUPER*'
  )
  OR (
    upper(trim(t.description_normalized)) GLOB '[0-9]*'
    AND upper(trim(t.description_normalized)) NOT GLOB '*[^0-9.]*'
  )
)`;

/**
 * Internal transfers stay on the Consumos list (out of the expense total).
 * Requires the categories join (`c`).
 */
export const INTERNAL_VISIBLE_SQL = `(
  IFNULL(c.slug, '') = 'transferencia-interna'
  OR upper(t.description_normalized) LIKE '%CUENTA TUYA%'
  OR upper(t.description_normalized) LIKE '%CUENTA PROPIA%'
  OR upper(t.description_normalized) LIKE '%ENTRE CUENTAS%'
  OR upper(t.description_normalized) LIKE '%TRANSFERENCIA INMEDIATA%'
  OR upper(t.description_normalized) LIKE '%TRANSFERENCIA INTERNA%'
  OR upper(t.description_normalized) LIKE '%CUENTA A CUENTA%'
  OR upper(t.description_normalized) LIKE '%CTA A CTA%'
  OR upper(t.description_normalized) LIKE '%CR TRF%'
  OR upper(t.description_normalized) LIKE '%CR TBE%'
  OR upper(t.description_normalized) LIKE '%INM COE%'
  OR upper(t.description_normalized) LIKE '%TRANSF CREDITO%'
  OR upper(t.description_normalized) LIKE '%TRANSF. CREDITO%'
  OR upper(t.description_normalized) LIKE '%TRANSFERENCIA CREDITO%'
  OR upper(t.description_normalized) LIKE '%CAMBIO DE MONEDA%'
  OR upper(t.description_normalized) LIKE '%CAMBIO MONEDA%'
  OR upper(t.description_normalized) LIKE '%OPERACION DE CAMBIO%'
  OR upper(t.description_normalized) LIKE '%OPERACIONES DE CAMBIO%'
  OR upper(t.description_normalized) LIKE '%OPERACION CAMBIO%'
  OR upper(t.description_normalized) LIKE '%OPERACIONES CAMBIO%'
  OR upper(trim(t.description_normalized)) GLOB 'COMPRA ME'
  OR upper(trim(t.description_normalized)) GLOB 'COMPRA ME *'
  OR upper(trim(t.description_normalized)) GLOB '* COMPRA ME'
  OR upper(trim(t.description_normalized)) GLOB '* COMPRA ME *'
  OR upper(trim(t.description_normalized)) GLOB 'VENTA ME'
  OR upper(trim(t.description_normalized)) GLOB 'VENTA ME *'
  OR upper(trim(t.description_normalized)) GLOB '* VENTA ME'
  OR upper(trim(t.description_normalized)) GLOB '* VENTA ME *'
  OR upper(trim(t.description_normalized)) = 'TRANSFERENCIA'
  OR (
    upper(t.description_normalized) LIKE '%TRANSF%CLIENTE%'
    AND (
      upper(t.description_normalized) LIKE '%CTA%'
      OR upper(t.description_normalized) LIKE '%CAP%'
    )
  )
  OR (
    upper(t.description_normalized) LIKE '%BBNK%'
    AND (
      upper(t.description_normalized) LIKE '%TRANSFERENCIA%'
      OR upper(t.description_normalized) LIKE '%TRANSF %'
    )
  )
)`;

export const EXPENSE_SQL = `
  t.is_payment = 0
  AND t.is_credit = 0
  AND IFNULL(t.source, '') NOT IN ('bbva_period', 'bbva_pdf')
  AND (t.linked_transaction_id IS NULL OR t.source = 'invoice_iog')
  AND NOT ${BANK_ACCOUNTING_SQL}
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
  AND (
    ${INTERNAL_VISIBLE_SQL}
    OR NOT ${BANK_ACCOUNTING_SQL}
  )
`;
