/**
 * GET `/api/stats/compartido` — shared (Hogar) spend for the active household.
 * Aggregates in SQL. Individual rows are capped. Receipt line items are skipped.
 */

import type { SessionUser } from "./auth";
import type { Env } from "./env";
import { loadFx, monthEndBuy } from "./fx";
import { activeHousehold, listMembers } from "./household";
import { currentPeriodAr, json, num, periodRange, shiftPeriod } from "./http";
import { ARS_EXPR, USD_EXPR, expenseSql } from "./sql";
import { loadExcludedMovementIds } from "./transfer-class";

const EXPENSE_LIMIT = 250;

type GroupRow = {
  month: string | null;
  uid: string | null;
  slug: string | null;
  name: string | null;
  ars: number | null;
  usd: number | null;
  n: number | null;
};

type ExpenseRow = {
  id: string;
  date: string;
  description_normalized: string;
  amount_ars: string | null;
  amount_usd: string | null;
  paid_by_user_id: string | null;
  source: string | null;
  slug: string | null;
  name: string | null;
};

export async function handleCompartidoStats(
  req: Request,
  env: Env,
  user: SessionUser,
): Promise<Response> {
  if (req.method !== "GET") return json({ error: "Método no permitido" }, 405);
  const { active } = await activeHousehold(req, env, user.id);
  if (!active) return json({ error: "NO_HOUSEHOLD" }, 400);

  const url = new URL(req.url);
  const periodParam = url.searchParams.get("period");
  if (periodParam && periodParam !== "all" && !periodRange(periodParam)) {
    return json({ error: "Período inválido" }, 400);
  }
  const all = periodParam === "all";
  const period = all ? "all" : periodParam && periodRange(periodParam) ? periodParam : currentPeriodAr();
  const prev = period === "all" ? null : shiftPeriod(period, -1);

  const movements = await loadExcludedMovementIds(env.DB, user.id, env.OWN_ACCOUNT_IDS);
  const excluded = movements.excludedIds;
  const filterSql = expenseSql(excluded);

  let groupSql = `
    SELECT substr(t.date, 1, 7) AS month,
           t.paid_by_user_id AS uid,
           IFNULL(c.slug, 'uncategorized') AS slug,
           IFNULL(c.name, 'Sin categoría') AS name,
           SUM(${ARS_EXPR}) AS ars,
           SUM(${USD_EXPR}) AS usd,
           COUNT(*) AS n
    FROM transactions t
    LEFT JOIN categories c ON c.id = t.category_id
    WHERE t.household_id = ?
      AND t.ownership = 'shared'
      AND ${filterSql}`;
  const groupBinds: unknown[] = [active.id];
  if (!all && period !== "all") {
    const current = periodRange(period);
    const previous = prev ? periodRange(prev) : null;
    if (current && previous) {
      groupSql += ` AND t.date >= ? AND t.date < ?`;
      groupBinds.push(previous.start, current.end);
    }
  }
  groupSql += ` GROUP BY month, uid, slug`;

  let expenseSqlText = `
    SELECT t.id AS id, t.date AS date, t.description_normalized AS description_normalized,
           t.amount_ars AS amount_ars, t.amount_usd AS amount_usd,
           t.paid_by_user_id AS paid_by_user_id, t.source AS source,
           IFNULL(c.slug, 'uncategorized') AS slug,
           IFNULL(c.name, 'Sin categoría') AS name
    FROM transactions t
    LEFT JOIN categories c ON c.id = t.category_id
    WHERE t.household_id = ?
      AND t.ownership = 'shared'
      AND ${filterSql}`;
  const expenseBinds: unknown[] = [active.id];
  if (!all && period !== "all") {
    const current = periodRange(period);
    if (current) {
      expenseSqlText += ` AND t.date >= ? AND t.date < ?`;
      expenseBinds.push(current.start, current.end);
    }
  }
  expenseSqlText += ` ORDER BY t.date DESC LIMIT ${EXPENSE_LIMIT}`;

  const [fx, people, invite, periodRes, groupRes, expenseRes] = await Promise.all([
    loadFx(),
    listMembers(env, active.id),
    env.DB.prepare("SELECT invite_code AS invite_code FROM households WHERE id = ?")
      .bind(active.id)
      .first<{ invite_code: string | null }>(),
    env.DB.prepare(
      `SELECT DISTINCT substr(t.date, 1, 7) AS month
       FROM transactions t
       WHERE t.household_id = ?
         AND t.ownership = 'shared'
         AND ${filterSql}
       ORDER BY month DESC`,
    )
      .bind(active.id)
      .all<{ month: string | null }>(),
    env.DB.prepare(groupSql).bind(...groupBinds).all<GroupRow>(),
    env.DB.prepare(expenseSqlText).bind(...expenseBinds).all<ExpenseRow>(),
  ]);

  const periods = (periodRes.results ?? [])
    .map((row) => row.month)
    .filter((month): month is string => Boolean(month));

  const catMap = new Map<string, { slug: string; name: string; total: number; count: number }>();
  const paidByMember = new Map<string, number>();
  const chartByKey = new Map<
    string,
    { date: string; amountCombined: number; categorySlug: string; categoryName: string }
  >();
  let currentTotal = 0;
  let prevTotal = 0;

  for (const row of groupRes.results ?? []) {
    if (!row.month) continue;
    const rate = monthEndBuy(fx, row.month);
    const combined = combinedArs(num(row.ars), num(row.usd), rate);
    const slug = row.slug ?? "uncategorized";
    const name = row.name ?? "Sin categoría";
    const chartKey = `${row.month}:${slug}`;
    const chart = chartByKey.get(chartKey) ?? {
      date: `${row.month}-15`,
      amountCombined: 0,
      categorySlug: slug,
      categoryName: name,
    };
    chart.amountCombined += combined;
    chartByKey.set(chartKey, chart);

    if (!all && prev && row.month === prev) {
      prevTotal += combined;
      continue;
    }
    if (!all && row.month !== period) continue;

    currentTotal += combined;
    const cat = catMap.get(slug) ?? { slug, name, total: 0, count: 0 };
    cat.total += combined;
    cat.count += num(row.n);
    if (name) cat.name = name;
    catMap.set(slug, cat);
    if (row.uid) paidByMember.set(row.uid, (paidByMember.get(row.uid) ?? 0) + combined);
  }

  const nameByUser = new Map(people.map((m) => [m.userId, m.name]));
  const expenses = (expenseRes.results ?? []).map((row) => {
    const p = row.date.slice(0, 7);
    const rate = monthEndBuy(fx, p);
    const amountArs = row.amount_ars != null && row.amount_ars !== "" ? Math.abs(num(row.amount_ars)) : null;
    const amountUsd = row.amount_usd != null && row.amount_usd !== "" ? Math.abs(num(row.amount_usd)) : null;
    const uid = row.paid_by_user_id;
    return {
      id: row.id,
      date: row.date,
      description: row.description_normalized,
      amountArs: amountArs != null && amountArs > 0 ? amountArs : null,
      amountUsd: amountUsd != null && amountUsd > 0 ? amountUsd : null,
      amountCombined: combinedArs(amountArs ?? 0, amountUsd ?? 0, rate),
      categoryId: null as string | null,
      categoryName: row.name ?? "Sin categoría",
      categorySlug: row.slug ?? "uncategorized",
      paidByUserId: uid,
      paidByName: uid ? (nameByUser.get(uid) ?? "Desconocido") : "Sin asignar",
      hasTicket: row.source === "receipt",
      receiptItems: [] as Array<unknown>,
    };
  });

  const categories = [...catMap.values()]
    .map((c) => ({
      ...c,
      pct: currentTotal > 0 ? (c.total / currentTotal) * 100 : 0,
    }))
    .sort((a, b) => b.total - a.total);

  const members = people.map((m) => {
    const paid = paidByMember.get(m.userId) ?? 0;
    return {
      userId: m.userId,
      name: m.name,
      paidArs: paid,
      pct: currentTotal > 0 ? (paid / currentTotal) * 100 : 0,
    };
  });

  const chartExpenses = [...chartByKey.values()].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
  );

  return json({
    householdName: active.name,
    periods,
    period,
    prevPeriod: prev,
    prevTotalArs: prevTotal,
    expenses,
    chartExpenses,
    categories,
    members,
    inviteCode: invite?.invite_code ?? "",
    summary: {
      totalArsCombined: currentTotal,
      memberCount: members.length,
      expenseCount: expenses.length,
    },
  });
}

function combinedArs(ars: number, usd: number, rate: number): number {
  const a = Math.abs(ars);
  const u = Math.abs(usd);
  if (u > 0 && a > 0) return rate > 0 ? u * rate : 0;
  return a + (rate > 0 ? u * rate : 0);
}
