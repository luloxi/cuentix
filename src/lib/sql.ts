/**
 * Aggregation SQL shared by the Worker and the tests.
 * `today` is injected (YYYY-MM-DD) so tests stay deterministic.
 * The Worker passes the America/Argentina/Buenos_Aires date.
 * ARS, USDT, and USD are never added together.
 */

export const CURRENCIES = ["ARS", "USDT", "USD"] as const;
export type Currency = (typeof CURRENCIES)[number];

export const KINDS = ["expense", "income", "internal_transfer"] as const;
export type Kind = (typeof KINDS)[number];

export const SPENDING_WINDOW_DAYS = 90;
/** About 26 Monday-start weeks. */
export const SERIES_WEEK_DAYS = 182;
/** Current month plus the previous 23. */
export const SERIES_MONTH_COUNT = 24;

export const WEEK_BUCKET_SQL = "date(t.date, 'weekday 0', '-6 days')";
export const MONTH_BUCKET_SQL = "substr(t.date, 1, 7)";

export type Granularity = "day" | "week" | "month" | "all";

export function isCurrency(value: string | null | undefined): value is Currency {
  return value === "ARS" || value === "USDT" || value === "USD";
}

export function isKind(value: string | null | undefined): value is Kind {
  return value === "expense" || value === "income" || value === "internal_transfer";
}

export function isGranularity(value: string | null | undefined): value is Granularity {
  return value === "day" || value === "week" || value === "month" || value === "all";
}

export interface SqlQuery {
  sql: string;
  params: Array<string | number | null>;
}

/** Day `days` before today is included. Day `days + 1` is excluded. */
export function spendingByCategoryQuery(
  currency: Currency,
  today: string,
  days = SPENDING_WINDOW_DAYS,
): SqlQuery {
  return {
    sql: `
      SELECT COALESCE(c.name, 'Sin categoría') AS category,
             COUNT(*) AS count,
             ROUND(SUM(t.amount), 2) AS total
      FROM transactions t
      LEFT JOIN categories c ON c.id = t.category_id
      WHERE t.kind = 'expense'
        AND t.currency = ?
        AND t.date >= date(?, ?)
        AND t.date <= ?
      GROUP BY category
      ORDER BY total DESC, category ASC
    `,
    params: [currency, today, `-${days} days`, today],
  };
}

/** kind = 'income' only. internal_transfer is not income. */
export function incomeByMonthQuery(currency: Currency): SqlQuery {
  return {
    sql: `
      SELECT substr(t.date, 1, 7) AS month,
             COUNT(*) AS count,
             ROUND(SUM(t.amount), 2) AS total
      FROM transactions t
      WHERE t.kind = 'income'
        AND t.currency = ?
      GROUP BY month
      ORDER BY month ASC
    `,
    params: [currency],
  };
}

/**
 * Expense series.
 * day: last 90 days, one point per day.
 * week: last 26 weeks, Monday start.
 * month: last 24 months.
 * all: one point per month for the whole history (not a cumulative sum).
 */
export function spendingSeriesQuery(currency: Currency, today: string, granularity: Granularity): SqlQuery {
  if (granularity === "day") {
    return {
      sql: `
        SELECT t.date AS bucket,
               COUNT(*) AS count,
               ROUND(SUM(t.amount), 2) AS total
        FROM transactions t
        WHERE t.kind = 'expense'
          AND t.currency = ?
          AND t.date >= date(?, ?)
          AND t.date <= ?
        GROUP BY bucket
        ORDER BY bucket ASC
      `,
      params: [currency, today, `-${SPENDING_WINDOW_DAYS} days`, today],
    };
  }

  if (granularity === "week") {
    return {
      sql: `
        SELECT ${WEEK_BUCKET_SQL} AS bucket,
               COUNT(*) AS count,
               ROUND(SUM(t.amount), 2) AS total
        FROM transactions t
        WHERE t.kind = 'expense'
          AND t.currency = ?
          AND t.date >= date(?, ?)
          AND t.date <= ?
        GROUP BY bucket
        ORDER BY bucket ASC
      `,
      params: [currency, today, `-${SERIES_WEEK_DAYS} days`, today],
    };
  }

  const monthBack = SERIES_MONTH_COUNT - 1;
  if (granularity === "month") {
    return {
      sql: `
        SELECT ${MONTH_BUCKET_SQL} AS bucket,
               COUNT(*) AS count,
               ROUND(SUM(t.amount), 2) AS total
        FROM transactions t
        WHERE t.kind = 'expense'
          AND t.currency = ?
          AND t.date >= date(?, 'start of month', '-${monthBack} months')
          AND t.date <= ?
        GROUP BY bucket
        ORDER BY bucket ASC
      `,
      params: [currency, today, today],
    };
  }

  return {
    sql: `
      SELECT ${MONTH_BUCKET_SQL} AS bucket,
             COUNT(*) AS count,
             ROUND(SUM(t.amount), 2) AS total
      FROM transactions t
      WHERE t.kind = 'expense'
        AND t.currency = ?
        AND t.date <= ?
      GROUP BY bucket
      ORDER BY bucket ASC
    `,
    params: [currency, today],
  };
}

