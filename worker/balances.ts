/**
 * Bank balance snapshots.
 * GET /api/balances                         session, one currency of history
 * POST /api/balances/manual                 session, one snapshot, source manual
 * POST /api/balances                        bearer BALANCES_TOKEN, up to 50, source routine
 *
 * ARS, USDT, and USD are stored and totaled apart. Nothing here converts them.
 */

import { pickActiveHouseholdId } from "../src/lib/household-select";
import { isCurrency, type Currency } from "../src/lib/stats/currency";
import { ADMIN_EMAIL, type SessionUser } from "./auth";
import type { Env } from "./env";
import { activeHousehold } from "./household";
import { json, jsonPrivate, num, sha256Hex, todayAr } from "./http";

const MAX_SNAPSHOTS = 50;
const BODY_MAX = 20_000;
const TOKEN_MAX = 512;

interface SnapshotInput {
  account: string;
  currency: Currency;
  amount: number;
  date: string;
  source: "manual" | "routine";
}

export async function handleBalancesGet(
  req: Request,
  env: Env,
  user: SessionUser,
): Promise<Response> {
  if (req.method !== "GET") return json({ error: "Método no permitido" }, 405);
  const url = new URL(req.url);
  const raw = url.searchParams.get("currency") ?? "ARS";
  if (!isCurrency(raw)) return json({ error: "Moneda inválida" }, 400);
  const { active } = await activeHousehold(req, env, user.id);
  if (!active) return json({ error: "NO_HOUSEHOLD" }, 400);

  try {
    const [latest, totals, series, accounts] = await Promise.all([
      env.DB.prepare(LATEST_SQL).bind(user.id, active.id).all<LatestRow>(),
      env.DB.prepare(TOTALS_SQL).bind(user.id, active.id).all<{ currency: string; total: number | null }>(),
      env.DB.prepare(SERIES_SQL)
        .bind(user.id, active.id, raw)
        .all<{ account: string; date: string; amount: number | null }>(),
      env.DB.prepare(ACCOUNTS_SQL)
        .bind(user.id, active.id, user.id, active.id)
        .all<{ name: string }>(),
    ]);
    return jsonPrivate({
      today: todayAr(),
      currency: raw,
      latest: (latest.results ?? []).map((row) => ({
        account: String(row.account),
        currency: String(row.currency),
        amount: num(row.amount),
        date: String(row.date),
        source: String(row.source),
      })),
      totals: (totals.results ?? []).map((row) => ({
        currency: String(row.currency),
        total: num(row.total),
      })),
      series: (series.results ?? []).map((row) => ({
        account: String(row.account),
        date: String(row.date),
        amount: num(row.amount),
      })),
      accounts: (accounts.results ?? []).map((row) => String(row.name)),
    });
  } catch (err) {
    console.error("balances read failed", err instanceof Error ? err.name : "error");
    return json({ error: "No se pudieron leer los saldos" }, 500);
  }
}

export async function handleBalancesManual(
  req: Request,
  env: Env,
  user: SessionUser,
): Promise<Response> {
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  const { active } = await activeHousehold(req, env, user.id);
  if (!active) return json({ error: "NO_HOUSEHOLD" }, 400);
  const body = await readJson(req);
  if (body instanceof Response) return body;
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  const wrapped =
    record && Array.isArray(record.snapshots)
      ? record
      : { snapshots: record ? [record] : [] };
  const parsed = parseBalanceBody(wrapped, todayAr(), "manual");
  if ("error" in parsed) return json({ error: "Datos inválidos" }, 400);
  if (parsed.snapshots.length !== 1) return json({ error: "Datos inválidos" }, 400);
  const snapshot = { ...parsed.snapshots[0]!, source: "manual" as const };
  try {
    await upsertSnapshots(env, user.id, active.id, [snapshot]);
  } catch (err) {
    console.error("balances manual failed", err instanceof Error ? err.name : "error");
    return json({ error: "No se pudo guardar el saldo" }, 500);
  }
  return json({ ok: true, upserted: 1 });
}

