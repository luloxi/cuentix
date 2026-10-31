import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { matchCategory, type CategoryMatch } from "@/lib/categorize/rules";
import { getCategoryMap } from "@/lib/household";

/** Normalize description for matching / learning keys. */
export function normalizeMerchantText(description: string): string {
  return description
    .toUpperCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Same account/merchant key used for "apply to N" matching. */
export function sameMerchantKey(a: string, b: string): boolean {
  const ka = normalizeMerchantText(a);
  const kb = normalizeMerchantText(b);
  return Boolean(ka) && ka === kb;
}

/**
 * Count gastos on the same account/merchant key in the household.
 * Includes the current tx when `excludeTxId` is omitted; pass it to count others only.
 */
export function countMatchingMerchant(
  rows: Array<{ id: string; descriptionNormalized: string }>,
  description: string,
  excludeTxId?: string,
): number {
  const key = normalizeMerchantText(description);
  if (!key) return 0;
  let n = 0;
  for (const tx of rows) {
    if (excludeTxId && tx.id === excludeTxId) continue;
    if (normalizeMerchantText(tx.descriptionNormalized) !== key) continue;
    n++;
  }
  return n;
}

/**
 * Build patterns to remember from a manual categorization.
 * Longer / more specific patterns first.
 */
export function learningPatternsFromDescription(description: string): string[] {
  const key = normalizeMerchantText(description);
  if (!key) return [];

  const patterns: string[] = [key];

  // Strip cuota noise
  const noCuota = key
    .replace(/\bCUOTA\s*\d+\s*\/\s*\d+\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (noCuota && noCuota !== key) patterns.push(noCuota);

  // MERPAGO*MERCHANT
  const mp = key.match(/MERPAGO\*[A-Z0-9]+/);
  if (mp) patterns.push(mp[0]);

  // Leading merchant token (SPOTIFY, DIA, UBER…)
  const token = key
    .split(/[\s*\/]+/)
    .find((t) => t.length >= 4 && !/^\d+$/.test(t) && !/^0X/i.test(t));
  if (token && token.length >= 4) patterns.push(token);

  // Drop very short / generic noise
  return [...new Set(patterns)].filter(
    (p) => p.length >= 3 && !["THE", "AND", "FOR", "COM"].includes(p),
  );
}

/**
 * Persist household-specific merchant → category rules from a user edit.
 * Priority: full description 100, cleaned 95, mercadopago 90, token 80.
 */
export async function learnFromCategorization(opts: {
  householdId: string;
  description: string;
  categoryId: string;
}): Promise<{ patterns: string[] }> {
  const db = (await getDb());
  const patterns = learningPatternsFromDescription(opts.description);
  if (patterns.length === 0) return { patterns: [] };

  // Verify category is not "uncategorized" (nothing useful to learn)
  const { byId } = await getCategoryMap();
  const cat = byId.get(opts.categoryId);
  if (!cat || cat.slug === "uncategorized") return { patterns: [] };

  const priorityFor = (pattern: string, index: number): number => {
    if (index === 0) return 100;
    if (pattern.startsWith("MERPAGO*")) return 90;
    if (pattern.length >= 20) return 95;
    return 80;
  };

  for (let i = 0; i < patterns.length; i++) {
    const pattern = patterns[i]!;
    const existing = await db
      .select()
      .from(schema.merchantRules)
      .where(
        and(
          eq(schema.merchantRules.householdId, opts.householdId),
          eq(schema.merchantRules.pattern, pattern),
        ),
      )
      .limit(1);

    if (existing[0]) {
      await db
        .update(schema.merchantRules)
        .set({
          categoryId: opts.categoryId,
          priority: Math.max(existing[0].priority, priorityFor(pattern, i)),
        })
        .where(eq(schema.merchantRules.id, existing[0].id));
    } else {
      await db.insert(schema.merchantRules).values({
        householdId: opts.householdId,
        pattern,
        categoryId: opts.categoryId,
        priority: priorityFor(pattern, i),
      });
    }
  }

  return { patterns };
}

/**
 * Count transactions in the household with the same merchant/account key.
 * By default includes the current tx (N = total on that account).
 */
export async function countSimilarByMerchant(opts: {
  householdId: string;
  description: string;
  excludeTxId?: string;
}): Promise<number> {
  const db = (await getDb());
  const key = normalizeMerchantText(opts.description);
  if (!key) return 0;

  const all = await db
    .select({
      id: schema.transactions.id,
      descriptionNormalized: schema.transactions.descriptionNormalized,
    })
    .from(schema.transactions)
    .where(eq(schema.transactions.householdId, opts.householdId));

  return countMatchingMerchant(all, opts.description, opts.excludeTxId);
}

/**
 * Apply the same category to ALL matching txs on the same merchant key
 * (not only uncategorized — user explicitly opted in via toast).
 */
export async function applyCategoryToSimilar(opts: {
  householdId: string;
  description: string;
  categoryId: string;
  excludeTxId?: string;
}): Promise<number> {
  const db = (await getDb());
  const key = normalizeMerchantText(opts.description);
  if (!key) return 0;

  const all = await db
    .select({
      id: schema.transactions.id,
      descriptionNormalized: schema.transactions.descriptionNormalized,
      categoryId: schema.transactions.categoryId,
    })
    .from(schema.transactions)
    .where(eq(schema.transactions.householdId, opts.householdId));

  let updated = 0;
  for (const tx of all) {
    if (opts.excludeTxId && tx.id === opts.excludeTxId) continue;
    if (normalizeMerchantText(tx.descriptionNormalized) !== key) continue;
    if (tx.categoryId === opts.categoryId) continue;

    await db
      .update(schema.transactions)
      .set({ categoryId: opts.categoryId, updatedAt: new Date() })
      .where(eq(schema.transactions.id, tx.id));
    updated++;
  }
  return updated;
}

type LearnedRule = {
  pattern: string;
  categoryId: string;
  priority: number;
};

async function loadHouseholdRules(householdId: string): Promise<LearnedRule[]> {
  const db = (await getDb());
  const rows = await db
    .select({
      pattern: schema.merchantRules.pattern,
      categoryId: schema.merchantRules.categoryId,
      priority: schema.merchantRules.priority,
    })
    .from(schema.merchantRules)
    .where(eq(schema.merchantRules.householdId, householdId))
    .orderBy(desc(schema.merchantRules.priority));
  return rows;
}

/**
 * Match description against household-learned rules, then static seeds.
 */
export async function matchCategoryWithLearning(
  householdId: string,
  description: string,
): Promise<CategoryMatch & { categoryId?: string; learned?: boolean }> {
  const u = normalizeMerchantText(description);
  const rules = await loadHouseholdRules(householdId);
  // Prefer longer patterns when priority ties
  const sorted = [...rules].sort(
    (a, b) => b.priority - a.priority || b.pattern.length - a.pattern.length,
  );

  const { byId } = await getCategoryMap();

  for (const rule of sorted) {
    const p = rule.pattern.toUpperCase();
    if (p.length < 3) continue;
    if (u.includes(p)) {
      const cat = byId.get(rule.categoryId);
      if (!cat || cat.slug === "uncategorized") continue;
      return {
        slug: cat.slug,
        name: cat.name,
        kind: cat.kind as CategoryMatch["kind"],
        defaultOwnership: cat.defaultOwnership,
        categoryId: cat.id,
        learned: true,
      };
    }
  }

  const seed = matchCategory(description);
  const { bySlug } = await getCategoryMap();
  const row = bySlug.get(seed.slug);
  return {
    ...seed,
    categoryId: row?.id,
    learned: false,
  };
}

export function isUncategorizedSlug(slug: string | null | undefined): boolean {
  return !slug || slug === "uncategorized";
}
