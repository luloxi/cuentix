import { normalizeHouseholdName, validateHouseholdName } from "../src/lib/household-name";
import type { SessionUser } from "./auth";
import type { Env } from "./env";
import { activeHousehold, listHouseholds, type HouseholdRow } from "./household";
import { HOUSEHOLD_COOKIE, json, notPorted, serializeCookie } from "./http";

const YEAR = 60 * 60 * 24 * 400;
const MAX_ATTEMPTS = 3;

export const MAX_HOUSEHOLDS_PER_USER = 10;
export const HOUSEHOLD_CAP_ERROR = "Ya llegaste al máximo de 10 hogares";
export const HOUSEHOLD_DUPLICATE_ERROR = "Ya tenés un hogar con ese nombre";

/** 32 symbols: A–Z without I/O, digits 2–9. Length divides 256, so sampling stays unbiased. */
export const INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const INVITE_LEN = 8;

/**
 * Membership count for the cap. `user_id = ?` is covered by hm_user_idx.
 * One row, no join.
 */
export const COUNT_MEMBERSHIPS_SQL =
  "SELECT COUNT(*) AS n FROM household_members WHERE user_id = ?";

/** Names the user already belongs to. Bounded; the cap rejects anyone at 10 before this runs. */
export const HOUSEHOLD_NAMES_SQL = `SELECT h.name AS name
     FROM household_members m
     INNER JOIN households h ON h.id = m.household_id
     WHERE m.user_id = ?
     LIMIT 20`;

const INSERT_HOUSEHOLD_SQL =
  "INSERT INTO households (id, name, invite_code) VALUES (?, ?, ?)";
const INSERT_OWNER_SQL =
  "INSERT INTO household_members (household_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)";

const INVITE_CODE_SQL =
  "SELECT invite_code AS invite_code FROM households WHERE id = ? LIMIT 1";

export type HouseholdCreateDeps = {
  inviteCode?: () => string;
  randomUUID?: () => string;
};

/**
 * Map random bytes onto `alphabet` without modulo bias.
 * Bytes at or above the largest multiple of the alphabet size are skipped.
 */
export function charsFromBytes(bytes: Uint8Array, alphabet: string, need: number): string {
  const size = alphabet.length;
  if (size < 2 || size > 256 || need < 1) return "";
  const limit = Math.floor(256 / size) * size;
  let out = "";
  for (let i = 0; i < bytes.length && out.length < need; i++) {
    const byte = bytes[i] ?? 0;
    if (byte >= limit) continue;
    out += alphabet[byte % size] ?? "";
  }
  return out;
}

export function generateInviteCode(): string {
  let out = "";
  for (let spin = 0; out.length < INVITE_LEN && spin < 8; spin++) {
    const buf = new Uint8Array(INVITE_LEN * 2);
    crypto.getRandomValues(buf);
    out += charsFromBytes(buf, INVITE_ALPHABET, INVITE_LEN - out.length);
  }
  if (out.length !== INVITE_LEN) throw new Error("No se pudo generar el código");
  return out;
}

export function originAllowed(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (origin == null || origin === "") return true;
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }
  return host === new URL(req.url).host;
}

export function isJsonRequest(req: Request): boolean {
  const header = req.headers.get("content-type");
  if (!header) return false;
  return header.split(";")[0]?.trim().toLowerCase() === "application/json";
}

function isUniqueConflict(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /unique/i.test(message);
}

function publicHousehold(row: HouseholdRow) {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    canDelete: false,
  };
}

async function readInviteCode(env: Env, householdId: string): Promise<string | null> {
  const row = await env.DB.prepare(INVITE_CODE_SQL)
    .bind(householdId)
    .first<{ invite_code: string }>();
  return row?.invite_code ?? null;
}

/** Idempotent create: the caller's active household, with the household cookie refreshed. */
async function existingHouseholdResponse(req: Request, env: Env, userId: string): Promise<Response> {
  const { list, active } = await activeHousehold(req, env, userId);
  if (!active) return json({ error: "No se pudo crear el hogar" }, 500);
  const inviteCode = await readInviteCode(env, active.id);
  if (!inviteCode) return json({ error: "No se pudo crear el hogar" }, 500);
  const cookie = serializeCookie(HOUSEHOLD_COOKIE, active.id, req, YEAR);
  return json(
    {
      ok: true,
      existing: true,
      household: {
        household: { id: active.id, name: active.name, inviteCode },
        role: active.role,
      },
      activeHouseholdId: active.id,
      households: list.map(publicHousehold),
    },
    200,
    [cookie],
  );
}

