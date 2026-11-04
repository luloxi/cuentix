/** Format YYYY-MM as "julio 2026" (es-AR). */
export function formatPeriodLabel(period: string): string {
  const [y, m] = period.split("-").map(Number);
  if (!y || !m) return period;
  const d = new Date(y, m - 1, 1);
  return new Intl.DateTimeFormat("es-AR", {
    month: "long",
    year: "numeric",
  }).format(d);
}

/** Short label: "jul 26" */
export function formatPeriodShort(period: string): string {
  const [y, m] = period.split("-").map(Number);
  if (!y || !m) return period;
  const d = new Date(y, m - 1, 1);
  return new Intl.DateTimeFormat("es-AR", {
    month: "short",
    year: "2-digit",
  }).format(d);
}

/** YYYY-MM of today in America/Argentina/Buenos_Aires. */
export function currentCalendarMonth(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const y = parts.find((x) => x.type === "year")?.value ?? "";
  const m = parts.find((x) => x.type === "month")?.value ?? "";
  return `${y}-${m}`;
}

/** True when period is the in-progress calendar month (not comparable to a full previous month). */
export function isCurrentCalendarMonth(period: string, now = new Date()): boolean {
  return period === currentCalendarMonth(now);
}

const YEAR_MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** True for a calendar month `YYYY-MM`. */
export function isYearMonth(value: string | null | undefined): value is string {
  return Boolean(value && YEAR_MONTH.test(value));
}

/**
 * Honor a selected `?period=YYYY-MM`. Anything else (missing, `all`, junk)
 * falls back to the current calendar month.
 */
export function selectedPeriod(
  raw: string | null | undefined,
  fallback: string,
): string {
  return isYearMonth(raw) ? raw : fallback;
}

/** `count` months ending at `from`, newest first. */
export function recentPeriods(from: string, count = 24): string[] {
  if (!isYearMonth(from) || count <= 0) return [];
  const out: string[] = [];
  const [year, month] = from.split("-").map(Number);
  let y = year!;
  let m = month!;
  for (let i = 0; i < count; i++) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m -= 1;
    if (m < 1) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}

/** Period dropdown options: recent months plus the current selection. */
export function periodSelectOptions(
  selected: string,
  from: string,
  count = 24,
): string[] {
  const set = new Set(recentPeriods(from, count));
  if (isYearMonth(selected)) set.add(selected);
  return [...set].sort().reverse();
}
