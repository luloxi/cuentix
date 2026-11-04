/**
 * GET `/api/stats/mes-a-mes` — month and category totals.
 * Análisis, Mes a mes, Consumos (Resumen / Gráficos) and the group balance
 * read this. One GROUP BY per household. The worker does not walk rows.
 * Category edits stay on `/api/transactions`.
 */

import { HOGAR_UTILITY_SLUGS } from "../src/lib/gasto-cubierto";
import type { SessionUser } from "./auth";
import { listVisibleCategories } from "./categories";
import type { Env } from "./env";
import { loadFx, monthEndBuy } from "./fx";
import { activeHousehold, forceSharedOnly, type HouseholdRow } from "./household";
import { json, num, periodRange } from "./http";
import { ARS_EXPR, USD_EXPR, expenseSql } from "./sql";
import { loadExcludedMovementIds } from "./transfer-class";

const UTILITY_SQL = HOGAR_UTILITY_SLUGS.map((slug) => `'${slug}'`).join(", ");

type Ownership = "all" | "personal" | "shared";

type AggRow = {
  period: string;
  id: string | null;
  slug: string | null;
  name: string | null;
  n: number | null;
  ars: number | null;
  usd: number | null;
};

type CubiertoRow = {
  period: string;
  n: number | null;
  ars: number | null;
  usd: number | null;
};

type BalanceRow = {
  period: string;
  uid: string;
  ars: number | null;
};

type Cat = {
  slug: string;
  name: string;
  categoryId: string | null;
  amountArs: number;
  amountUsd: number;
  amountArsFromUsd: number;
  amountArsCombined: number;
  count: number;
  pct: number;
};

type Month = {
  period: string;
  totalArs: number;
  totalUsd: number;
  totalArsFromUsd: number;
  totalArsCombined: number;
  totalCount: number;
  usdRate: { buy: number; asOf: string; source: string } | null;
  categories: Cat[];
  cubierto: {
    amountArs: number;
    amountUsd: number;
    amountArsFromUsd: number;
    amountArsCombined: number;
    count: number;
  };
};

export async function handleMesAMes(
  req: Request,
  env: Env,
  user: SessionUser,
): Promise<Response> {
  if (req.method !== "GET") return json({ error: "Método no permitido" }, 405);
  const url = new URL(req.url);
  const periodRaw = url.searchParams.get("period");
  if (periodRaw && periodRaw !== "all" && !periodRange(periodRaw)) {
    return json({ error: "Período inválido" }, 400);
  }
  const ownershipRaw = url.searchParams.get("ownership");
  const ownership: Ownership =
    ownershipRaw === "personal" || ownershipRaw === "shared" ? ownershipRaw : "all";

  const { active } = await activeHousehold(req, env, user.id);
  if (!active) return json({ error: "NO_HOUSEHOLD" }, 400);

  const { sql: where, binds } = spendWhere(active, user.id, ownership);
  const movements = await loadExcludedMovementIds(env.DB, user.id, env.OWN_ACCOUNT_IDS);
  const excluded = movements.excludedIds;
  const expense = expenseSql(excluded);

  const [aggRes, cubiertoRes, balanceRes, categories, fx] = await Promise.all([
    env.DB.prepare(
      `SELECT substr(t.date, 1, 7) AS period,
              t.category_id AS id,
              c.slug AS slug,
              c.name AS name,
              COUNT(*) AS n,
              SUM(${ARS_EXPR}) AS ars,
              SUM(${USD_EXPR}) AS usd
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.household_id = ?
         AND ${expense}
         AND ${where}
       GROUP BY period, t.category_id`,
    )
      .bind(active.id, ...binds)
      .all<AggRow>(),
    env.DB.prepare(
      `SELECT substr(t.date, 1, 7) AS period,
              COUNT(*) AS n,
              SUM(${ARS_EXPR}) AS ars,
              SUM(${USD_EXPR}) AS usd
       FROM transactions t
       INNER JOIN categories c ON c.id = t.category_id
       WHERE t.household_id = ?
         AND t.is_payment = 1
         AND t.is_credit = 0
         AND c.slug IN (${UTILITY_SQL})
         AND ${where}
       GROUP BY period`,
    )
      .bind(active.id, ...binds)
      .all<CubiertoRow>(),
    env.DB.prepare(
      `SELECT substr(t.date, 1, 7) AS period,
              COALESCE(t.paid_by_user_id, 'unknown') AS uid,
              SUM(${ARS_EXPR}) AS ars
       FROM transactions t
       WHERE t.household_id = ?
         AND t.ownership = 'shared'
         AND ${expense}
       GROUP BY period, uid`,
    )
      .bind(active.id)
      .all<BalanceRow>(),
    listVisibleCategories(env, active.id),
    loadFx(),
  ]);

  const byPeriodRows = new Map<string, AggRow[]>();
  for (const row of aggRes.results ?? []) {
    if (!isPeriod(row.period)) continue;
    const list = byPeriodRows.get(row.period) ?? [];
    list.push(row);
    byPeriodRows.set(row.period, list);
  }
  const cubiertoByPeriod = new Map<string, CubiertoRow>();
  for (const row of cubiertoRes.results ?? []) {
    if (!isPeriod(row.period)) continue;
    cubiertoByPeriod.set(row.period, row);
  }
  const periods = [...new Set([...byPeriodRows.keys(), ...cubiertoByPeriod.keys()])].sort().reverse();

  const monthsByPeriod = new Map<string, Month>();
  for (const period of periods) {
    monthsByPeriod.set(period, buildMonth(period, byPeriodRows.get(period) ?? [], cubiertoByPeriod.get(period), fx));
  }

  let selected: string[];
  if (periodRaw === "all") selected = periods;
  else if (periodRaw) selected = [periodRaw];
  else selected = periods[0] ? [periods[0]] : [];

  const months = selected.map(
    (period) => monthsByPeriod.get(period) ?? buildMonth(period, [], undefined, fx),
  );

  const chartPeriods = [...periods].reverse();
  const totals = chartPeriods.map((period) => {
    const month = monthsByPeriod.get(period)!;
    return {
      period,
      amountArs: month.totalArsCombined,
      amountUsd: month.totalUsd,
      amountArsFromUsd: month.totalArsFromUsd,
      count: month.totalCount,
      usdRate: month.usdRate,
    };
  });

  const series = new Map<string, { slug: string; name: string; values: Map<string, number> }>();
  for (const period of chartPeriods) {
    const month = monthsByPeriod.get(period);
    if (!month) continue;
    for (const cat of month.categories) {
      const entry = series.get(cat.slug) ?? {
        slug: cat.slug,
        name: cat.name,
        values: new Map<string, number>(),
      };
      entry.values.set(period, (entry.values.get(period) ?? 0) + cat.amountArsCombined);
      if (cat.slug !== "uncategorized" && cat.name) entry.name = cat.name;
      series.set(cat.slug, entry);
    }
  }
  const byCategory = [...series.values()]
    .map((cat) => ({
      slug: cat.slug,
      name: cat.name,
      series: chartPeriods.map((period) => ({
        period,
        amountArs: cat.values.get(period) ?? 0,
      })),
      totalArs: chartPeriods.reduce((sum, period) => sum + (cat.values.get(period) ?? 0), 0),
    }))
    .sort((a, b) => b.totalArs - a.totalArs);

  const balPeriod = periodRaw && periodRaw !== "all" ? periodRaw : (periods[0] ?? null);
  const byUser: Record<string, number> = {};
  if (balPeriod) {
    for (const row of balanceRes.results ?? []) {
      if (row.period !== balPeriod) continue;
      byUser[row.uid] = num(row.ars);
    }
  }
  const sharedBalance = balPeriod ? { period: balPeriod, byUser } : null;

  return json({
    periods,
    months,
    chart: { periods: chartPeriods, totals, byCategory },
    categories: categories.map((cat) => ({
      id: cat.id,
      slug: cat.slug,
      name: cat.name,
    })),
    sharedBalance,
    coupleBalance: sharedBalance,
  });
}

