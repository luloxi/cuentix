/**
 * Pure helpers for hogar-service reimbursements (rent/utilities already paid
 * by a roommate). Client-safe — no DB, no env, no next/headers imports.
 * Payee groups are passed in by the caller. UI must not echo full legal names.
 */

import { isInternalTransferDescription } from "@/lib/bbva/bank-entries";
import { isHogarUtilitySlug } from "@/lib/gasto-cubierto";

/**
 * Roommate payee(s) who front rent/utilities, configured per deployment so no
 * real names live in the repo. Format: comma-separated groups; inside a group
 * join the name tokens with "+" (all must appear). Example:
 *   REINTEGRO_PAYEES="ANA+PEREZ,ANITA"
 * Empty/unset = feature off. The server / Worker parses this; this module
 * does not read the environment.
 */
export function parseReintegroPayees(raw: string | undefined | null): string[][] {
  return String(raw ?? "")
    .toUpperCase()
    .split(",")
    .map((g) =>
      g
        .split("+")
        .map((t) => t.replace(/[^A-Z0-9]/g, ""))
        .filter(Boolean),
    )
    .filter((g) => g.length > 0);
}

/** Outbound person payment / transfer prefixes (Fiwind + similar). */
const OUTBOUND_PAY_PREFIX =
  /^(RETIRO|PAGO|TRANSFERENCIA|TRANSFER|ENVIO)\s+A\b/;

function normalizeKey(description: string): string {
  return description
    .toUpperCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True when the description looks like a payment to the roommate who often
 * fronts alquiler/luz/agua/internet — those must not double-count in Hogar.
 * Outbound-prefix variant only (not a bare payee line).
 */
export function looksLikeHogarReintegroPayee(
  description: string,
  groups: string[][],
): boolean {
  const key = normalizeKey(description);
  if (!key) return false;
  if (!OUTBOUND_PAY_PREFIX.test(key)) return false;
  return groups.some((g) =>
    g.every((t) => new RegExp(`\\b${t}\\b`).test(key)),
  );
}

/**
 * Exports sometimes list the roommate payee alone (no "Retiro a" / "Pago a"
 * prefix). Still a hogar-service reimbursement. Requires the whole
 * description to be that payee (plus optional surnames) — not "… en el super".
 */
export function looksLikeBareHogarReintegroPayee(
  description: string,
  groups: string[][],
): boolean {
  const key = normalizeKey(description);
  if (!key) return false;
  if (OUTBOUND_PAY_PREFIX.test(key)) return false;
  for (const g of groups) {
    const head = g.join(" ");
    if (key === head) return true;
    if (g.length < 2 || !key.startsWith(head + " ")) continue;
    const after = key.slice(head.length).trim();
    if (
      /\b(EN|EL|LA|LOS|LAS|DE|DEL|AL|SUPER|MARKET|TIENDA|FARMAC|STEAM|PAGO|RETIRO|UNA|CUENTA)\b/.test(
        after,
      )
    ) {
      continue;
    }
    if (after.split(" ").every((t) => t.length >= 3)) return true;
  }
  return false;
}

/** Outbound-prefix OR bare-payee hogar reintegro description. */
export function isHogarReintegroDescription(
  description: string,
  groups: string[][],
): boolean {
  return (
    looksLikeHogarReintegroPayee(description, groups) ||
    looksLikeBareHogarReintegroPayee(description, groups)
  );
}

/**
 * Card payments / internal transfers (isPayment) stay out of Consumos.
 * Exceptions that stay visible (still out of neta via isPayment):
 * - Hogar-service reintegros → Tipo "Reintegro hogar" (`reintegroHogar` flag)
 * - Utility bills marked cubierto → Tipo "Cubierto"
 */
export function isConsumosHiddenPayment(
  isPayment: boolean,
  descriptionNormalized: string,
  categorySlug?: string | null,
  reintegroHogar = false,
): boolean {
  if (!isPayment) return false;
  if (reintegroHogar) return false;
  if (isHogarUtilitySlug(categorySlug)) return false;
  // Rainman: Transferencia interna stays visible (out of neta) like Cubierto —
  // by category slug OR description (CR TBE / cuenta tuya) if category never seeded.
  if ((categorySlug ?? "").trim().toLowerCase() === "transferencia-interna") {
    return false;
  }
  if (isInternalTransferDescription(descriptionNormalized)) return false;
  return true;
}

/** True when Tipo should show "Reintegro hogar". The flag comes from the server. */
export function isReintegroHogarTipo(
  isPayment: boolean,
  reintegroHogar: boolean,
): boolean {
  return isPayment && reintegroHogar;
}

/** Same payee key for bulk “Aplicar a N” (exact normalized description). */
export function sameHogarReintegroKey(a: string, b: string): boolean {
  const ka = normalizeKey(a);
  const kb = normalizeKey(b);
  return Boolean(ka) && ka === kb;
}

export function countHogarReintegroMatches(
  rows: Array<{
    id: string;
    descriptionNormalized: string;
    isPayment?: boolean;
  }>,
  description: string,
  groups: string[][],
  opts?: { excludeTxId?: string; onlyUnset?: boolean },
): number {
  const key = normalizeKey(description);
  if (!key || !looksLikeHogarReintegroPayee(description, groups)) return 0;
  let n = 0;
  for (const tx of rows) {
    if (opts?.excludeTxId && tx.id === opts.excludeTxId) continue;
    if (normalizeKey(tx.descriptionNormalized) !== key) continue;
    if (opts?.onlyUnset && tx.isPayment) continue;
    n++;
  }
  return n;
}

export { normalizeKey as normalizeHogarReintegroKey };