/** Newest first. Pass limit+1 to detect another page. Empty cursor reads the first page. */
export function transactionsQuery(input: {
  kind: "" | Kind;
  currency: "" | Currency;
  cursorDate: string;
  cursorId: number;
  limit: number;
}): SqlQuery {
  return {
    sql: `
      SELECT t.id AS id,
             t.date AS date,
             t.amount AS amount,
             t.currency AS currency,
             a.name AS account,
             COALESCE(c.name, 'Sin categoría') AS category,
             t.description AS description,
             t.kind AS kind
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id
      LEFT JOIN categories c ON c.id = t.category_id
      WHERE (? = '' OR t.kind = ?)
        AND (? = '' OR t.currency = ?)
        AND (? = '' OR t.date < ? OR (t.date = ? AND t.id < ?))
      ORDER BY t.date DESC, t.id DESC
      LIMIT ?
    `,
    params: [
      input.kind,
      input.kind,
      input.currency,
      input.currency,
      input.cursorDate,
      input.cursorDate,
      input.cursorDate,
      input.cursorId,
      input.limit,
    ],
  };
}

export const latestBalancesSql = `
  SELECT a.name AS account,
         b.currency AS currency,
         b.amount AS amount,
         b.date AS date,
         b.source AS source
  FROM balance_snapshots b
  JOIN accounts a ON a.id = b.account_id
  WHERE b.date = (
    SELECT MAX(b2.date)
    FROM balance_snapshots b2
    WHERE b2.account_id = b.account_id
      AND b2.currency = b.currency
  )
  ORDER BY a.name ASC, b.currency ASC
`;

export const balanceTotalsSql = `
  SELECT currency, ROUND(SUM(amount), 2) AS total
  FROM (
    SELECT b.currency AS currency, b.amount AS amount
    FROM balance_snapshots b
    WHERE b.date = (
      SELECT MAX(b2.date)
      FROM balance_snapshots b2
      WHERE b2.account_id = b.account_id
        AND b2.currency = b.currency
    )
  )
  GROUP BY currency
  ORDER BY currency ASC
`;

export function balanceSeriesQuery(currency: Currency): SqlQuery {
  return {
    sql: `
      SELECT a.name AS account, b.date AS date, b.amount AS amount
      FROM balance_snapshots b
      JOIN accounts a ON a.id = b.account_id
      WHERE b.currency = ?
      ORDER BY b.date ASC, a.name ASC
    `,
    params: [currency],
  };
}

export const accountNamesSql = `SELECT name FROM accounts ORDER BY name ASC`;

export const insertAccountSql = `
  INSERT INTO accounts (name, household)
  VALUES (?, 'Personal')
  ON CONFLICT(name) DO NOTHING
`;

export const upsertSnapshotSql = `
  INSERT INTO balance_snapshots (date, account_id, currency, amount, source)
  SELECT ?, a.id, ?, ?, ?
  FROM accounts a
  WHERE a.name = ?
  ON CONFLICT(account_id, currency, date) DO UPDATE SET
    amount = excluded.amount,
    source = excluded.source
`;
