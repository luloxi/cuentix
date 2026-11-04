import { extractFiwindMerchant, foldFiwind } from "./import/fiwind";

/** At most this many exact `description_normalized` strings per lookup. */
export const FIWIND_VARIANT_CAP = 8;

const TITLE_PREFIXES = [
  "Pago a ",
  "Cargo extra de ",
  "Devolución de ",
  "Devolucion de ",
  "Retiro a ",
] as const;

const UPPER_PREFIXES = [
  "PAGO A ",
  "CARGO EXTRA DE ",
  "DEVOLUCIÓN DE ",
  "DEVOLUCION DE ",
  "RETIRO A ",
] as const;

function collapse(value: string): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Merchant text as stored (case and accents kept).
 * `extractFiwindMerchant` peels “Pago a / Cargo extra de / Devolución de”.
 * “Retiro a X” is the same counterparty, so that prefix is peeled too.
 */
export function fiwindMerchantStored(description: string): string {
  const once = extractFiwindMerchant(collapse(description));
  const withoutRetiro = once.replace(/^retiro a\s+/i, "");
  return extractFiwindMerchant(withoutRetiro);
}

/** `foldFiwind(extractFiwindMerchant(...))`, with “Retiro a” peeled first. */
export function counterpartyKey(description: string): string {
  return foldFiwind(fiwindMerchantStored(description));
}

function pushUnique(out: string[], value: string): void {
  const text = collapse(value);
  if (!text || out.includes(text) || out.length >= FIWIND_VARIANT_CAP) return;
  out.push(text);
}

/**
 * Exact strings that may be stored in `description_normalized` for this
 * counterparty. Equality on that column can use `tx_household_desc_idx`.
 * The set is the original, the title-case prefixes, the Devolución/Devolucion
 * accent pair, and uppercase prefix forms. Merchant case/accents on the
 * selected row are kept, and the folded merchant is added when it differs.
 */
export function similarDescriptionVariants(description: string): string[] {
  const original = collapse(description);
  if (!original) return [];
  const merchant = fiwindMerchantStored(original);
  if (!merchant) return [original];
  const folded = foldFiwind(merchant);
  const out: string[] = [];
  pushUnique(out, original);
  for (const prefix of TITLE_PREFIXES) pushUnique(out, prefix + merchant);
  if (folded !== merchant) {
    for (const prefix of TITLE_PREFIXES) pushUnique(out, prefix + folded);
  }
  for (const prefix of UPPER_PREFIXES) pushUnique(out, prefix + folded);
  return out;
}
