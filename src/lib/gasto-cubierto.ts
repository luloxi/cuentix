/**
 * Pure helpers for household utility bills already covered/paid somehow
 * (luz, agua, gas, internet, alquiler, expensas, …). Client-safe.
 *
 * Distinct from roommate "Reintegro hogar": here the bill row itself is
 * marked isPayment so it stays visible with Tipo "Cubierto" but drops out
 * of neta / Hogar totals (no double-count).
 */

/** Canonical utility-ish category slugs (system seeds + aliases). */
export const HOGAR_UTILITY_SLUGS = [
  "alquiler",
  "luz",
  "agua",
  "gas",
  "internet",
  "expensas",
] as const;

export type HogarUtilitySlug = (typeof HOGAR_UTILITY_SLUGS)[number];

const UTILITY_SLUG_SET = new Set<string>(HOGAR_UTILITY_SLUGS);

/** Name tokens that map to utility even if slug is custom / legacy. */
const UTILITY_NAME_ALIASES = [
  "alquiler",
  "renta",
  "rent",
  "luz",
  "electricidad",
  "edenor",
  "edesur",
  "agua",
  "aysa",
  "gas",
  "metrogas",
  "internet",
  "fibra",
  "expensas",
  "abl",
  "municipal",
] as const;

function normalizeText(s: string): string {
  return s
    .toUpperCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function isHogarUtilitySlug(slug: string | null | undefined): boolean {
  if (!slug) return false;
  return UTILITY_SLUG_SET.has(slug.trim().toLowerCase());
}

/**
 * True for system utility slugs or category names that clearly mean
 * rent / utilities / expensas (sensible aliases).
 */
export function isHogarUtilityCategory(opts: {
  slug?: string | null;
  name?: string | null;
}): boolean {
  if (isHogarUtilitySlug(opts.slug)) return true;
  const name = opts.name ? normalizeText(opts.name) : "";
  if (!name) return false;
  for (const alias of UTILITY_NAME_ALIASES) {
    const a = normalizeText(alias);
    if (name === a || name.includes(a)) return true;
  }
  return false;
}

/** Tipo should show "Cubierto" (not Reintegro — caller checks reintegro first). */
export function isGastoCubiertoTipo(
  isPayment: boolean,
  category?: { slug?: string | null; name?: string | null } | null,
): boolean {
  if (!isPayment) return false;
  return isHogarUtilityCategory({
    slug: category?.slug,
    name: category?.name,
  });
}

function normalizeKey(description: string): string {
  return normalizeText(description);
}

/** Same merchant key for bulk “Sí a los N”. */
export function sameGastoCubiertoKey(a: string, b: string): boolean {
  const ka = normalizeKey(a);
  const kb = normalizeKey(b);
  return Boolean(ka) && ka === kb;
}

export function countGastoCubiertoMatches(
  rows: Array<{
    id: string;
    descriptionNormalized: string;
    isPayment?: boolean;
    categorySlug?: string | null;
    categoryName?: string | null;
  }>,
  description: string,
  opts?: { excludeTxId?: string; onlyUnset?: boolean },
): number {
  const key = normalizeKey(description);
  if (!key) return 0;
  let n = 0;
  for (const tx of rows) {
    if (opts?.excludeTxId && tx.id === opts.excludeTxId) continue;
    if (normalizeKey(tx.descriptionNormalized) !== key) continue;
    if (
      !isHogarUtilityCategory({
        slug: tx.categorySlug,
        name: tx.categoryName,
      })
    ) {
      continue;
    }
    if (opts?.onlyUnset && tx.isPayment) continue;
    n++;
  }
  return n;
}

export { normalizeKey as normalizeGastoCubiertoKey };
