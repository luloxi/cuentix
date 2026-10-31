/**
 * BBVA period xls files list every card on the account (titular + adicionales).
 * The owner only wants their own card imported — mixing the other card invents
 * someone else's supermarket / cuotas as his debt and gastos.
 */

export type CardTagged = {
  descriptionNormalized: string;
  cardLast4?: string | null;
};

/** Merchants that identify the owner's card in BBVA statements (tech + bici). */
export const PRIMARY_CARD_HINT_RE =
  /\b(?:TEMBICI|ECOBICI|GROK|XAI|RAILWAY|DIGITALOCEAN|VULTR|X\s*CORP|OPENAI|GITHUB|VERCEL|PAYU\*AR\*UBER)\b/i;

export function normalizeCardLast4(
  raw: string | null | undefined,
): string | null {
  if (raw == null) return null;
  const m = String(raw).match(/(\d{4})\s*$/);
  return m ? m[1] : null;
}

export function extractCardLast4FromTotal(text: string): string | null {
  const m = String(text).match(
    /total\s+tarjeta\s+nro\.?\s*\*{0,8}(\d{4})/i,
  );
  return m ? m[1] : null;
}

export function cardLast4s<T extends CardTagged>(rows: T[]): string[] {
  const set = new Set<string>();
  for (const r of rows) {
    const last4 = normalizeCardLast4(r.cardLast4);
    if (last4) set.add(last4);
  }
  return [...set];
}

function scoreCard(
  rows: CardTagged[],
  knownDescriptions: Iterable<string>,
): number {
  const known = new Set(
    [...knownDescriptions].map((d) => d.trim().toUpperCase()).filter(Boolean),
  );
  let score = 0;
  for (const r of rows) {
    const d = r.descriptionNormalized ?? "";
    if (PRIMARY_CARD_HINT_RE.test(d)) score += 5;
    if (known.has(d.trim().toUpperCase())) score += 2;
  }
  return score;
}

/**
 * Pick the owner's last4 when a period file has 2+ cards.
 * Preferred setting wins; otherwise the card that matches his
 * Últimos movimientos / tech+bici merchants.
 */
export function pickPrimaryCardLast4<T extends CardTagged>(
  rows: T[],
  opts?: {
    preferredLast4?: string | null;
    knownDescriptions?: Iterable<string>;
  },
): string | null {
  const preferred = normalizeCardLast4(opts?.preferredLast4);
  const last4s = cardLast4s(rows);
  if (last4s.length === 0) return preferred;
  if (preferred && last4s.includes(preferred)) return preferred;
  if (last4s.length === 1) return last4s[0] ?? null;

  const known = opts?.knownDescriptions ?? [];
  let best: string | null = null;
  let bestScore = -1;
  for (const last4 of last4s) {
    const slice = rows.filter((r) => normalizeCardLast4(r.cardLast4) === last4);
    const s = scoreCard(slice, known);
    if (s > bestScore) {
      bestScore = s;
      best = last4;
    }
  }
  // No hints at all → don't guess the grocery/titular card; take the
  // highest-scoring anyway (0 vs 0 keeps insertion order / first last4).
  return best;
}

/**
 * Keep untagged rows (Últimos movimientos has no last4) plus the primary
 * last4. Never drop snapshot rows just because last4 is missing — that
 * was hiding TEMBICI / Ecobici from Deuda.
 */
export function filterToPrimaryCard<T extends CardTagged>(
  rows: T[],
  primaryLast4: string | null,
): T[] {
  const primary = normalizeCardLast4(primaryLast4);
  if (!primary) return rows;
  return rows.filter((r) => {
    const last4 = normalizeCardLast4(r.cardLast4);
    if (last4 == null) return true;
    return last4 === primary;
  });
}
