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
 *   RETIRO, DEPOSITO, CONVERSION, yields).
 *   Wallet rows are only the exact codes TRANSFERENCIA ARS|USD|USDC|USDT.
 *   COMPRA/VENTA of a single wallet code are only USD, USDC, USDT, USDB, ME
 *   (KO stays on the existing LIKE). COMPRA SUPER, COMPRA MERCADOLIBRE and
 *   TRANSFERENCIA A <persona> stay spends.
 *   "Transferencia inmediata" and a bare "TRANSFERENCIA" stay spends too.
 *   They are not an own-account pattern here. Income-side JS
 *   (`isOwnAccountTransferDescription`) still treats both as internal so
 *   they stay out of Ingresos. That split is intentional.
 *   A numeric-only description (digits and dots) is accounting only as a
 *   Fiwind echo under the Ockham rule below. Unpaired numeric rows stay
 *   counted. JS `isBankAccountingEntry` still treats every amount-only tipo
 *   as accounting; that difference is intentional.
 *
 * Ockham rule: a Fiwind row t whose description is only digits and dots is
 * a duplicate when a named twin of the same amount takes its slot.
 * A named twin is any other non-numeric row: a different id, any bank or
 * source, expense or not (a payment or a credit counts), and a description
 * that is not numeric-only. Another household counts only on the same
 * calendar day. The twin does not have to pass the phrase list; this
 * expression does not call itself. Amounts match when |ARS| differs by
 * less than 0.01 and t's ARS absolute value is at least 0.01, or |USD|
 * differs by less than 0.005 and t's USD absolute value is at least 0.005.
 * Two empty amounts do not match.
 * Pairing is 1:1, in two passes. Pass 1 is unchanged and stays inside t's
 * household. Same calendar day first: that day's Fiwind numeric rows of
 * this amount are ordered by id, and t is dropped when the number with a
 * smaller id is less than the number of named twins that day. Otherwise t
 * is residual. Inside t's ±2 day window (sargable `date` range on
 * `tx_household_date_idx`, plus `julianday` <= 2, which already includes
 * the same day), leftover named twins on a day are max(0, named − numeric)
 * and leftover numerics are the ones not taken that day. Residuals are
 * ordered by (date, id). t is dropped when the number of residual numerics
 * strictly before it is less than the leftover named twins in the window.
 * Pass 2 runs only when pass 1 kept t (second WHEN of a searched CASE).
 * It looks only at t.date. Each other household contributes
 * max(0, named − Fiwind numeric) of this amount that day. A named row
 * already taken by a same-day numeric in its own household adds nothing.
 * Payment and credit named rows count. Other households are enumerated
 * with `household_id IN (SELECT id FROM households WHERE id <> t.household_id)`
 * so each lookup is an equality search on `tx_household_date_idx`
 * (`household_id`, `date`), never a scan of transactions by date alone.
 * Fiwind numeric rows of this amount on t.date in every household
 * (`household_id IN (SELECT id FROM households)`) that survived pass 1
 * compete for that leftover total, ordered by id. t is dropped when the
 * number with a smaller id is less than the total. A numeric row that
 * pass 1 drops never reaches pass 2, so it consumes no cross-household leftover.
 * Supply is the same-day leftover only: pass 2 does not subtract
 * a leftover that pass 1's ±2 window also claims, so one named row can
 * cancel one same-household residual and one cross-household numeric.
 * Two numeric rows and no named twin both count. The twin is any named
 * row, expense or not. The Fiwind row itself is only ever dropped, never
 * double counted: this rule does not remove the twin or count t twice.
 * The ±2 day pass is greedy and approximate: each numeric row uses its own
 * window, so one leftover named twin near the edge can cancel two residuals
 * whose windows both contain it and do not contain each other. Pass 1 runs
 * only after `bank = 'Fiwind'` and the numeric-description check, so other
 * rows short-circuit.
 *
 * Consumos shows real spends plus internal transfers and the payment
 * exceptions in `isConsumosHiddenPayment`. Other bank-accounting lines
 * (paired numeric Fiwind echos, pesificación, Retiro) stay out of the list.
 * Unpaired numeric descriptions stay visible, unlike the legacy JS filter.
 * "Transferencia inmediata" and bare "TRANSFERENCIA" are spends, so they
 * stay on the list.
 */

/** Digits and dots only, so "59900" and "449536.14" match and "Pago a DIA" does not. */
function numericDescriptionSql(alias: string): string {
  // IFNULL so a null description is false, not NULL, and AND can short-circuit.
  return `(
    upper(trim(IFNULL(${alias}.description_normalized, ''))) GLOB '[0-9]*'
    AND upper(trim(IFNULL(${alias}.description_normalized, ''))) NOT GLOB '*[^0-9.]*'
  )`;
}

/** Same non-zero ARS (< 0.01) or USD (< 0.005) amount as `a`. Empty does not match. */
function amountCloseSql(a: string, b: string): string {
  return `(
    (
      abs(CAST(IFNULL(${a}.amount_ars, '0') AS REAL)) >= 0.01
      AND abs(
        CAST(IFNULL(${b}.amount_ars, '0') AS REAL)
        - CAST(IFNULL(${a}.amount_ars, '0') AS REAL)
      ) < 0.01
    )
    OR (
      abs(CAST(IFNULL(${a}.amount_usd, '0') AS REAL)) >= 0.005
      AND abs(
        CAST(IFNULL(${b}.amount_usd, '0') AS REAL)
        - CAST(IFNULL(${a}.amount_usd, '0') AS REAL)
      ) < 0.005
    )
  )`;
}

