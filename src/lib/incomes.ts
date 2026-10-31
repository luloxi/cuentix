import { isNonIncomeTransferLabel } from "@/lib/bbva/bank-entries";
import { periodFromDateString } from "@/lib/utils";

export type IncomeKind = "recurring" | "variable";
export type IncomeFrequency = "mensual" | "quincenal" | "semanal";

export const INCOME_FREQUENCIES: Array<{
  id: IncomeFrequency;
  label: string;
  hint: string;
}> = [
  { id: "mensual", label: "Mensual", hint: "Una vez al mes" },
  { id: "quincenal", label: "Quincenal", hint: "Cada 14 días" },
  { id: "semanal", label: "Semanal", hint: "Cada 7 días" },
];

export function isIncomeFrequency(v: unknown): v is IncomeFrequency {
  return v === "mensual" || v === "quincenal" || v === "semanal";
}

export function isIncomeKind(v: unknown): v is IncomeKind {
  return v === "recurring" || v === "variable";
}

function parseYmd(date: string): { y: number; m: number; d: number } | null {
  const m = date.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

function formatYmd(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function daysInMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}

function addDays(ymd: string, days: number): string {
  const p = parseYmd(ymd);
  if (!p) return ymd;
  const dt = new Date(Date.UTC(p.y, p.m - 1, p.d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return formatYmd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

function cmpYmd(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function periodBounds(period: string): { start: string; end: string } | null {
  const m = period.trim().match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (!y || mo < 1 || mo > 12) return null;
  const last = daysInMonth(y, mo);
  return { start: formatYmd(y, mo, 1), end: formatYmd(y, mo, last) };
}

/**
 * Fechas esperadas de un sueldo recurrente dentro de un período YYYY-MM.
 * `anchorDate` = primera fecha de cobro (o desde cuándo aplica).
 * No inventa cobros antes del ancla.
 */
export function expandRecurringDatesForPeriod(
  anchorDate: string,
  frequency: IncomeFrequency,
  period: string,
): string[] {
  const bounds = periodBounds(period);
  const anchor = parseYmd(anchorDate);
  if (!bounds || !anchor) return [];

  const out: string[] = [];

  if (frequency === "mensual") {
    const [py, pm] = period.split("-").map(Number);
    const day = Math.min(anchor.d, daysInMonth(py, pm));
    const candidate = formatYmd(py, pm, day);
    if (cmpYmd(candidate, anchorDate) >= 0 && cmpYmd(candidate, bounds.end) <= 0) {
      out.push(candidate);
    }
    return out;
  }

  const step = frequency === "semanal" ? 7 : 14;
  let cur = anchorDate;
  while (cmpYmd(cur, bounds.start) < 0) {
    cur = addDays(cur, step);
  }
  while (cmpYmd(cur, bounds.end) <= 0) {
    if (cmpYmd(cur, anchorDate) >= 0) out.push(cur);
    cur = addDays(cur, step);
  }
  return out;
}

export type IncomeLike = {
  date: string;
  kind?: string | null;
  frequency?: string | null;
  amountArs?: string | number | null;
  amountUsd?: string | number | null;
};

export type PeriodIncomeEntry = {
  date: string;
  label: string;
  amountArs: number | null;
  amountUsd: number | null;
  kind: IncomeKind;
  frequency: IncomeFrequency | null;
  sourceId: string;
  /** true = generado desde sueldo recurrente, no es un cobro cargado a mano */
  expected: boolean;
};

function num(v: string | number | null | undefined): number | null {
  if (v == null || v === "") return null;
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : null;
}

/** Armá la lista honesta del mes: variables del período + esperados de recurrentes. */
export function periodIncomeEntries(
  rows: Array<
    IncomeLike & {
      id: string;
      label: string;
    }
  >,
  period: string,
): PeriodIncomeEntry[] {
  const entries: PeriodIncomeEntry[] = [];

  for (const r of rows) {
    const kind: IncomeKind =
      r.kind === "recurring" ? "recurring" : "variable";

    if (kind === "variable") {
      // Rainman: never treat self-transfer / FX / DEBIN as Ingresos Variables
      if (isNonIncomeTransferLabel(r.label)) continue;
      if (periodFromDateString(r.date) !== period) continue;
      entries.push({
        date: r.date,
        label: r.label,
        amountArs: num(r.amountArs),
        amountUsd: num(r.amountUsd),
        kind: "variable",
        frequency: null,
        sourceId: r.id,
        expected: false,
      });
      continue;
    }

    if (!isIncomeFrequency(r.frequency)) continue;
    const dates = expandRecurringDatesForPeriod(r.date, r.frequency, period);
    for (const date of dates) {
      entries.push({
        date,
        label: r.label,
        amountArs: num(r.amountArs),
        amountUsd: num(r.amountUsd),
        kind: "recurring",
        frequency: r.frequency,
        sourceId: r.id,
        expected: true,
      });
    }
  }

  entries.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return entries;
}

/** Suma ARS del período (USD convertido con buyRate). */
export function sumPeriodIncomeArs(
  rows: Array<
    IncomeLike & {
      id: string;
      label: string;
    }
  >,
  period: string,
  convertUsdToArs: (usd: number, buy: number) => number,
  buyRate: number,
): number {
  let total = 0;
  for (const e of periodIncomeEntries(rows, period)) {
    if (e.amountArs != null) total += Math.abs(e.amountArs);
    if (e.amountUsd != null) {
      total += convertUsdToArs(Math.abs(e.amountUsd), buyRate);
    }
  }
  return total;
}

export function frequencyLabel(f: IncomeFrequency | null | undefined): string {
  if (f === "mensual") return "Mensual";
  if (f === "quincenal") return "Quincenal (cada 14 días)";
  if (f === "semanal") return "Semanal";
  return "";
}

/**
 * Monthly ARS totals for the ingresos evolution chart.
 * Expands recurring salaries into each month that appears in `periods`
 * (or inferred from variable rows + the last 12 calendar months).
 */
export function monthlyIncomeEvolution(
  rows: Array<
    IncomeLike & {
      id: string;
      label: string;
    }
  >,
  opts?: { periods?: string[]; months?: number },
): Array<{ period: string; amountArs: number }> {
  const months = opts?.months ?? 12;
  let periods = opts?.periods ? [...opts.periods] : [];

  if (periods.length === 0) {
    const set = new Set<string>();
    for (const r of rows) {
      if (r.kind === "recurring") continue;
      set.add(periodFromDateString(r.date));
    }
    // Always include recent calendar months so recurrentes show up.
    const now = new Date();
    for (let i = 0; i < months; i++) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      const p = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      set.add(p);
    }
    periods = [...set].sort();
  } else {
    periods = [...periods].sort();
  }

  // Keep last N periods for a readable chart
  if (periods.length > months) {
    periods = periods.slice(periods.length - months);
  }

  return periods.map((period) => {
    let amountArs = 0;
    for (const e of periodIncomeEntries(rows, period)) {
      if (e.amountArs != null && Number.isFinite(e.amountArs)) {
        amountArs += Math.abs(e.amountArs);
      }
      // USD-only cobros: count nominal USD so the series is not a flat zero.
      // (FX conversion lives elsewhere; chart is shape-first.)
      if (
        (e.amountArs == null || e.amountArs === 0) &&
        e.amountUsd != null &&
        Number.isFinite(e.amountUsd)
      ) {
        amountArs += Math.abs(e.amountUsd);
      }
    }
    return { period, amountArs };
  });
}