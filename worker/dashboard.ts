import type { Env } from "./env";
import { loadFx, monthEndBuy } from "./fx";
import { activeHousehold, forceSharedOnly, type HouseholdRow } from "./household";
import { sumIncomeArs } from "./income";
import { ARS_EXPR, EXPENSE_SQL, USD_EXPR } from "./sql";
import { currentPeriodAr, json, num, periodRange, shiftPeriod } from "./http";
import type { SessionUser } from "./auth";

const SERVICES = [
  { slug: "alquiler", name: "Alquiler" },
  { slug: "luz", name: "Luz" },
  { slug: "agua", name: "Agua" },
  { slug: "gas", name: "Gas" },
  { slug: "internet", name: "Internet" },
];

type Totals = { n: number; ars: number; usd: number };

export async function handleDashboard(req: Request, env: Env, user: SessionUser): Promise<Response> {
  const url = new URL(req.url);
  const { active } = await activeHousehold(req, env, user.id);
  if (!active) return json({ error: "NO_HOUSEHOLD" }, 400);

  const period = url.searchParams.get("period") || currentPeriodAr();
  const prev = shiftPeriod(period, -1);
  const current = periodRange(period);
  const previous = periodRange(prev);
  if (!current || !previous) return json({ error: "Período inválido" }, 400);

  const sharedOnly = forceSharedOnly(active.name);
  const fxPromise = loadFx();
  const [own, shared, categories, paidSlugs, savings, debt, incomes, fx] = await Promise.all([
    totals(env, active, user.id, sharedOnly, current.start, previous.start, current.end),
    totals(env, active, user.id, true, current.start, previous.start, current.end),
    categoryBreakdown(env, active, user.id, sharedOnly, current.start, current.end),
    paidServiceSlugs(env, active.id, current.start, current.end),
    savingsTotals(env, user.id),
    debtSnapshot(env, user.id),
    incomeRows(env, user.id),
    fxPromise,
  ]);

  const rateNow = monthEndBuy(fx, period);
  const ratePrev = monthEndBuy(fx, prev);
  const curOwn = own.cur;
  const prevOwn = own.prev;
  const curShared = shared.cur;
  const prevShared = shared.prev;

  const totalArs = curOwn.ars + (rateNow > 0 ? curOwn.usd * rateNow : 0);
  const prevTotalArs = prevOwn.ars + (ratePrev > 0 ? prevOwn.usd * ratePrev : 0);
  const sharedTotalArs = curShared.ars + (rateNow > 0 ? curShared.usd * rateNow : 0);
  const sharedPrevTotalArs = prevShared.ars + (ratePrev > 0 ? prevShared.usd * ratePrev : 0);

  const ranked = categories
    .map((row) => {
      const total = row.ars + (rateNow > 0 ? row.usd * rateNow : 0);
      return {
        id: row.id ?? "none",
        slug: row.slug ?? "uncategorized",
        name: row.name ?? "Sin categoría",
        total,
        pct: totalArs > 0 ? (total / totalArs) * 100 : 0,
      };
    })
    .filter((row) => row.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 4);

  const savingsUsd = savings.usd + savings.usdc;
  const blue = fx.blue;
  const savingsNetArs = savings.ars + (blue != null && blue > 0 ? savingsUsd * blue : 0);
  const incomeArs = sumIncomeArs(incomes, period, rateNow);
  const firstName = (user.name || user.email || "").split(/\s+/)[0] || "vos";

  return json({
    firstName,
    period,
    prevPeriod: prev,
    householdName: active.name,
    totalArs,
    prevTotalArs,
    sharedTotalArs,
    sharedPrevTotalArs,
    debtBalanceArs: debt.balance,
    debtSettled: debt.settled,
    monthTxCount: curOwn.n,
    categorySummary: ranked,
    householdServices: SERVICES.map((svc) => ({
      slug: svc.slug,
      name: svc.name,
      paid: paidSlugs.has(svc.slug),
    })),
    liveRates: fx.live,
    savingsArs: savings.ars,
    savingsUsd,
    savingsUsdc: savings.usdc,
    savingsNetArs,
    incomeArs,
    rates: { current: rateNow, previous: ratePrev },
  });
}

type PeriodTotals = { cur: Totals; prev: Totals };

