"use client";

import { useEffect, useState } from "react";
import { DashboardHome } from "@/components/dashboard-home";
import { SoonPage } from "@/components/soon-page";
import { currentPeriodAr } from "@/lib/utils";

type DashboardData = {
  firstName: string;
  period: string;
  prevPeriod: string;
  totalArs: number;
  prevTotalArs: number;
  sharedTotalArs: number;
  sharedPrevTotalArs: number;
  debtBalanceArs: number;
  debtSettled: boolean;
  debtActiveCard?: boolean;
  monthTxCount: number;
  categorySummary: Array<{ id: string; slug: string; name: string; total: number; pct: number }>;
  householdServices: Array<{ slug: string; name: string; paid: boolean }>;
  liveRates: Array<{
    id: "blue" | "bbva" | "usdc";
    label: string;
    value: number | null;
    buy?: number | null;
    sell?: number | null;
    spread?: number | null;
    hint?: string;
  }>;
  savingsArs: number;
  savingsUsd: number;
  savingsUsdc: number;
  savingsNetArs: number;
  incomeArs: number;
  householdName?: string;
  error?: string;
};

export function DashboardLoader() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missingHome, setMissingHome] = useState(false);

  useEffect(() => {
    let cancelled = false;
    function load() {
      const period = currentPeriodAr();
      void fetch(`/api/dashboard?period=${period}`, { credentials: "include" })
        .then(async (res) => {
          const body = (await res.json().catch(() => null)) as DashboardData | null;
          if (cancelled) return;
          if (res.status === 401) {
            window.location.replace("/login");
            return;
          }
          if (res.status === 400 && body?.error === "NO_HOUSEHOLD") {
            setMissingHome(true);
            return;
          }
          if (!res.ok || !body) {
            setError(body?.error || `Error ${res.status}`);
            return;
          }
          setMissingHome(false);
          setError(null);
          setData(body);
        })
        .catch((err: unknown) => {
          if (!cancelled) setError(err instanceof Error ? err.message : "Error de red");
        });
    }
    load();
    window.addEventListener("lc:household-switched", load);
    window.addEventListener("lc:expense-created", load);
    return () => {
      cancelled = true;
      window.removeEventListener("lc:household-switched", load);
      window.removeEventListener("lc:expense-created", load);
    };
  }, []);

  if (missingHome) return <SoonPage title="Tu espacio" />;
  if (error) {
    return <p className="text-sm text-red-600">{error}</p>;
  }
  if (!data) {
    return <p className="text-sm text-[var(--muted-fg)]">Cargando inicio…</p>;
  }
  return (
    <DashboardHome
      firstName={data.firstName}
      period={data.period}
      prevPeriod={data.prevPeriod}
      totalArs={data.totalArs}
      prevTotalArs={data.prevTotalArs}
      sharedTotalArs={data.sharedTotalArs}
      sharedPrevTotalArs={data.sharedPrevTotalArs}
      debtBalanceArs={data.debtBalanceArs}
      debtSettled={data.debtSettled}
      debtActiveCard={data.debtActiveCard}
      monthTxCount={data.monthTxCount}
      categorySummary={data.categorySummary}
      householdServices={data.householdServices}
      liveRates={data.liveRates}
      savingsArs={data.savingsArs}
      savingsUsd={data.savingsUsd}
      savingsUsdc={data.savingsUsdc}
      savingsNetArs={data.savingsNetArs}
      incomeArs={data.incomeArs}
      householdName={data.householdName}
    />
  );
}
