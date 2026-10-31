import { pickActiveHouseholdId } from "../src/lib/household-select";
import type { Env } from "./env";
import { HOUSEHOLD_COOKIE, readCookie } from "./http";

export type HouseholdRow = {
  id: string;
  name: string;
  role: "owner" | "member";
  joinedAt: number | null;
};

const PERSONAL_NAMES = new Set(["personal", "mi espacio"]);

/**
 * Mirrors `forceSharedOnlyForHousehold` without importing the Next/db household
 * module. Personal and Invoice IOG list personal rows; other hogares do not.
 */
export function forceSharedOnly(name: string): boolean {
  const n = name.trim().toLowerCase();
  if (PERSONAL_NAMES.has(n)) return false;
  if (n === "invoice iog") return false;
  return true;
}

export function isPersonalName(name: string): boolean {
  return PERSONAL_NAMES.has(name.trim().toLowerCase());
}

export async function listHouseholds(env: Env, userId: string): Promise<HouseholdRow[]> {
  const res = await env.DB.prepare(
    `SELECT h.id AS id, h.name AS name, m.role AS role, m.joined_at AS joined_at
     FROM household_members m
     INNER JOIN households h ON h.id = m.household_id
     WHERE m.user_id = ?`,
  )
    .bind(userId)
    .all<{ id: string; name: string; role: "owner" | "member"; joined_at: number | null }>();
  return (res.results ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    role: row.role === "owner" ? "owner" : "member",
    joinedAt: row.joined_at,
  }));
}

export async function activeHousehold(
  req: Request,
  env: Env,
  userId: string,
): Promise<{ list: HouseholdRow[]; active: HouseholdRow | null }> {
  const list = await listHouseholds(env, userId);
  const preferred = readCookie(req, HOUSEHOLD_COOKIE);
  const id = pickActiveHouseholdId(
    list.map((row) => ({
      householdId: row.id,
      joinedAt: row.joinedAt == null ? null : new Date(row.joinedAt),
    })),
    preferred,
  );
  return { list, active: list.find((row) => row.id === id) ?? null };
}

export async function listMembers(env: Env, householdId: string) {
  const res = await env.DB.prepare(
    `SELECT m.user_id AS user_id,
            COALESCE(NULLIF(m.display_name, ''), NULLIF(u.name, ''), NULLIF(u.email, ''), m.user_id) AS name
     FROM household_members m
     LEFT JOIN users u ON u.id = m.user_id
     WHERE m.household_id = ?`,
  )
    .bind(householdId)
    .all<{ user_id: string; name: string }>();
  return (res.results ?? []).map((row) => ({
    userId: row.user_id,
    name: row.name,
  }));
}