async function totals(
  env: Env,
  household: HouseholdRow,
  userId: string,
  sharedOnly: boolean,
  currentStart: string,
  from: string,
  to: string,
): Promise<PeriodTotals> {
  const { where, binds } = visibility(household, userId, sharedOnly);
  const sql = `
    SELECT
      CASE WHEN t.date >= ? THEN 'cur' ELSE 'prev' END AS bucket,
      COUNT(*) AS n,
      SUM(${ARS_EXPR}) AS ars,
      SUM(${USD_EXPR}) AS usd
    FROM transactions t
    WHERE t.household_id = ?
      AND t.date >= ?
      AND t.date < ?
      AND ${EXPENSE_SQL}
      AND ${where}
    GROUP BY bucket
  `;
  const res = await env.DB.prepare(sql)
    .bind(currentStart, household.id, from, to, ...binds)
    .all<{ bucket: string; n: number; ars: number | null; usd: number | null }>();
  const out: PeriodTotals = {
    cur: { n: 0, ars: 0, usd: 0 },
    prev: { n: 0, ars: 0, usd: 0 },
  };
  for (const row of res.results ?? []) {
    const slot = row.bucket === "cur" ? out.cur : out.prev;
    slot.n = num(row.n);
    slot.ars = num(row.ars);
    slot.usd = num(row.usd);
  }
  return out;
}

async function categoryBreakdown(
  env: Env,
  household: HouseholdRow,
  userId: string,
  sharedOnly: boolean,
  from: string,
  to: string,
) {
  const { where, binds } = visibility(household, userId, sharedOnly);
  const sql = `
    SELECT t.category_id AS id, c.slug AS slug, c.name AS name,
           SUM(${ARS_EXPR}) AS ars, SUM(${USD_EXPR}) AS usd
    FROM transactions t
    LEFT JOIN categories c ON c.id = t.category_id
    WHERE t.household_id = ?
      AND t.date >= ? AND t.date < ?
      AND ${EXPENSE_SQL}
      AND ${where}
    GROUP BY t.category_id
  `;
  const res = await env.DB.prepare(sql)
    .bind(household.id, from, to, ...binds)
    .all<{ id: string | null; slug: string | null; name: string | null; ars: number | null; usd: number | null }>();
  return (res.results ?? []).map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    ars: num(row.ars),
    usd: num(row.usd),
  }));
}

async function paidServiceSlugs(env: Env, householdId: string, from: string, to: string) {
  const sql = `
    SELECT DISTINCT c.slug AS slug
    FROM transactions t
    INNER JOIN categories c ON c.id = t.category_id
    WHERE t.household_id = ?
      AND t.date >= ? AND t.date < ?
      AND t.ownership = 'shared'
      AND ${EXPENSE_SQL}
      AND c.slug IN ('alquiler', 'luz', 'agua', 'gas', 'internet')
  `;
  const res = await env.DB.prepare(sql)
    .bind(householdId, from, to)
    .all<{ slug: string }>();
  return new Set((res.results ?? []).map((row) => row.slug));
}

async function savingsTotals(env: Env, userId: string) {
  const row = await env.DB.prepare(
    `SELECT
       SUM(CASE WHEN kind = 'bank' THEN CAST(IFNULL(amount_ars, '0') AS REAL) ELSE 0 END) AS ars,
       SUM(CASE WHEN kind = 'bank' THEN CAST(IFNULL(amount_usd, '0') AS REAL) ELSE 0 END) AS usd,
       SUM(CASE WHEN kind != 'bank' THEN CAST(IFNULL(last_balance_usd, '0') AS REAL) ELSE 0 END) AS usdc
     FROM savings_assets WHERE user_id = ?`,
  )
    .bind(userId)
    .first<{ ars: number | null; usd: number | null; usdc: number | null }>();
  return { ars: num(row?.ars), usd: num(row?.usd), usdc: num(row?.usdc) };
}

async function debtSnapshot(env: Env, userId: string) {
  const row = await env.DB.prepare(
    `SELECT force_settled, saldo_deuda_ars, saldo_deuda_usd
     FROM debt_settings WHERE user_id = ?`,
  )
    .bind(userId)
    .first<{
      force_settled: number | null;
      saldo_deuda_ars: string | null;
      saldo_deuda_usd: string | null;
    }>();
  if (!row) return { balance: 0, settled: false };
  if (row.force_settled) return { balance: 0, settled: true };
  if (row.saldo_deuda_ars == null && row.saldo_deuda_usd == null) {
    return { balance: 0, settled: false };
  }
  const balance = Math.abs(num(row.saldo_deuda_ars));
  return { balance, settled: balance < 50 };
}

async function incomeRows(env: Env, userId: string) {
  const res = await env.DB.prepare(
    `SELECT date, label, kind, frequency, amount_ars, amount_usd
     FROM incomes WHERE user_id = ? ORDER BY date DESC LIMIT 400`,
  )
    .bind(userId)
    .all<{
      date: string;
      label: string;
      kind: string | null;
      frequency: string | null;
      amount_ars: string | null;
      amount_usd: string | null;
    }>();
  return res.results ?? [];
}

function visibility(household: HouseholdRow, userId: string, sharedOnly: boolean) {
  if (sharedOnly || forceSharedOnly(household.name)) {
    return { where: "t.ownership = 'shared'", binds: [] as unknown[] };
  }
  return {
    where: "(t.ownership = 'shared' OR t.paid_by_user_id = ?)",
    binds: [userId],
  };
}
