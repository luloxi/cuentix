import { createHash, randomBytes } from "crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb, hasDatabase, schema } from "@/lib/db";

/** Public prefix so household tokens are distinguishable from the admin env secret. */
export const HOUSEHOLD_TOKEN_PREFIX = "lc_h_";
/** How many leading chars we store/show as `prefix` (never the full secret). */
export const HOUSEHOLD_TOKEN_DISPLAY_LEN = 12;

export function generateHouseholdTokenPlaintext(): string {
  return HOUSEHOLD_TOKEN_PREFIX + randomBytes(32).toString("hex");
}

export function hashHouseholdToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function displayPrefixForToken(token: string): string {
  return token.slice(0, HOUSEHOLD_TOKEN_DISPLAY_LEN);
}

export type HouseholdTokenRecord = {
  id: string;
  tokenHash: string;
  householdId: string;
  revokedAt: Date | null;
};

/** Unique-hash lookup. Revoked hashes do not authenticate. */
export function matchHouseholdTokenRecord(
  tokenHash: string,
  records: HouseholdTokenRecord[],
): HouseholdTokenRecord | null {
  for (const r of records) {
    if (r.tokenHash === tokenHash && r.revokedAt == null) return r;
  }
  return null;
}

export type BearerResolution =
  | { kind: "household"; householdId: string; tokenId?: string }
  | { kind: "global" }
  | { kind: "none" };

/**
 * Household token wins over the global admin/dev fallback.
 * A hash that matches a *revoked* household token is a hard miss (no global fallback).
 */
export function resolveBearerAgainstStore(opts: {
  provided: string;
  records: HouseholdTokenRecord[];
  globalToken?: string | null;
}): BearerResolution {
  const tokenHash = hashHouseholdToken(opts.provided);
  const hit = matchHouseholdTokenRecord(tokenHash, opts.records);
  if (hit) {
    return {
      kind: "household",
      householdId: hit.householdId,
      tokenId: hit.id,
    };
  }

  const revokedHit = opts.records.some(
    (r) => r.tokenHash === tokenHash && r.revokedAt != null,
  );
  if (revokedHit) return { kind: "none" };

  const expected = opts.globalToken ?? "";
  if (expected && opts.provided === expected) return { kind: "global" };
  return { kind: "none" };
}

/**
 * Household bearer never inherits another household, even if the acting user
 * later belonged somewhere else.
 */
export function householdIdForAuth(auth: {
  kind: "household" | "global" | "session";
  tokenHouseholdId?: string | null;
  userHouseholdId?: string | null;
}): string | null {
  if (auth.kind === "household") return auth.tokenHouseholdId ?? null;
  return auth.userHouseholdId ?? null;
}

export function isolateRowsByHousehold<T extends { householdId: string }>(
  boundHouseholdId: string,
  rows: T[],
): T[] {
  return rows.filter((r) => r.householdId === boundHouseholdId);
}

export type ActiveHouseholdTokenMeta = {
  id: string;
  prefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
};

export type HouseholdTokenLookup =
  | {
      status: "active";
      id: string;
      householdId: string;
      createdBy: string | null;
    }
  | { status: "revoked" }
  | { status: "miss" };

export async function lookupHouseholdToken(
  plaintext: string,
): Promise<HouseholdTokenLookup> {
  if (!plaintext || !(await hasDatabase())) return { status: "miss" };
  const db = (await getDb());
  const tokenHash = hashHouseholdToken(plaintext);
  const [row] = await db
    .select({
      id: schema.householdApiTokens.id,
      householdId: schema.householdApiTokens.householdId,
      createdBy: schema.householdApiTokens.createdBy,
      revokedAt: schema.householdApiTokens.revokedAt,
    })
    .from(schema.householdApiTokens)
    .where(eq(schema.householdApiTokens.tokenHash, tokenHash))
    .limit(1);

  if (!row) return { status: "miss" };
  if (row.revokedAt) return { status: "revoked" };
  return {
    status: "active",
    id: row.id,
    householdId: row.householdId,
    createdBy: row.createdBy,
  };
}

