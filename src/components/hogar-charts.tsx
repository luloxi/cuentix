"use client";

import { useEffect, useMemo, useState } from "react";
import { periodFromDateString } from "@/lib/utils";
import { EmptyState, LoadingBlock, Surface } from "@/components/ui";
import { CategoryLinesChart, TotalSpendChart } from "@/components/spend-charts";
import { LineChart } from "lucide-react";

type Expense = {
  date: string;
  amountCombined: number;
  categorySlug: string;
  categoryName: string;
};

export function HogarCharts() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/stats/compartido?period=all", {
          credentials: "include",
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Error");
        if (!cancelled) setExpenses(data.expenses ?? []);
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Error de red");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const chart = useMemo(() => {
    const byPeriod = new Map<string, number>();
    const catMap = new Map<
      string,
      { slug: string; name: string; byPeriod: Map<string, number>; total: number }
    >();

    for (const e of expenses) {
      const p = periodFromDateString(e.date);
      byPeriod.set(p, (byPeriod.get(p) ?? 0) + e.amountCombined);
      const cur = catMap.get(e.categorySlug) ?? {
        slug: e.categorySlug,
        name: e.categoryName,
        byPeriod: new Map(),
        total: 0,
      };
      cur.byPeriod.set(p, (cur.byPeriod.get(p) ?? 0) + e.amountCombined);
      cur.total += e.amountCombined;
      if (e.categoryName) cur.name = e.categoryName;
      catMap.set(e.categorySlug, cur);
    }

    const periods = [...byPeriod.keys()].sort();
    const totals = periods.map((period) => ({
      period,
      amountArs: byPeriod.get(period) ?? 0,
    }));
    const byCategory = [...catMap.values()]
      .sort((a, b) => b.total - a.total)
      .map((c) => ({
        slug: c.slug,
        name: c.name,
        totalArs: c.total,
        series: periods.map((period) => ({
          period,
          amountArs: c.byPeriod.get(period) ?? 0,
        })),
      }));

    return { periods, totals, byCategory };
  }, [expenses]);

  if (loading) return <LoadingBlock label="Armando gráficos del hogar…" />;
  if (error) {
    return (
      <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40">
        {error}
      </p>
    );
  }
  if (chart.periods.length === 0) {
    return (
      <EmptyState
        icon={<LineChart className="h-7 w-7" />}
        title="Todavía no hay curva del hogar"
        description="Cuando marquen gastos como Hogar, acá se ve cómo viene el mes."
      />
    );
  }

  return (
    <div className="space-y-4">
      <Surface>
        <h3 className="mb-1 text-sm font-semibold tracking-tight">
          Hogar · total por mes
        </h3>
        <p className="mb-3 text-xs text-zinc-500">
          Solo gastos marcados como Hogar (compartidos).
        </p>
        <TotalSpendChart totals={chart.totals} />
      </Surface>
      <Surface>
        <h3 className="mb-1 text-sm font-semibold tracking-tight">
          Hogar · por categoría
        </h3>
        <p className="mb-3 text-xs text-zinc-500">
          Tocá una categoría para mostrarla u ocultarla.
        </p>
        <CategoryLinesChart
          periods={chart.periods}
          byCategory={chart.byCategory}
        />
      </Surface>
    </div>
  );
}
