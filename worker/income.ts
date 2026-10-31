/**
 * Compact port of `periodIncomeEntries` + `sumPeriodIncomeArs`.
 * Variable rows whose label looks like an internal transfer, card payment,
 * or Fiwind refund are skipped with the same phrase list as
 * `isNonIncomeTransferLabel` (accent-folded). USD uses the caller buy rate.
 */

type IncomeRow = {
  date: string;
  label: string;
  kind: string | null;
  frequency: string | null;
  amount_ars: string | null;
  amount_usd: string | null;
};

function num(value: string | null): number {
  if (value == null || value === "") return 0;
  const n = Number(value);
  return Number.isFinite(n) ? Math.abs(n) : 0;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function addDays(ymd: string, days: number): string {
  const [year, month, day] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function foldLabel(label: string): string {
  return label
    .toUpperCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

function skipLabel(label: string): boolean {
  const u = foldLabel(label);
  return (
    u.includes("CUENTA TUYA") ||
    u.includes("CUENTA PROPIA") ||
    u.includes("CAMBIO DE MONEDA") ||
    u.includes("CAMBIO MONEDA") ||
    u.includes("DEBIN") ||
    u.includes("CR TBE") ||
    u.includes("CR TRF") ||
    u.includes("INM COE") ||
    u.includes("PAGO VISA") ||
    u.includes("PAGO MASTER") ||
    u.includes("SU PAGO") ||
    /^DEVOLUCION\b/.test(u.trim())
  );
}

function recurringDates(anchor: string, frequency: string, period: string): string[] {
  const [year, month] = period.split("-").map(Number);
  const last = daysInMonth(year, month);
  const start = `${period}-01`;
  const end = `${period}-${String(last).padStart(2, "0")}`;
  if (anchor > end) return [];
  if (frequency === "mensual") {
    const day = Math.min(Number(anchor.slice(8, 10)) || 1, last);
    const candidate = `${period}-${String(day).padStart(2, "0")}`;
    return candidate >= anchor && candidate <= end ? [candidate] : [];
  }
  const step = frequency === "semanal" ? 7 : frequency === "quincenal" ? 14 : 0;
  if (!step) return [];
  let cursor = anchor;
  const out: string[] = [];
  let guard = 0;
  while (cursor < start && guard < 400) {
    cursor = addDays(cursor, step);
    guard += 1;
  }
  while (cursor <= end && guard < 500) {
    if (cursor >= anchor) out.push(cursor);
    cursor = addDays(cursor, step);
    guard += 1;
  }
  return out;
}

export function sumIncomeArs(rows: IncomeRow[], period: string, buyRate: number): number {
  let total = 0;
  for (const row of rows) {
    const kind = row.kind === "recurring" ? "recurring" : "variable";
    if (kind === "variable") {
      if (!row.date.startsWith(period)) continue;
      if (skipLabel(row.label)) continue;
      total += num(row.amount_ars);
      if (buyRate > 0) total += num(row.amount_usd) * buyRate;
      continue;
    }
    const frequency = row.frequency ?? "";
    const dates = recurringDates(row.date, frequency, period);
    if (dates.length === 0) continue;
    total += dates.length * num(row.amount_ars);
    if (buyRate > 0) total += dates.length * num(row.amount_usd) * buyRate;
  }
  return total;
}
