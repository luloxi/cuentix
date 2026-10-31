/** Calendar YYYY-MM-DD. Rejects 2026-02-31 and anything with a time zone. */
export function isCalendarDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

const AMOUNT_RE = /^-?(?:\d+|\d+\.\d+)$/;
/** Reject junk that would become Infinity or wipe a stored amount. */
const MAX_AMOUNT = 1_000_000_000_000;

export function parseExpenseAmount(
  value: unknown,
): { ok: true; amount: number | null } | { ok: false } {
  if (value == null || value === "") return { ok: true, amount: null };
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Math.abs(value) > MAX_AMOUNT) return { ok: false };
    return { ok: true, amount: Math.abs(value) };
  }
  if (typeof value !== "string") return { ok: false };
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, amount: null };
  if (!AMOUNT_RE.test(trimmed)) return { ok: false };
  const n = Number(trimmed);
  if (!Number.isFinite(n) || Math.abs(n) > MAX_AMOUNT) return { ok: false };
  return { ok: true, amount: Math.abs(n) };
}

/** TEXT money with 2 decimal places so fingerprints do not drift on "10" vs "10.00". */
export function expenseAmountText(amount: number | null): string | null {
  if (amount == null) return null;
  const cents = Math.round(amount * 100);
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.trunc(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  return `${sign}${whole}.${frac}`;
}

export function manualFingerprintMaterial(input: {
  householdId: string;
  date: string;
  description: string;
  amountArs: string | null;
  amountUsd: string | null;
}): string {
  const description = input.description.trim().replace(/\s+/g, " ");
  return [
    "manual",
    input.householdId,
    input.date,
    description,
    input.amountArs ?? "",
    input.amountUsd ?? "",
  ].join("|");
}
