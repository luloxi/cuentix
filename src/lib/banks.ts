/** Bancos / medios de pago habituales en AR. */
export const BANKS = [
  "BBVA",
  "Fiwind",
  "Galicia",
  "Santander",
  "Macro",
  "Nación",
  "Provincia",
  "ICBC",
  "HSBC",
  "Brubank",
  "Mercado Pago",
  "Ualá",
  "Naranja X",
  "Efectivo",
  "Otro",
] as const;

export type BankName = (typeof BANKS)[number];

export function normalizeBank(value: string | null | undefined): string | null {
  if (!value) return null;
  const t = value.trim();
  if (!t) return null;
  const hit = BANKS.find((b) => b.toLowerCase() === t.toLowerCase());
  return hit ?? t;
}