export async function getActiveHouseholdToken(
  householdId: string,
): Promise<ActiveHouseholdTokenMeta | null> {
  const db = (await getDb());
  const [row] = await db
    .select({
      id: schema.householdApiTokens.id,
      prefix: schema.householdApiTokens.tokenPrefix,
      createdAt: schema.householdApiTokens.createdAt,
      lastUsedAt: schema.householdApiTokens.lastUsedAt,
    })
    .from(schema.householdApiTokens)
    .where(
      and(
        eq(schema.householdApiTokens.householdId, householdId),
        isNull(schema.householdApiTokens.revokedAt),
      ),
    )
    .orderBy(desc(schema.householdApiTokens.createdAt))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    prefix: row.prefix,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
  };
}

export class HouseholdTokenExistsError extends Error {
  readonly code = "token_exists" as const;
  constructor(readonly prefix: string) {
    super("Este hogar ya tiene un token activo. Rotálo si hace falta uno nuevo.");
    this.name = "HouseholdTokenExistsError";
  }
}

async function insertHouseholdToken(opts: {
  householdId: string;
  createdBy: string;
}): Promise<{ token: string; meta: ActiveHouseholdTokenMeta }> {
  const db = (await getDb());
  const token = generateHouseholdTokenPlaintext();
  const tokenHash = hashHouseholdToken(token);
  const prefix = displayPrefixForToken(token);
  const [row] = await db
    .insert(schema.householdApiTokens)
    .values({
      householdId: opts.householdId,
      tokenHash,
      tokenPrefix: prefix,
      createdBy: opts.createdBy,
    })
    .returning({
      id: schema.householdApiTokens.id,
      createdAt: schema.householdApiTokens.createdAt,
    });
  if (!row) {
    throw new Error("No se pudo guardar el token del hogar");
  }
  return {
    token,
    meta: {
      id: row.id,
      prefix,
      createdAt: row.createdAt,
      lastUsedAt: null,
    },
  };
}

export async function createHouseholdToken(opts: {
  householdId: string;
  createdBy: string;
}): Promise<{ token: string; meta: ActiveHouseholdTokenMeta }> {
  const existing = await getActiveHouseholdToken(opts.householdId);
  if (existing) throw new HouseholdTokenExistsError(existing.prefix);
  return insertHouseholdToken(opts);
}

export async function revokeActiveHouseholdTokens(
  householdId: string,
): Promise<number> {
  const db = (await getDb());
  const rows = await db
    .update(schema.householdApiTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(schema.householdApiTokens.householdId, householdId),
        isNull(schema.householdApiTokens.revokedAt),
      ),
    )
    .returning({ id: schema.householdApiTokens.id });
  return rows.length;
}

export async function rotateHouseholdToken(opts: {
  householdId: string;
  createdBy: string;
}): Promise<{ token: string; meta: ActiveHouseholdTokenMeta }> {
  const db = (await getDb());
  const token = generateHouseholdTokenPlaintext();
  const tokenHash = hashHouseholdToken(token);
  const prefix = displayPrefixForToken(token);
  const id = crypto.randomUUID();
  const createdAt = new Date();
  // Atomic: the old token is revoked only if the replacement insert lands.
  await db.batch([
    db
      .update(schema.householdApiTokens)
      .set({ revokedAt: createdAt })
      .where(
        and(
          eq(schema.householdApiTokens.householdId, opts.householdId),
          isNull(schema.householdApiTokens.revokedAt),
        ),
      ),
    db.insert(schema.householdApiTokens).values({
      id,
      householdId: opts.householdId,
      tokenHash,
      tokenPrefix: prefix,
      createdBy: opts.createdBy,
      createdAt,
    }),
  ]);
  return {
    token,
    meta: { id, prefix, createdAt, lastUsedAt: null },
  };
}

export async function touchHouseholdTokenLastUsed(
  tokenId: string,
): Promise<void> {
  if (!(await hasDatabase())) return;
  const db = (await getDb());
  await db
    .update(schema.householdApiTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(schema.householdApiTokens.id, tokenId));
}
