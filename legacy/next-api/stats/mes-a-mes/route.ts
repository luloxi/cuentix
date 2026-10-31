import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireApiUser } from "@/lib/api-auth";
import { getCategoryMap, requireHousehold } from "@/lib/household";
import { forceSharedOnlyForHousehold } from "@/lib/personal-household";
import { getDb, schema } from "@/lib/db";
import { getMonthEndBuyRates } from "@/lib/fx/month-end-rates";
import {
  aggregateByPeriod,
  aggregateCubiertoByPeriod,
  buildMonthFromAgg,
  filterByOwnership,
  isExpenseRow,
  mergePeriodLists,
  visibleCubiertoRows,
  visibleExpenseRows,
} from "@/lib/stats/monthly-expenses";

export async function GET(req: Request) {
  const authResult = await requireApiUser();
  if ("error" in authResult) return authResult.error;
  const { user: sessionUser } = authResult;

  try {
    const ctx = await requireHousehold(sessionUser.id);
    const { searchParams } = new URL(req.url);
    const periodParam = searchParams.get("period"); // YYYY-MM | "all" | null (latest)
    const ownershipRaw = searchParams.get("ownership");
    let ownershipFilter: "all" | "personal" | "shared" =
      ownershipRaw === "personal" || ownershipRaw === "shared"
        ? ownershipRaw
        : "all";
    // Casita / non-Personal: Personal-owned rows belong in Personal space.
    // Personal chip → empty (or leftovers until migrate); all/shared → shared only.
    if (forceSharedOnlyForHousehold(ctx.household.name)) {
      ownershipFilter = ownershipRaw === "personal" ? "personal" : "shared";
    }

    const db = (await getDb());
    const { byId, cats } = await getCategoryMap();
    const allRows = await db
      .select()
      .from(schema.transactions)
      .where(eq(schema.transactions.householdId, ctx.household.id));

    const ownedForViewer = filterByOwnership(allRows, ownershipFilter);
    const expenses = visibleExpenseRows(ownedForViewer, sessionUser.id);
    const cubiertos = visibleCubiertoRows(
      ownedForViewer,
      sessionUser.id,
      byId,
    );
    const { periods: expensePeriods, byPeriod } = aggregateByPeriod(
      expenses,
      byId,
    );
    const cubiertoByPeriod = aggregateCubiertoByPeriod(cubiertos);
    const periods = mergePeriodLists(
      expensePeriods,
      [...cubiertoByPeriod.keys()],
    );
    const rates = await getMonthEndBuyRates(
      periodParam && periodParam !== "all"
        ? [...new Set([...periods, periodParam])]
        : periods,
    );

    function buildMonth(p: string) {
      return buildMonthFromAgg(
        p,
        byPeriod.get(p),
        rates.get(p),
        cubiertoByPeriod.get(p),
      );
    }

    let selected: string[];
    if (periodParam === "all") {
      selected = periods;
    } else if (periodParam) {
      selected = periods.includes(periodParam) ? [periodParam] : [periodParam];
    } else {
      selected = periods[0] ? [periods[0]] : [];
    }

    const result = selected.map(buildMonth);

    const chartPeriods = [...periods].reverse();
    const totals = chartPeriods.map((p) => {
      const m = buildMonth(p);
      return {
        period: p,
        amountArs: m.totalArsCombined,
        amountArsNative: m.totalArs,
        amountUsd: m.totalUsd,
        amountArsFromUsd: m.totalArsFromUsd,
        count: m.totalCount,
        usdRate: m.usdRate,
      };
    });

    const catSeriesMap = new Map<
      string,
      { slug: string; name: string; values: Record<string, number> }
    >();
    for (const p of chartPeriods) {
      const m = buildMonth(p);
      for (const c of m.categories) {
        if (!catSeriesMap.has(c.slug)) {
          catSeriesMap.set(c.slug, {
            slug: c.slug,
            name: c.name,
            values: {},
          });
        }
        const entry = catSeriesMap.get(c.slug)!;
        entry.values[p] = (entry.values[p] ?? 0) + c.amountArsCombined;
        if (c.slug !== "uncategorized" && c.name) entry.name = c.name;
      }
    }

    const byCategory = [...catSeriesMap.values()]
      .map((c) => ({
        slug: c.slug,
        name: c.name,
        series: chartPeriods.map((p) => ({
          period: p,
          amountArs: c.values[p] ?? 0,
        })),
        totalArs: chartPeriods.reduce((s, p) => s + (c.values[p] ?? 0), 0),
      }))
      .sort((a, b) => b.totalArs - a.totalArs);

    const balPeriod =
      periodParam && periodParam !== "all"
        ? periodParam
        : (periods[0] ?? null);
    let sharedBalance = null;
    if (balPeriod) {
      const shared = allRows.filter(
        (r) =>
          isExpenseRow(r) &&
          r.ownership === "shared" &&
          r.date.startsWith(balPeriod) &&
          r.amountArs != null,
      );
      const byUser = new Map<string, number>();
      for (const r of shared) {
        const uid = r.paidByUserId ?? "unknown";
        byUser.set(uid, (byUser.get(uid) ?? 0) + Math.abs(Number(r.amountArs)));
      }
      sharedBalance = {
        period: balPeriod,
        byUser: Object.fromEntries(byUser),
        members: ctx.members,
      };
    }

    return NextResponse.json({
      periods,
      months: result,
      chart: { periods: chartPeriods, totals, byCategory },
      categories: cats.map((c) => ({
        id: c.id,
        slug: c.slug,
        name: c.name,
      })),
      sharedBalance,
      coupleBalance: sharedBalance,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}
