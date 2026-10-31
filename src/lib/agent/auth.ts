import { createHash, timingSafeEqual } from "crypto";
import { eq, sql } from "drizzle-orm";
import { ADMIN_EMAIL } from "@/lib/auth/allowlist";
import { getDb, hasDatabase, schema } from "@/lib/db";
import {
  getUserHousehold,
  pickHouseholdActingUser,
} from "@/lib/household";
import {
  lookupHouseholdToken,
  touchHouseholdTokenLastUsed,
} from "@/lib/agent/household-token";
import type { AppUser } from "@/lib/session";

/**
 * Env var: shared bearer secret for admin/dev fallback (El Tano / Jurio).
 * Optional once households mint their own tokens. A global token cannot sell
 * the .com product — it always maps to AGENT_USER_ID / AGENT_USER_EMAIL.
 */
export const AGENT_TOKEN_ENV = "AGENT_API_TOKEN";
/** Env var: app `users.id` to act as (preferred). Admin/dev fallback only. */
export const AGENT_USER_ID_ENV = "AGENT_USER_ID";
/** Env var: email to resolve the app user if AGENT_USER_ID is unset. Admin/dev fallback only. */
export const AGENT_USER_EMAIL_ENV = "AGENT_USER_EMAIL";

export function isAgentAuthConfigured(): boolean {
  return Boolean(process.env.AGENT_API_TOKEN?.trim());
}

export function parseBearerToken(
  authorization: string | null | undefined,
): string | null {
  if (!authorization) return null;
  const m = authorization.trim().match(/^Bearer\s+(\S+)/i);
  return m?.[1] ?? null;
}

/**
 * Compare bearer token to AGENT_API_TOKEN.
 * Hashes both sides so length differences cannot leak via timingSafeEqual.
 */
export function agentTokenMatches(provided: string): boolean {
  const expected = process.env.AGENT_API_TOKEN ?? "";
  if (!expected || !provided) return false;
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/** Candidate app user plus whether they belong to a household. */
export type AgentUserCandidate = AppUser & { hasHousehold: boolean };

/**
 * Prefer a user who already belongs to a household.
 * Used by resolveAgentUser after id/email lookups.
 */
export function pickUserWithHousehold(
  candidates: AgentUserCandidate[],
): AgentUserCandidate | null {
  if (candidates.length === 0) return null;
  const withHousehold = candidates.find((c) => c.hasHousehold);
  return withHousehold ?? null;
}

function toAppUser(c: AgentUserCandidate): AppUser {
  return {
    id: c.id,
    email: c.email,
    name: c.name,
    image: c.image,
  };
}

async function lookupByUserId(
  userId: string,
): Promise<AgentUserCandidate | null> {
  const db = (await getDb());
  const [row] = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      name: schema.users.name,
      image: schema.users.image,
      memberUserId: schema.householdMembers.userId,
    })
    .from(schema.users)
    .leftJoin(
      schema.householdMembers,
      eq(schema.householdMembers.userId, schema.users.id),
    )
    .where(eq(schema.users.id, userId))
    .limit(1);

  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    image: row.image,
    hasHousehold: Boolean(row.memberUserId),
  };
}

/**
 * Users matching email (case-insensitive) who have household_members rows.
 * Prefer owner role when several match.
 */
async function lookupHouseholdUsersByEmail(
  email: string,
): Promise<AgentUserCandidate[]> {
  const db = (await getDb());
  const rows = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      name: schema.users.name,
      image: schema.users.image,
      role: schema.householdMembers.role,
    })
    .from(schema.users)
    .innerJoin(
      schema.householdMembers,
      eq(schema.householdMembers.userId, schema.users.id),
    )
    .where(sql`lower(${schema.users.email}) = ${email}`);

  const byId = new Map<string, AgentUserCandidate & { role: string }>();
  for (const row of rows) {
    const prev = byId.get(row.id);
    if (!prev || row.role === "owner") {
      byId.set(row.id, {
        id: row.id,
        email: row.email,
        name: row.name,
        image: row.image,
        hasHousehold: true,
        role: row.role,
      });
    }
  }

  return [...byId.values()].sort((a, b) => {
    if (a.role === "owner" && b.role !== "owner") return -1;
    if (b.role === "owner" && a.role !== "owner") return 1;
    return 0;
  });
}

/**
 * Map a valid agent token to a household member (configured user).
 * Prefers AGENT_USER_ID when that user is in household_members; otherwise falls
 * back to AGENT_USER_EMAIL / ADMIN_EMAIL users who already have a hogar.
 * Never returns a stub id that skips household membership when a household
 * user for the email exists.
 */
export async function resolveAgentUser(): Promise<AppUser | null> {
  const userId = process.env.AGENT_USER_ID?.trim();
  const emailEnv = process.env.AGENT_USER_EMAIL?.trim().toLowerCase();
  const email = emailEnv || ADMIN_EMAIL;

  if (!(await hasDatabase())) {
    // Without DB we cannot verify household membership.
    if (userId) {
      return {
        id: userId,
        email,
        name: "Agent",
        image: null,
      };
    }
    return null;
  }


  if (userId) {
    const byId = await lookupByUserId(userId);
    if (byId?.hasHousehold) return toAppUser(byId);

    // Wrong / stale AGENT_USER_ID (or stub id not in household_members):
    // fall back to email → household member.
    const byEmail = await lookupHouseholdUsersByEmail(email);
    const picked = pickUserWithHousehold(byEmail);
    if (picked) return toAppUser(picked);

    // No household user for email — do not invent a stub that will only
    // yield no_household later; let api-auth return agent_user_missing.
    return null;
  }

  const byEmail = await lookupHouseholdUsersByEmail(email);
  const picked = pickUserWithHousehold(byEmail);
  if (picked) return toAppUser(picked);

  // Email exists but no household yet — still allow acting as that user so
  // sync/onboarding paths can run; requireHousehold will surface no_household.
  const db = (await getDb());
  const [row] = await db
    .select()
    .from(schema.users)
    .where(sql`lower(${schema.users.email}) = ${email}`)
    .limit(1);

  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    image: row.image,
  };
}

export type ResolvedBearerAuth =
  | {
      kind: "household_token";
      user: AppUser;
      householdId: string;
      tokenId: string;
    }
  | {
      kind: "global_token";
      user: AppUser;
      householdId?: string;
    };

/**
 * Resolve a Bearer token to an acting user + household.
 * 1. Per-household hashed token (product path) — scoped to that household_id only.
 * 2. Global AGENT_API_TOKEN (admin/dev fallback) — the configured user's household.
 */
export async function resolveBearerAuth(
  provided: string,
): Promise<ResolvedBearerAuth | null> {
  if (!provided) return null;

  const household = await lookupHouseholdToken(provided);
  if (household.status === "revoked") return null;
  if (household.status === "active") {
    const user = await pickHouseholdActingUser(
      household.householdId,
      household.createdBy,
    );
    if (!user) return null;
    try {
      await touchHouseholdTokenLastUsed(household.id);
    } catch {
      // Auth still succeeds if last_used_at cannot be written.
    }
    return {
      kind: "household_token",
      user,
      householdId: household.householdId,
      tokenId: household.id,
    };
  }

  if (!agentTokenMatches(provided)) return null;
  const user = await resolveAgentUser();
  if (!user) return null;
  let householdId: string | undefined;
  if ((await hasDatabase())) {
    const ctx = await getUserHousehold(user.id);
    householdId = ctx?.household.id;
  }
  return { kind: "global_token", user, householdId };
}
