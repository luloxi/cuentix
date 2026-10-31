/**
 * Month-end USD buy rates for converting card USD spends to ARS.
 *
 * BBVA compra tracks the official retail buy band. Public historical BBVA
 * bank quotes are not reliably available, so we use:
 *  1) Bluelytics "Oficial" value_buy (daily) → last available day of each month
 *  2) BCRA reference rate as fallback for older months
 *
 * Current / incomplete month: latest available buy rate.
 */

export type MonthEndRate = {
  period: string; // YYYY-MM
  /** Buy rate ARS per 1 USD */
  buy: number;
  /** ISO date the rate corresponds to */
  asOf: string;
  source: "oficial_compra" | "bcra" | "fallback";
};

type DayRate = { date: string; buy: number; source: MonthEndRate["source"] };

const cache = new Map<string, { at: number; rates: Map<string, MonthEndRate> }>();
const CACHE_MS = 6 * 60 * 60 * 1000; // 6h

function lastDayOfMonth(period: string): string {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(Date.UTC(y!, m!, 0)); // day 0 of next month = last of m
  return d.toISOString().slice(0, 10);
}

async function fetchBluelyticsDays(): Promise<DayRate[]> {
  try {
    const res = await fetch(
      "https://api.bluelytics.com.ar/v2/evolution.json?days=400",
      { next: { revalidate: 3600 } },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as Array<{
      date: string;
      source: string;
      value_buy: number;
      value_sell: number;
    }>;
    return data
      .filter((r) => r.source === "Oficial" && r.value_buy > 0)
      .map((r) => ({
        date: r.date.slice(0, 10),
        buy: Number(r.value_buy),
        source: "oficial_compra" as const,
      }));
  } catch {
    return [];
  }
}

async function fetchBcraRange(
  from: string,
  to: string,
): Promise<DayRate[]> {
  try {
    const url = `https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones/USD?fechadesde=${from}&fechahasta=${to}`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      next: { revalidate: 3600 },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      results?: Array<{
        fecha: string;
        detalle: Array<{ tipoCotizacion: number }>;
      }>;
    };
    return (data.results ?? [])
      .map((r) => {
        const buy = Number(r.detalle?.[0]?.tipoCotizacion);
        if (!buy || buy <= 0) return null;
        return {
          date: r.fecha.slice(0, 10),
          buy,
          source: "bcra" as const,
        };
      })
      .filter(Boolean) as DayRate[];
  } catch {
    return [];
  }
}

function pickForPeriod(
  period: string,
  days: DayRate[],
): MonthEndRate | null {
  const inMonth = days
    .filter((d) => d.date.startsWith(period))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (inMonth.length === 0) return null;
  const last = inMonth[inMonth.length - 1]!;
  return {
    period,
    buy: last.buy,
    asOf: last.date,
    source: last.source,
  };
}

/**
 * Resolve month-end buy rates for the given YYYY-MM periods.
 */
export async function getMonthEndBuyRates(
  periods: string[],
): Promise<Map<string, MonthEndRate>> {
  const unique = [...new Set(periods.filter(Boolean))].sort();
  if (unique.length === 0) return new Map();

  const cacheKey = unique.join(",");
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_MS) {
    return hit.rates;
  }

  const blue = await fetchBluelyticsDays();

  // BCRA for periods not covered by bluelytics
  let bcra: DayRate[] = [];
  const needBcra = unique.filter((p) => {
    if (blue.length === 0) return true;
    return !blue.some((d) => d.date.startsWith(p));
  });
  if (needBcra.length > 0) {
    const from = `${needBcra[0]}-01`;
    const lastP = needBcra[needBcra.length - 1]!;
    const to = lastDayOfMonth(lastP);
    bcra = await fetchBcraRange(from, to);
  }

  // Prefer oficial_compra over bcra when both exist for a day
  const byDate = new Map<string, DayRate>();
  for (const d of bcra) byDate.set(d.date, d);
  for (const d of blue) byDate.set(d.date, d); // overwrite with better source
  const allDays = [...byDate.values()];

  const result = new Map<string, MonthEndRate>();
  const sortedAll = allDays.sort((a, b) => a.date.localeCompare(b.date));
  const latestGlobal = sortedAll[sortedAll.length - 1] ?? null;

  for (const period of unique) {
    let rate = pickForPeriod(period, allDays);
    if (!rate && latestGlobal) {
      // Incomplete month or missing data: use latest known rate
      rate = {
        period,
        buy: latestGlobal.buy,
        asOf: latestGlobal.date,
        source: latestGlobal.source,
      };
    }
    if (!rate) {
      // Last resort static fallback so UI still works offline
      rate = {
        period,
        buy: 1400,
        asOf: lastDayOfMonth(period),
        source: "fallback",
      };
    }
    result.set(period, rate);
  }

  cache.set(cacheKey, { at: Date.now(), rates: result });
  return result;
}

export function convertUsdToArs(usd: number, buyRate: number): number {
  if (!Number.isFinite(usd) || !Number.isFinite(buyRate)) return 0;
  return Math.abs(usd) * buyRate;
}

export function formatRateSource(r: MonthEndRate): string {
  if (r.source === "oficial_compra") return "oficial compra";
  if (r.source === "bcra") return "BCRA";
  return "estimada";
}
