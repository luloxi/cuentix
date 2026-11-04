/**
 * "Aplicar a similares" reads and writes through tx_household_desc_idx.
 * The cap is inside the subquery. An outer `household_id = ?` makes SQLite
 * walk the household instead of looking the ids up by primary key.
 *
 * `date || ''` is still text order. A bare `date` in ORDER BY lets the
 * planner satisfy the sort with tx_household_date_idx and scan every row
 * in the household (D1 has no stats for this index).
 */

export const SIMILAR_CAP = 500;

export type SimilarFilter = {
  /** Hogar names other than Personal / Invoice IOG only see shared rows. */
  sharedOnly: boolean;
  /** Extra predicate. Its placeholders are bound after the shared filter. */
  extra: string;
};

export type SimilarKey = {
  householdId: string;
  description: string;
  excludeId: string;
  userId: string;
};

const SIMILAR_ORDER = "date || '' DESC, id";

function visibilitySql(sharedOnly: boolean): string {
  if (sharedOnly) return "ownership = 'shared'";
  return "(ownership = 'shared' OR paid_by_user_id = ?)";
}

function filterSql(filter: SimilarFilter): string {
  return [
    "household_id = ?",
    "description_normalized = ?",
    "id != ?",
    "is_business = 0",
    visibilitySql(filter.sharedOnly),
    `(${filter.extra})`,
  ].join(" AND ");
}

/** SET placeholders are bound before the filter binds from `similarBinds`. */
export function similarUpdateSql(set: string, filter: SimilarFilter): string {
  return `UPDATE transactions SET ${set} WHERE id IN (
    SELECT id FROM transactions
    WHERE ${filterSql(filter)}
    ORDER BY ${SIMILAR_ORDER}
    LIMIT ${SIMILAR_CAP}
  )`;
}

export function similarCountSql(filter: SimilarFilter): string {
  return `SELECT COUNT(*) AS n FROM (
    SELECT 1 FROM transactions
    WHERE ${filterSql(filter)}
    LIMIT ${SIMILAR_CAP + 1}
  )`;
}

export function similarBinds(
  filter: SimilarFilter,
  key: SimilarKey,
  extra: readonly unknown[] = [],
): unknown[] {
  const binds: unknown[] = [key.householdId, key.description, key.excludeId];
  if (!filter.sharedOnly) binds.push(key.userId);
  binds.push(...extra);
  return binds;
}

/** Probe count is clamped to the cap. The total includes the target row (max 501). */
export function similarCountFromProbe(matched: number): { total: number; capped: boolean } {
  const capped = matched > SIMILAR_CAP;
  return { total: 1 + (capped ? SIMILAR_CAP : matched), capped };
}
