import { NextResponse } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { requireApiUser } from "@/lib/api-auth";
import { getCategoryMap, requireHousehold } from "@/lib/household";
import { getDb, schema } from "@/lib/db";
import { mapInChunks } from "@/lib/db/chunk";
import {
  convertUsdToArs,
  getMonthEndBuyRates,
} from "@/lib/fx/month-end-rates";
import { isBankAccountingEntry } from "@/lib/bbva/bank-entries";
import { currentPeriodAr, periodFromDateString } from "@/lib/utils";
import { splitExpenseAmounts } from "@/lib/stats/monthly-expenses";

function prevPeriodOf(period: string): string {
  const [y, m] = period.split("-").map(Number);
  let py = y!;
  let pm = m! - 1;
  if (pm < 1) {
    pm = 12;
    py -= 1;
  }
  return `${py}-${String(pm).padStart(2, "0")}`;
}

/** Shared household: total, vs prev month, by category, who paid (% only). */
export async function GET(req: Request) {
  const authResult = await requireApiUser();
  if ("error" in authResult) return authResult.error;
  const { user: sessionUser } = authResult;

  try {
    const ctx = await requireHousehold(sessionUser.id);
    const { searchParams } = new URL(req.url);
    const periodParam = searchParams.get("period"); // YYYY-MM | all | null

    const db = (await getDb());
    const { byId } = await getCategoryMap();
    const rows = await db
      .select()
      .from(schema.transactions)
      .where(eq(schema.transactions.householdId, ctx.household.id));

    const periodsSet = new Set<string>();
    for (const r of rows) {
      if (r.isPayment) continue;
      if (isBankAccountingEntry(r.descriptionNormalized)) continue;
      if (r.ownership !== "shared") continue;
      periodsSet.add(periodFromDateString(r.date));
    }
    const periods = [...periodsSet].sort().reverse();

    const now = currentPeriodAr();
    const filterPeriod =
      periodParam === "all"
        ? null
        : periodParam && periodParam !== "all"
          ? periodParam
          : now;

    const prevP = filterPeriod ? prevPeriodOf(filterPeriod) : null;
    const rateKeys = [
      ...periods,
      ...(filterPeriod ? [filterPeriod] : []),
      ...(prevP ? [prevP] : []),
    ];
    const rates = await getMonthEndBuyRates([...new Set(rateKeys)]);

    type ReceiptItem = {
      id: string;
      name: string;
      quantity: number | null;
      unitPrice: number | null;
      lineTotal: number | null;
      productCategory: string | null;
    };

    type Expense = {
      id: string;
      date: string;
      description: string;
      amountArs: number | null;
      amountUsd: number | null;
      amountCombined: number;
      categoryId: string | null;
      categoryName: string;
      categorySlug: string;
      paidByUserId: string | null;
      paidByName: string;
      hasTicket: boolean;
      receiptItems: ReceiptItem[];
    };

    const nameByUser = new Map(
      ctx.members.map((m) => [
        m.userId,
        m.displayName || m.name || m.email || m.userId,
      ]),
    );

    function combinedOf(r: (typeof rows)[0], p: string): number {
      const rate = rates.get(p)?.buy ?? 0;
      const split = splitExpenseAmounts(r.amountArs, r.amountUsd);
      return split.amountArs + convertUsdToArs(split.amountUsd, rate);
    }

    let prevTotal = 0;
    if (prevP) {
      for (const r of rows) {
        if (r.isPayment) continue;
        if (isBankAccountingEntry(r.descriptionNormalized)) continue;
        if (r.ownership !== "shared") continue;
        if (periodFromDateString(r.date) !== prevP) continue;
        prevTotal += combinedOf(r, prevP);
      }
    }

    const expenses: Expense[] = [];
    const paidByMember = new Map<string, number>();
    const byCat = new Map<
      string,
      { slug: string; name: string; total: number; count: number }
    >();

    for (const r of rows) {
      if (r.isPayment) continue;
      if (isBankAccountingEntry(r.descriptionNormalized)) continue;
      if (r.ownership !== "shared") continue;
      const p = periodFromDateString(r.date);
      if (filterPeriod && p !== filterPeriod) continue;

      const combined = combinedOf(r, p);
      const uid = r.paidByUserId ?? null;
      if (uid) paidByMember.set(uid, (paidByMember.get(uid) ?? 0) + combined);

      const cat = r.categoryId ? byId.get(r.categoryId) : null;
      const slug = cat?.slug ?? "uncategorized";
      const name = cat?.name ?? "Sin categoría";
      const cur = byCat.get(slug) ?? { slug, name, total: 0, count: 0 };
      cur.total += combined;
      cur.count += 1;
      byCat.set(slug, cur);

      expenses.push({
        id: r.id,
        date: r.date,
        description: r.descriptionNormalized,
        amountArs: r.amountArs != null ? Math.abs(Number(r.amountArs)) : null,
        amountUsd: r.amountUsd != null ? Math.abs(Number(r.amountUsd)) : null,
        amountCombined: combined,
        categoryId: r.categoryId,
        categoryName: name,
        categorySlug: slug,
        paidByUserId: uid,
        paidByName: uid
          ? (nameByUser.get(uid) ?? "Desconocido")
          : "Sin asignar",
        hasTicket: r.source === "receipt",
        receiptItems: [],
      });
    }

    // Attach receipt line items when available
    const txIds = expenses.map((e) => e.id);
    if (txIds.length > 0) {
      const receipts = await db
        .select()
        .from(schema.receipts)
        .where(eq(schema.receipts.householdId, ctx.household.id));
      const linked = receipts.filter(
        (r) => r.transactionId && txIds.includes(r.transactionId),
      );
      const receiptIds = linked.map((r) => r.id);
      const items =
        receiptIds.length > 0
          ? await mapInChunks(receiptIds, 0, (chunk) =>
              db
                .select()
                .from(schema.receiptItems)
                .where(inArray(schema.receiptItems.receiptId, chunk)),
            )
          : [];

      const itemsByTx = new Map<string, ReceiptItem[]>();
      for (const rec of linked) {
        if (!rec.transactionId) continue;
        const list = items
          .filter((i) => i.receiptId === rec.id)
          .map((i) => ({
            id: i.id,
            name: i.name,
            quantity: i.quantity != null ? Number(i.quantity) : null,
            unitPrice: i.unitPrice != null ? Number(i.unitPrice) : null,
            lineTotal: i.lineTotal != null ? Number(i.lineTotal) : null,
            productCategory: i.productCategory,
          }));
        itemsByTx.set(rec.transactionId, list);
      }

      for (const e of expenses) {
        const list = itemsByTx.get(e.id);
        if (list && list.length > 0) {
          e.receiptItems = list;
          e.hasTicket = true;
        }
      }
    }

    expenses.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

    const totalArsCombined = expenses.reduce((s, e) => s + e.amountCombined, 0);

    const categories = [...byCat.values()]
      .map((c) => ({
        ...c,
        pct: totalArsCombined > 0 ? (c.total / totalArsCombined) * 100 : 0,
      }))
      .sort((a, b) => b.total - a.total);

    const members = ctx.members.map((m) => {
      const paid = paidByMember.get(m.userId) ?? 0;
      return {
        userId: m.userId,
        name: m.displayName || m.name || m.email || m.userId,
        paidArs: paid,
        pct: totalArsCombined > 0 ? (paid / totalArsCombined) * 100 : 0,
      };
    });

    return NextResponse.json({
      householdName: ctx.household.name,
      periods,
      period: filterPeriod ?? "all",
      prevPeriod: prevP,
      prevTotalArs: prevTotal,
      expenses,
      categories,
      members,
      inviteCode: ctx.household.inviteCode,
      summary: {
        totalArsCombined,
        memberCount: members.length,
        expenseCount: expenses.length,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}
