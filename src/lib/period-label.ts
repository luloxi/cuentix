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