/** Operator routine. Session cookie is not accepted. */
export async function handleBalancesRoutine(req: Request, env: Env): Promise<Response> {
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  const presented = bearer(req);
  if (!(await tokenMatches(presented, env.BALANCES_TOKEN))) {
    return json({ error: "No autenticado" }, 401);
  }
  const body = await readJson(req);
  if (body instanceof Response) return body;
  const parsed = parseBalanceBody(body, todayAr(), "routine");
  if ("error" in parsed) return json({ error: "Datos inválidos" }, 400);
  const owner = await routineUser(env);
  if (!owner) return json({ error: "No autenticado" }, 401);
  const householdId = await routineHousehold(env, owner.id, householdHint(body));
  if (!householdId) return json({ error: "NO_HOUSEHOLD" }, 400);
  const snapshots = parsed.snapshots.map((row) => ({
    ...row,
    source: "routine" as const,
  }));
  try {
    await upsertSnapshots(env, owner.id, householdId, snapshots);
  } catch (err) {
    console.error("balances routine failed", err instanceof Error ? err.name : "error");
    return json({ error: "No se pudo guardar el saldo" }, 500);
  }
  return json({ ok: true, upserted: snapshots.length });
}

async function routineUser(env: Env): Promise<{ id: string } | null> {
  const configured = env.BALANCES_USER_EMAIL?.trim().toLowerCase();
  const email = configured || ADMIN_EMAIL;
  const row = await env.DB.prepare(
    `SELECT id FROM users WHERE lower(email) = ? LIMIT 1`,
  )
    .bind(email)
    .first<{ id: string }>();
  return row?.id ? { id: row.id } : null;
}

async function routineHousehold(env: Env, userId: string, preferred: string | null): Promise<string | null> {
  const res = await env.DB.prepare(
    `SELECT h.id AS id, h.name AS name, m.joined_at AS joined_at
     FROM household_members m
     INNER JOIN households h ON h.id = m.household_id
     WHERE m.user_id = ?`,
  )
    .bind(userId)
    .all<{ id: string; name: string; joined_at: number | null }>();
  return pickActiveHouseholdId(
    (res.results ?? []).map((row) => ({
      householdId: row.id,
      name: row.name,
      joinedAt: row.joined_at == null ? null : new Date(row.joined_at),
    })),
    preferred,
  );
}

function householdHint(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const raw = (body as { householdId?: unknown }).householdId;
  if (typeof raw !== "string") return null;
  const id = raw.trim();
  return id.length > 0 && id.length <= 80 ? id : null;
}

function parseBalanceBody(
  body: unknown,
  today: string,
  defaultSource: "manual" | "routine",
): { snapshots: SnapshotInput[] } | { error: true } {
  if (!body || typeof body !== "object") return { error: true };
  const record = body as Record<string, unknown>;
  if (!Array.isArray(record.snapshots)) return { error: true };
  if (record.snapshots.length < 1 || record.snapshots.length > MAX_SNAPSHOTS) return { error: true };
  if (record.source !== undefined && record.source !== "manual" && record.source !== "routine") {
    return { error: true };
  }
  const source = defaultSource;
  const snapshots: SnapshotInput[] = [];
  for (const item of record.snapshots) {
    const snapshot = parseSnapshot(item, today, source);
    if ("error" in snapshot) return snapshot;
    snapshots.push(snapshot);
  }
  return { snapshots };
}

function parseSnapshot(
  item: unknown,
  today: string,
  source: "manual" | "routine",
): SnapshotInput | { error: true } {
  if (!item || typeof item !== "object") return { error: true };
  const record = item as Record<string, unknown>;
  if (typeof record.account !== "string") return { error: true };
  const account = record.account.trim();
  if (!account || account.length > 60 || /[\u0000-\u001f]/.test(account)) return { error: true };
  if (typeof record.currency !== "string" || !isCurrency(record.currency)) return { error: true };
  if (typeof record.amount !== "number" || !Number.isFinite(record.amount)) return { error: true };
  let date = today;
  if (record.date !== undefined && record.date !== null && record.date !== "") {
    if (typeof record.date !== "string" || !isIsoDate(record.date)) return { error: true };
    date = record.date;
  }
  return { account, currency: record.currency, amount: record.amount, date, source };
}

