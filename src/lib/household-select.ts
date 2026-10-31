/**
 * Cookie / explicit id wins. Otherwise Personal (or Mi espacio) is the
 * default, because the oldest membership can be a shared hogar
 * that is not where the member's own gastos live. Without a Personal
 * space, the oldest membership still wins so work hogares are not mixed in.
 */
export type HouseholdMembershipPick = {
  householdId: string;
  joinedAt: Date | string | null;
  name?: string | null;
};

const PERSONAL_NAMES = new Set(["personal", "mi espacio"]);

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
  const personal = sorted.find((m) =>
    PERSONAL_NAMES.has((m.name ?? "").trim().toLowerCase()),
  );
  if (personal) return personal.householdId;
  return sorted[0]!.householdId;
}