/** Personal chip keeps the viewer's own rows. Other chips on a shared hogar are shared-only. */
function spendWhere(
  household: HouseholdRow,
  userId: string,
  ownership: Ownership,
): { sql: string; binds: unknown[] } {
  if (ownership === "personal") {
    return {
      sql: "t.ownership = 'personal' AND t.paid_by_user_id = ?",
      binds: [userId],
    };
  }
  if (ownership === "shared" || forceSharedOnly(household.name)) {
    return { sql: "t.ownership = 'shared'", binds: [] };
  }
  return {
    sql: "(t.ownership = 'shared' OR t.paid_by_user_id = ?)",
    binds: [userId],
  };
}

function isPeriod(value: string): boolean {
  return /^\d{4}-\d{2}$/.test(value);
}

function buildMonth(
  period: string,
  rows: AggRow[],
  cubierto: CubiertoRow | undefined,
  fx: Awaited<ReturnType<typeof loadFx>>,
): Month {
  const buy = monthEndBuy(fx, period);
  const rate = buy > 0 ? buy : 0;
  const categories = rows
    .map((row) => {
      const amountArs = num(row.ars);
      const amountUsd = num(row.usd);
      const amountArsFromUsd = rate > 0 ? amountUsd * rate : 0;
      return {
        slug: row.slug || "uncategorized",
        name: row.name || "Sin categoría",
        categoryId: row.id,
        amountArs,
        amountUsd,
        amountArsFromUsd,
        amountArsCombined: amountArs + amountArsFromUsd,
        count: num(row.n),
        pct: 0,
      };
    })
    .sort((a, b) => b.amountArsCombined - a.amountArsCombined);

  const totalArs = categories.reduce((sum, cat) => sum + cat.amountArs, 0);
  const totalUsd = categories.reduce((sum, cat) => sum + cat.amountUsd, 0);
  const totalArsFromUsd = categories.reduce((sum, cat) => sum + cat.amountArsFromUsd, 0);
  const totalArsCombined = totalArs + totalArsFromUsd;
  const totalCount = categories.reduce((sum, cat) => sum + cat.count, 0);
  for (const cat of categories) {
    cat.pct = totalArsCombined > 0 ? (cat.amountArsCombined / totalArsCombined) * 100 : 0;
  }

  const cubiertoArs = num(cubierto?.ars);
  const cubiertoUsd = num(cubierto?.usd);
  const cubiertoArsFromUsd = rate > 0 ? cubiertoUsd * rate : 0;

  return {
    period,
    totalArs,
    totalUsd,
    totalArsFromUsd,
    totalArsCombined,
    totalCount,
    usdRate: rate > 0 ? { buy: rate, asOf: `${period}-01`, source: "blue" } : null,
    categories,
    cubierto: {
      amountArs: cubiertoArs,
      amountUsd: cubiertoUsd,
      amountArsFromUsd: cubiertoArsFromUsd,
      amountArsCombined: cubiertoArs + cubiertoArsFromUsd,
      count: num(cubierto?.n),
    },
  };
}
