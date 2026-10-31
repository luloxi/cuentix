/** Oldest membership wins when no cookie / token prefers another hogar. */
export type HouseholdMembershipPick = {
  householdId: string;
  joinedAt: Date | string | null;
};

export function pickActiveHouseholdId(
  memberships: HouseholdMembershipPick[],
  preferredId?: string | null,
): string | null {
  if (memberships.length === 0) return null;
  const sorted = [...memberships].sort((a, b) => {
    const at = a.joinedAt ? new Date(a.joinedAt).getTime() : 0;
    const bt = b.joinedAt ? new Date(b.joinedAt).getTime() : 0;
    if (at !== bt) return at - bt;
    return a.householdId.localeCompare(b.householdId);
  });
  if (preferredId && sorted.some((m) => m.householdId === preferredId)) {
    return preferredId;
  }
  return sorted[0]!.householdId;
}
