import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Pesos argentinos — always with $ and es-AR separators */
export function formatArs(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * Dólares — never bare "$" alone (confusable with pesos).
 * Shows "USD 24,00" so it's obvious on mobile.
 */
export function formatUsd(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  const n = new Intl.NumberFormat("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
  return `USD ${n}`;
}

/**
 * Format a calendar date without timezone shift.
 * `new Date("2026-08-01")` is UTC midnight → previous day in AR (UTC-3).
 * We parse YYYY-MM-DD as a pure local calendar date.
 */
export function formatDateAr(date: Date | string | null | undefined): string {
  if (!date) return "—";
  if (typeof date === "string") {
    const m = date.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) {
      return `${m[3]}/${m[2]}/${m[1]}`;
    }
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return "—";
    return new Intl.DateTimeFormat("es-AR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: "UTC",
    }).format(d);
  }
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

/** Calendar period YYYY-MM from a stored date string (no TZ). */
export function periodFromDateString(date: string): string {
  const m = date.trim().match(/^(\d{4})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}` : date.slice(0, 7);
}

export function periodFromDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/** Current calendar month in America/Argentina/Buenos_Aires. */
export function currentPeriodAr(): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Argentina/Buenos_Aires",
      year: "numeric",
      month: "2-digit",
    }).formatToParts(new Date());
    const y = parts.find((p) => p.type === "year")?.value;
    const mo = parts.find((p) => p.type === "month")?.value;
    if (y && mo) return `${y}-${mo}`;
  } catch {
    /* fall through */
  }
  return periodFromDate(new Date());
}

/** Hoy como YYYY-MM-DD en America/Argentina/Buenos_Aires. */
export function todayDateAr(): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Argentina/Buenos_Aires",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const y = parts.find((p) => p.type === "year")?.value;
    const mo = parts.find((p) => p.type === "month")?.value;
    const d = parts.find((p) => p.type === "day")?.value;
    if (y && mo && d) return `${y}-${mo}-${d}`;
  } catch {
    /* fall through */
  }
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}
