import {
  createHousehold,
  isProtectedHouseholdName,
  listUserHouseholds,
} from "@/lib/household";
const CASITA_HOUSEHOLD_NAME = "Casita";
const INVOICE_IOG_HOUSEHOLD_NAME = "Invoice IOG";

/** Display names that count as the Personal bank-import space. */
export const PERSONAL_HOUSEHOLD_NAMES = ["Personal", "Mi espacio"] as const;

export function isPersonalHouseholdName(name: string): boolean {
  const n = name.trim();
  return (PERSONAL_HOUSEHOLD_NAMES as readonly string[]).some(
    (p) => p.toLowerCase() === n.toLowerCase(),
  );
}

/**
 * Pure pick: prefer "Personal", then "Mi espacio", then oldest non-protected
 * hogar. Returns null if only Casita / Invoice IOG (or empty).
 */
export function pickPersonalHouseholdId(
  households: Array<{ id: string; name: string; joinedAt?: Date | string | null }>,
): string | null {
  if (households.length === 0) return null;

  const byName = (want: string) =>
    households.find(
      (h) => h.name.trim().toLowerCase() === want.toLowerCase(),
    )?.id ?? null;

  for (const name of PERSONAL_HOUSEHOLD_NAMES) {
    const id = byName(name);
    if (id) return id;
  }

  const nonProtected = [...households]
    .filter((h) => !isProtectedHouseholdName(h.name))
    .sort((a, b) => {
      const at = a.joinedAt ? new Date(a.joinedAt).getTime() : 0;
      const bt = b.joinedAt ? new Date(b.joinedAt).getTime() : 0;
      if (at !== bt) return at - bt;
      return a.id.localeCompare(b.id);
    });
  return nonProtected[0]?.id ?? null;
}

/**
 * Resolve (or create) the product Personal space for bank imports + seed.
 * Never returns Casita or Invoice IOG.
 */
export async function resolvePersonalHouseholdId(
  userId: string,
): Promise<string | null> {
  const list = await listUserHouseholds(userId);
  const picked = pickPersonalHouseholdId(list);
  if (picked) {
    const row = list.find((h) => h.id === picked);
    if (row && !isProtectedHouseholdName(row.name)) return picked;
  }

  // Only protected hogares (or none) — mint Personal as additional space.
  const created = await createHousehold(userId, "Personal", {
    additional: true,
  });
  if (!created?.household?.id) return null;
  if (
    created.household.name === CASITA_HOUSEHOLD_NAME ||
    created.household.name === INVOICE_IOG_HOUSEHOLD_NAME
  ) {
    return null;
  }
  return created.household.id;
}


/**
 * Personal bank space lists ownership=personal rows (BBVA/Fiwind dump).
 * Invoice IOG still seeds ownership=personal on its own ledger.
 * Casita / other assign hogares must NOT list Asignar=Personal rows —
 * those belong in Personal space (or were leftover after ownership model).
 */
export function shouldListPersonalOwnedRows(householdName: string): boolean {
  if (isPersonalHouseholdName(householdName)) return true;
  if (householdName.trim() === INVOICE_IOG_HOUSEHOLD_NAME) return true;
  return false;
}

/** Force shared-only listing for Casita and other non-Personal hogares. */
export function forceSharedOnlyForHousehold(householdName: string): boolean {
  return !shouldListPersonalOwnedRows(householdName);
}

/** True when active hogar is a dump destination we must not write bank loads into. */
export function isLabelOnlyHouseholdName(name: string): boolean {
  return isProtectedHouseholdName(name);
}