/**
 * Pass 1. Same-household 1:1 echo: same-day id order, then residual ±2 days
 * by (date, id). One `tx_household_date_idx` range for `row`.
 * `row` is a SQL alias, not a bound value.
 */
function sameHouseholdEchoSql(row: string): string {
  return `(
    SELECT CASE
      WHEN IFNULL(SUM(CASE WHEN d = ${row}.date THEN nums_before ELSE 0 END), 0)
         < IFNULL(SUM(CASE WHEN d = ${row}.date THEN nameds ELSE 0 END), 0)
      THEN 1
      WHEN IFNULL(SUM(
             CASE
               WHEN d < ${row}.date THEN MAX(nums - nameds, 0)
               WHEN d = ${row}.date THEN MAX(nums_before - nameds, 0)
               ELSE 0
             END
           ), 0)
         < IFNULL(SUM(MAX(nameds - nums, 0)), 0)
      THEN 1
      ELSE 0
    END
    FROM (
      SELECT
        echo.date AS d,
        SUM(CASE
          WHEN IFNULL(echo.bank, '') = 'Fiwind' AND ${numericDescriptionSql("echo")}
          THEN 1 ELSE 0 END) AS nums,
        SUM(CASE
          WHEN IFNULL(echo.bank, '') = 'Fiwind'
           AND ${numericDescriptionSql("echo")}
           AND echo.id < ${row}.id
          THEN 1 ELSE 0 END) AS nums_before,
        SUM(CASE
          WHEN echo.id <> ${row}.id
           AND NOT ${numericDescriptionSql("echo")}
          THEN 1 ELSE 0 END) AS nameds
      FROM transactions echo
      WHERE echo.household_id = ${row}.household_id
        AND echo.date >= date(${row}.date, '-2 days')
        AND echo.date <= date(${row}.date, '+2 days')
        AND abs(julianday(echo.date) - julianday(${row}.date)) <= 2
        AND ${amountCloseSql(row, "echo")}
      GROUP BY echo.date
    )
  )`;
}

/**
 * Pass 2. Cross-household 1:1 echo on t.date only, for a row pass 1 kept.
 * Leftover named rows and still-unpaired numerics are equality lookups on
 * `tx_household_date_idx` via `households`, not a date-only scan.
 */
function crossHouseholdEchoSql(): string {
  return `(
    SELECT CASE
      WHEN IFNULL((
        SELECT COUNT(*)
        FROM transactions n
        WHERE n.household_id IN (SELECT id FROM households)
          AND n.date = t.date
          AND n.id < t.id
          AND IFNULL(n.bank, '') = 'Fiwind'
          AND ${numericDescriptionSql("n")}
          AND ${amountCloseSql("t", "n")}
          AND ${sameHouseholdEchoSql("n")} = 0
      ), 0)
       < IFNULL((
        SELECT SUM(MAX(nameds - nums, 0))
        FROM (
          SELECT
            SUM(CASE
              WHEN NOT ${numericDescriptionSql("xecho")}
              THEN 1 ELSE 0 END) AS nameds,
            SUM(CASE
              WHEN IFNULL(xecho.bank, '') = 'Fiwind' AND ${numericDescriptionSql("xecho")}
              THEN 1 ELSE 0 END) AS nums
          FROM transactions xecho
          WHERE xecho.household_id IN (
            SELECT id FROM households WHERE id <> t.household_id
          )
            AND xecho.date = t.date
            AND ${amountCloseSql("t", "xecho")}
          GROUP BY xecho.household_id
        )
      ), 0)
      THEN 1
      ELSE 0
    END
  )`;
}

/**
 * 1:1 Ockham echo. Pass 1 is same-household (same day, then ±2). Pass 2 is
 * another household on the same calendar day, and only when pass 1 kept t.
 */
const FIWIND_NUMERIC_ECHO_SQL = `(
  IFNULL(t.bank, '') = 'Fiwind'
  AND ${numericDescriptionSql("t")}
  AND (
    CASE
      WHEN ${sameHouseholdEchoSql("t")} = 1 THEN 1
      WHEN ${crossHouseholdEchoSql()} = 1 THEN 1
      ELSE 0
    END
  ) = 1
)`;

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
  OR ${FIWIND_NUMERIC_ECHO_SQL}
)`;

/**
 * Internal transfers stay on the Consumos list (out of the expense total).
 * Requires the categories join (`c`).
 * "Transferencia inmediata" and bare "TRANSFERENCIA" are spends, so they
 * are not listed here. Consumos still shows them because they fall outside
 * `BANK_ACCOUNTING_SQL`.
 */
export const INTERNAL_VISIBLE_SQL = `(
  IFNULL(c.slug, '') = 'transferencia-interna'
  OR upper(t.description_normalized) LIKE '%CUENTA TUYA%'
  OR upper(t.description_normalized) LIKE '%CUENTA PROPIA%'
  OR upper(t.description_normalized) LIKE '%ENTRE CUENTAS%'
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
