export type LiveRate = {
  id: "blue" | "bbva" | "usdc";
  label: string;
  value: number | null;
  buy?: number | null;
  sell?: number | null;
  spread?: number | null;
  hint?: string;
};

type FxCache = {
  at: number;
  byDate: Map<string, number>;
  live: LiveRate[];
  blue: number | null;
};

let cache: FxCache | null = null;
const TTL_MS = 5 * 60 * 1000;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function num(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Official buy history (Bluelytics) plus the three live quotes the home
 * screen shows. Cached on the isolate. A miss is network (wall time); the
 * SQL that follows does not wait on a second fetch. If the network fails,
 * USD legs stay unconverted (rate 0) instead of failing the page.
 */
export async function loadFx(): Promise<FxCache> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache;
  const [history, blueRaw, oficialRaw, usdc] = await Promise.all([
    fetchHistory(),
    fetchJson("https://dolarapi.com/v1/dolares/blue"),
    fetchJson("https://dolarapi.com/v1/dolares/oficial"),
    fetchJson("https://api.comparadolar.ar/usd"),
  ]);
  const blue = asRecord(blueRaw);
  const oficial = asRecord(oficialRaw);
  const blueBuy = num(blue?.compra);
  const blueSell = num(blue?.venta);
  const oficialBuy = num(oficial?.compra);
  const usdcAsk = usdcFrom(usdc);
  const live: LiveRate[] = [
    {
      id: "blue",
      label: "Blue",
      value: blueSell,
      buy: blueBuy,
      sell: blueSell,
      spread: blueBuy != null && blueSell != null ? blueSell - blueBuy : null,
      hint: "venta",
    },
    {
      id: "bbva",
      label: "BBVA",
      value: oficialBuy,
      buy: oficialBuy,
      hint: "oficial compra",
    },
    {
      id: "usdc",
      label: "USDC",
      value: usdcAsk,
      hint: "Fiwind",
    },
  ];
  cache = {
    at: Date.now(),
    byDate: history,
    live,
    blue: blueSell ?? blueBuy,
  };
  return cache;
}

export function monthEndBuy(fx: FxCache, period: string): number {
  const prefix = `${period}-`;
  let best = "";
  let buy = 0;
  for (const [date, value] of fx.byDate) {
    if (date.startsWith(prefix) && date >= best) {
      best = date;
      buy = value;
    }
  }
  if (buy > 0) return buy;
  let latest = "";
  let latestBuy = 0;
  for (const [date, value] of fx.byDate) {
    if (date > latest) {
      latest = date;
      latestBuy = value;
    }
  }
  return latestBuy;
}

async function fetchHistory(): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const data = await fetchJson("https://api.bluelytics.com.ar/v2/evolution.json?days=400");
  if (!Array.isArray(data)) return map;
  for (const row of data) {
    if (!row || typeof row !== "object") continue;
    const rec = row as { date?: string; source?: string; value_buy?: number };
    if (rec.source !== "Oficial") continue;
    const buy = num(rec.value_buy);
    if (!buy || !rec.date) continue;
    map.set(rec.date.slice(0, 10), buy);
  }
  return map;
}

function usdcFrom(data: unknown): number | null {
  if (!Array.isArray(data)) return null;
  for (const row of data) {
    if (!row || typeof row !== "object") continue;
    const rec = row as { slug?: string; ask?: number };
    if (rec.slug === "fiwind-cripto") return num(rec.ask);
  }
  return null;
}

async function fetchJson(url: string): Promise<Record<string, unknown> | unknown[] | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown> | unknown[];
  } catch {
    return null;
  }
}
