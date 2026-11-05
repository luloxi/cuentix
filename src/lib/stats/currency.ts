/** Currencies that are never converted and never added together. */
export const CURRENCIES = ["ARS", "USDT", "USD"] as const;
export type Currency = (typeof CURRENCIES)[number];

export const GRANULARITIES = ["day", "week", "month", "all"] as const;
export type Granularity = (typeof GRANULARITIES)[number];

export function isCurrency(value: string | null | undefined): value is Currency {
  return value === "ARS" || value === "USDT" || value === "USD";
}

export function isGranularity(value: string | null | undefined): value is Granularity {
  return value === "day" || value === "week" || value === "month" || value === "all";
}
