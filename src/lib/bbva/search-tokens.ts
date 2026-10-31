/**
 * BBVA ticket tokens for Consumos search.
 * Kept out of src/lib/transactions.ts so the Worker does not pull Drizzle.
 */

function foldSearchQuery(s: string): string {
  return s
    .toUpperCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * When someone searches `CR TBE` / `CR TRF` / `INM COE`, match Transferencia
 * interna rows even if the stored description was rewritten.
 */
export function queryMatchesBbvaInternalTransferTokens(q: string): boolean {
  const u = foldSearchQuery(q);
  if (!u) return false;
  if (/\bCR\s+(TBE|TRF)\b/.test(u)) return true;
  if (/\bINM\s+COE\b/.test(u)) return true;
  return false;
}
