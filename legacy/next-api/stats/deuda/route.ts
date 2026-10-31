import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireApiUser } from "@/lib/api-auth";
import { requireHousehold } from "@/lib/household";
import { getDb, schema } from "@/lib/db";
import { getMonthEndBuyRates } from "@/lib/fx/month-end-rates";
import { currentPeriodAr } from "@/lib/utils";
import { computeCardDebt } from "@/lib/stats/debt";

export async function GET() {
  const authResult = await requireApiUser();
  if ("error" in authResult) return authResult.error;
  const { user: sessionUser } = authResult;

  try {
    const ctx = await requireHousehold(sessionUser.id);
    const db = (await getDb());
    const [allRows, settingsRows] = await Promise.all([
      db
        .select()
        .from(schema.transactions)
        .where(eq(schema.transactions.householdId, ctx.household.id)),
      db
        .select()
        .from(schema.debtSettings)
        .where(eq(schema.debtSettings.userId, sessionUser.id))
        .limit(1),
    ]);

    const period = currentPeriodAr();
    const rates = await getMonthEndBuyRates([period]);
    const usdRate = rates.get(period)?.buy ?? 0;
    const settings = settingsRows[0];

    const debt = computeCardDebt(allRows, {
      userId: sessionUser.id,
      settings: {
        forceSettled: settings?.forceSettled ?? false,
        cardLast4: settings?.cardLast4 ?? null,
        saldoDeudaArs:
          settings?.saldoDeudaArs != null
            ? Number(settings.saldoDeudaArs)
            : null,
        saldoDeudaUsd:
          settings?.saldoDeudaUsd != null
            ? Number(settings.saldoDeudaUsd)
            : null,
      },
      usdRate,
    });

    return NextResponse.json({
      months: [],
      chartMonths: [],
      payments: debt.payments,
      openInstallments: debt.openInstallments,
      openCharges: debt.openCharges,
      summary: {
        currentBalanceArs: debt.currentBalanceArs,
        saldoSnapshotArs: debt.saldoSnapshotArs,
        netDebtArs: debt.netDebtArs,
        currentBalanceUsd: debt.currentBalanceUsd,
        peakBalanceArs: debt.peakBalanceArs,
        totalPaidArs: debt.totalPaidArs,
        totalPaidUsd: debt.totalPaidUsd,
        totalChargesArs: debt.totalChargesArs,
        totalChargesUsd: debt.totalChargesUsd,
        monthCount: 0,
        monthsPaidInFull: 0,
        settled: debt.settled,
        forceSettled: debt.forceSettled,
        private: true,
        mode: debt.mode,
        primaryCardLast4: debt.primaryCardLast4,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}