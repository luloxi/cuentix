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
 * - `BANK_ACCOUNTING_SQL` keeps the phrase list (cuenta tuya, cambio de
 *   moneda, pesificación, transf deuda, compra/venta KO, COMPRA/VENTA ME,
 *   RETIRO, DEPOSITO, CONVERSION, yields, bare TRANSFERENCIA).
 *   Wallet rows are only the exact codes TRANSFERENCIA ARS|USD|USDC|USDT.
 *   COMPRA/VENTA of a single wallet code are only USD, USDC, USDT, USDB, ME
 *   (KO stays on the existing LIKE). COMPRA SUPER, COMPRA MERCADOLIBRE and
 *   TRANSFERENCIA A <persona> stay spends.
 *   A numeric-only description (digits and dots) is accounting only as a
 *   Fiwind echo: bank = 'Fiwind' and another non-numeric row in the same
 *   household within 2 days (`julianday`) shares the ARS amount (abs diff
 *   < 0.01) or the USD amount (abs diff < 0.005). The amount compared has to
 *   be non-zero so two empty amounts do not count as an echo. Unpaired
 *   numeric rows stay counted. JS `isBankAccountingEntry` still treats every
 *   amount-only tipo as accounting; that difference is intentional.
 *   The echo lookup filters `echo.household_id` plus a sargable date window,
 *   which uses `tx_household_date_idx` from migration 0001. No extra index.
 *
 * Consumos shows real spends plus internal transfers and the payment
 * exceptions in `isConsumosHiddenPayment`. Other bank-accounting lines
 * (paired numeric Fiwind echos, pesificación, Retiro) stay out of the list.
 * Unpaired numeric descriptions stay visible, unlike the legacy JS filter.
 */

/** Digits and dots only, so "59900" and "449536.14" match and "Pago a DIA" does not. */
function numericDescriptionSql(alias: string): string {
  return `(
    upper(trim(${alias}.description_normalized)) GLOB '[0-9]*'
    AND upper(trim(${alias}.description_normalized)) NOT GLOB '*[^0-9.]*'
  )`;
}

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
  OR upper(trim(t.description_normalized)) IN (
    'TRANSFERENCIA ARS',
    'TRANSFERENCIA USD',
    'TRANSFERENCIA USDC',
    'TRANSFERENCIA USDT'
  )
  OR upper(trim(t.description_normalized)) IN (
    'COMPRA USD', 'COMPRA USDC', 'COMPRA USDT', 'COMPRA USDB',
    'VENTA USD', 'VENTA USDC', 'VENTA USDT', 'VENTA USDB'
  )
  OR (
    t.bank = 'Fiwind'
    AND ${numericDescriptionSql("t")}
    AND EXISTS (
      SELECT 1 FROM transactions echo
      WHERE echo.household_id = t.household_id
        AND echo.id <> t.id
        AND echo.date >= date(t.date, '-2 days')
        AND echo.date <= date(t.date, '+2 days')
        AND abs(julianday(echo.date) - julianday(t.date)) <= 2
        AND NOT ${numericDescriptionSql("echo")}
        AND (
          (
            abs(CAST(IFNULL(t.amount_ars, '0') AS REAL)) >= 0.01
            AND abs(
              CAST(IFNULL(echo.amount_ars, '0') AS REAL)
              - CAST(IFNULL(t.amount_ars, '0') AS REAL)
            ) < 0.01
          )
          OR (
            abs(CAST(IFNULL(t.amount_usd, '0') AS REAL)) >= 0.005
            AND abs(
              CAST(IFNULL(echo.amount_usd, '0') AS REAL)
              - CAST(IFNULL(t.amount_usd, '0') AS REAL)
            ) < 0.005
          )
        )
    )
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

/**
 * Linked card statement (`cs`) is closed history. Callers join
 * `card_statements cs ON cs.id = t.statement_id`.
 * `worker/finance.ts` on the patrimonio branch should select debt rows
 * through `DEBT_ROWS_SQL` so `statementClosed` is not left unset.
 */
export const CLOSED_STATEMENT_SQL = `IFNULL(cs.status, '') = 'closed'`;

/** One user's transactions, with `statement_closed` from `card_statements.status`. */
export const DEBT_ROWS_SQL = `
SELECT
  t.id AS id,
  t.date AS date,
  t.description_normalized AS description_normalized,
  t.amount_ars AS amount_ars,
  t.amount_usd AS amount_usd,
  t.installment AS installment,
  t.is_payment AS is_payment,
  t.is_credit AS is_credit,
  t.ownership AS ownership,
  t.paid_by_user_id AS paid_by_user_id,
  t.source AS source,
  t.bank AS bank,
  t.card_last4 AS card_last4,
  t.statement_id AS statement_id,
  CASE WHEN ${CLOSED_STATEMENT_SQL} THEN 1 ELSE 0 END AS statement_closed
FROM transactions t
LEFT JOIN card_statements cs ON cs.id = t.statement_id
INNER JOIN household_members m ON m.household_id = t.household_id
WHERE m.user_id = ?
`;

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
