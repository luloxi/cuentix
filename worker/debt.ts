import type { DebtTx } from "../src/lib/stats/debt";
import type { Env } from "./env";
import { DEBT_ROWS_SQL } from "./sql";

export type DebtSqlRow = {
  id: string;
  date: string;
  description_normalized: string;
  amount_ars: string | null;
  amount_usd: string | null;
  installment: string | null;
  is_payment: number;
  is_credit: number;
  ownership: string | null;
  paid_by_user_id: string | null;
  source: string | null;
  bank: string | null;
  card_last4: string | null;
  statement_id: string | null;
  statement_closed: number;
};

/** Map a `DEBT_ROWS_SQL` row. `statement_closed` comes from `card_statements.status`. */
export function debtTxFromRow(row: DebtSqlRow): DebtTx {
  return {
    id: row.id,
    date: row.date,
    descriptionNormalized: row.description_normalized,
    amountArs: row.amount_ars,
    amountUsd: row.amount_usd,
    installment: row.installment,
    isPayment: Boolean(row.is_payment),
    isCredit: Boolean(row.is_credit),
    ownership: row.ownership,
    paidByUserId: row.paid_by_user_id,
    source: row.source,
    bank: row.bank,
    cardLast4: row.card_last4,
    statementId: row.statement_id,
    statementClosed: row.statement_closed === 1,
  };
}

/**
 * Transactions visible to the user, with the closed-statement flag set.
 * The patrimonio worker (`worker/finance.ts`) should pass this list into
 * `computeCardDebt` instead of selecting transactions without the join.
 */
export async function loadDebtRows(env: Env, userId: string): Promise<DebtTx[]> {
  const res = await env.DB.prepare(DEBT_ROWS_SQL).bind(userId).all<DebtSqlRow>();
  return (res.results ?? []).map(debtTxFromRow);
}