async function handleHouseholdGet(req: Request, env: Env, user: SessionUser): Promise<Response> {
  const { active } = await activeHousehold(req, env, user.id);
  if (!active) return json({ household: null });
  const inviteCode = await readInviteCode(env, active.id);
  if (!inviteCode) return json({ household: null });
  return json({
    household: {
      household: { id: active.id, name: active.name, inviteCode },
      role: active.role,
    },
  });
}

type Inserted =
  | { ok: true; id: string; inviteCode: string }
  | { ok: false };

async function insertHousehold(
  env: Env,
  userId: string,
  name: string,
  deps?: HouseholdCreateDeps,
): Promise<Inserted> {
  const nextId = deps?.randomUUID ?? (() => crypto.randomUUID());
  const nextCode = deps?.inviteCode ?? generateInviteCode;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const id = nextId();
    const inviteCode = nextCode();
    try {
      await env.DB.batch([
        env.DB.prepare(INSERT_HOUSEHOLD_SQL).bind(id, name, inviteCode),
        env.DB.prepare(INSERT_OWNER_SQL).bind(id, userId, Date.now()),
      ]);
      return { ok: true, id, inviteCode };
    } catch (err) {
      if (!isUniqueConflict(err) || attempt === MAX_ATTEMPTS - 1) return { ok: false };
    }
  }
  return { ok: false };
}

export async function handleHouseholdCreate(
  req: Request,
  env: Env,
  user: SessionUser,
  deps?: HouseholdCreateDeps,
): Promise<Response> {
  if (req.method === "GET") return handleHouseholdGet(req, env, user);
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  if (!originAllowed(req)) return json({ error: "Origen no permitido" }, 403);
  if (!isJsonRequest(req)) return json({ error: "El contenido tiene que ser JSON" }, 415);

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "JSON inválido" }, 400);
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return json({ error: "JSON inválido" }, 400);
  }
  const body = payload as Record<string, unknown>;
  if (body.action === "join") return notPorted();
  if (body.action !== "create") return json({ error: "Acción no válida" }, 400);

  const additional = body.additional === true;

  // Count before the personal-name check. Without `additional`, an existing
  // membership is returned as-is. The first household may use a personal name.
  const countRow = await env.DB.prepare(COUNT_MEMBERSHIPS_SQL)
    .bind(user.id)
    .first<{ n: number | string }>();
  const count = Number(countRow?.n ?? 0);
  if (!Number.isFinite(count)) return json({ error: "No se pudo crear el hogar" }, 500);
  if (!additional && count > 0) return existingHouseholdResponse(req, env, user.id);

  const parsed = validateHouseholdName(body.name, {
    allowPersonal: !additional && count === 0,
  });
  if (!parsed.ok) return json({ error: parsed.error }, 400);

  if (count >= MAX_HOUSEHOLDS_PER_USER) return json({ error: HOUSEHOLD_CAP_ERROR }, 409);

  const names = await env.DB.prepare(HOUSEHOLD_NAMES_SQL)
    .bind(user.id)
    .all<{ name: string }>();
  const want = parsed.name.toLowerCase();
  const duplicate = (names.results ?? []).some(
    (row) => normalizeHouseholdName(String(row.name ?? "")).toLowerCase() === want,
  );
  if (duplicate) return json({ error: HOUSEHOLD_DUPLICATE_ERROR }, 409);

  const created = await insertHousehold(env, user.id, parsed.name, deps);
  if (!created.ok) return json({ error: "No se pudo crear el hogar" }, 500);

  const list = await listHouseholds(env, user.id);
  const cookie = serializeCookie(HOUSEHOLD_COOKIE, created.id, req, YEAR);
  return json(
    {
      ok: true,
      household: {
        household: { id: created.id, name: parsed.name, inviteCode: created.inviteCode },
        role: "owner",
      },
      activeHouseholdId: created.id,
      households: list.map(publicHousehold),
    },
    201,
    [cookie],
  );
}