async function upsertSnapshots(
  env: Env,
  userId: string,
  householdId: string,
  snapshots: SnapshotInput[],
): Promise<void> {
  const now = Date.now();
  const statements = snapshots.map((snapshot) =>
    env.DB.prepare(UPSERT_SQL).bind(
      crypto.randomUUID(),
      userId,
      householdId,
      snapshot.account,
      snapshot.date,
      snapshot.currency,
      moneyText(snapshot.amount),
      snapshot.source,
      now,
    ),
  );
  await env.DB.batch(statements);
}

function moneyText(amount: number): string {
  const rounded = Math.round(amount * 1e8) / 1e8;
  return rounded.toFixed(8).replace(/0+$/, "").replace(/\.$/, "");
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

async function readJson(req: Request): Promise<unknown | Response> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > BODY_MAX) return json({ error: "Demasiado grande" }, 413);
  const text = await req.text();
  if (text.length > BODY_MAX) return json({ error: "Demasiado grande" }, 413);
  if (!text) return json({ error: "Datos inválidos" }, 400);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return json({ error: "Datos inválidos" }, 400);
  }
}

function bearer(req: Request): string {
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)/i.exec(header.trim());
  return match?.[1] ?? "";
}

async function tokenMatches(presented: string, secret: string | undefined): Promise<boolean> {
  if (!secret || !presented || presented.length > TOKEN_MAX) return false;
  const [left, right] = await Promise.all([sha256Hex(presented), sha256Hex(secret)]);
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

type LatestRow = {
  account: string;
  currency: string;
  amount: string | number | null;
  date: string;
  source: string;
};

const LATEST_SQL = `
  SELECT b.account_name AS account,
         b.currency AS currency,
         b.amount AS amount,
         b.date AS date,
         b.source AS source
  FROM balance_snapshots b
  WHERE b.user_id = ?
    AND b.household_id = ?
    AND b.date = (
      SELECT MAX(b2.date)
      FROM balance_snapshots b2
      WHERE b2.user_id = b.user_id
        AND b2.household_id = b.household_id
        AND b2.account_name = b.account_name
        AND b2.currency = b.currency
    )
  ORDER BY b.account_name ASC, b.currency ASC
`;

const TOTALS_SQL = `
  SELECT currency, ROUND(SUM(CAST(amount AS REAL)), 2) AS total
  FROM (
    SELECT b.currency AS currency, b.amount AS amount
    FROM balance_snapshots b
    WHERE b.user_id = ?
      AND b.household_id = ?
      AND b.date = (
        SELECT MAX(b2.date)
        FROM balance_snapshots b2
        WHERE b2.user_id = b.user_id
          AND b2.household_id = b.household_id
          AND b2.account_name = b.account_name
          AND b2.currency = b.currency
      )
  )
  GROUP BY currency
  ORDER BY currency ASC
`;

const SERIES_SQL = `
  SELECT account_name AS account, date AS date, CAST(amount AS REAL) AS amount
  FROM balance_snapshots
  WHERE user_id = ? AND household_id = ? AND currency = ?
  ORDER BY date ASC, account_name ASC
`;

const ACCOUNTS_SQL = `
  SELECT name FROM (
    SELECT account_name AS name
    FROM balance_snapshots
    WHERE user_id = ? AND household_id = ?
    UNION
    SELECT label AS name
    FROM savings_assets
    WHERE user_id = ? AND household_id = ? AND kind = 'bank'
  )
  ORDER BY name ASC
`;

const UPSERT_SQL = `
  INSERT INTO balance_snapshots (
    id, user_id, household_id, account_name, date, currency, amount, source, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(user_id, household_id, account_name, currency, date) DO UPDATE SET
    amount = excluded.amount,
    source = excluded.source
`;
