import { cookies } from "next/headers";

export const ACTIVE_HOUSEHOLD_COOKIE = "lc_household";

export async function readPreferredHouseholdId(): Promise<string | null> {
  try {
    const store = await cookies();
    const value = store.get(ACTIVE_HOUSEHOLD_COOKIE)?.value?.trim();
    return value || null;
  } catch {
    return null;
  }
}

export async function writePreferredHouseholdId(householdId: string) {
  const store = await cookies();
  store.set(ACTIVE_HOUSEHOLD_COOKIE, householdId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 400,
    secure: process.env.NODE_ENV === "production",
  });
}
