import type { Currency } from "./sql";

export function formatMoney(amount: number, currency: string): string {
  const formatted = new Intl.NumberFormat("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
  return `${formatted} ${currency}`;
}

export function formatDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

export function formatMonth(isoMonth: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(isoMonth);
  if (!match) return isoMonth;
  return `${match[2]}/${match[1]}`;
}

/** Accepts 1961.41, 1961,41, and 1.961,41. */
export function parseAmountInput(raw: string): number | null {
  const trimmed = raw.trim().replace(/\s/g, "");
  if (!trimmed) return null;
  let normalized = trimmed;
  if (normalized.includes(",") && normalized.includes(".")) {
    if (normalized.lastIndexOf(",") > normalized.lastIndexOf(".")) {
      normalized = normalized.replace(/\./g, "").replace(",", ".");
    } else {
      normalized = normalized.replace(/,/g, "");
    }
  } else if (normalized.includes(",")) {
    normalized = normalized.replace(",", ".");
  }
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

export const CURRENCY_LIST: Currency[] = ["ARS", "USDT", "USD"];

export function kindLabel(kind: string): string {
  if (kind === "expense") return "Gasto";
  if (kind === "income") return "Ingreso";
  if (kind === "internal_transfer") return "Transferencia interna";
  return kind;
}

export function sourceLabel(source: string): string {
  if (source === "manual") return "Manual";
  if (source === "routine") return "Rutina";
  return source;
}
