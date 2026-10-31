import type { D1Prepared, Env } from "./env";

/**
 * Cuentix -> Serpix outbox. Web Crypto only. Callers batch the returned
 * statements with the movement write, then ctx.waitUntil(flushOutbox).
 * Flush never throws and never logs the body, the signature, or the secret.
 */

export const MAX_SYNC_ATTEMPTS = 12;
export const SYNC_BACKOFF_BASE_MS = 30_000;
const BODY_MAX = 16 * 1024;
const DUE_LIMIT = 20;

export type SyncEventType = "upsert" | "delete";
export type SyncStatus = "sent" | "pending" | "error";

export type OutboxDraft = {
  id: string;
  txId: string;
  eventId: string;
  type: SyncEventType;
  payload: string;
  createdAt: number;
};

type PrepareDb = {
  prepare(query: string): D1Prepared;
};

export type BusinessAction =
  | { kind: "none" }
  | { kind: "reject"; status: number; error: string }
  | { kind: "upsert"; version: number; isBusiness: 1 }
  | { kind: "delete"; version: number; isBusiness: 0 };

/** One extra join: the newest outbox row for each movement. */
export const OUTBOX_LATEST_JOIN = `LEFT JOIN serpix_outbox sx ON sx.id = (
  SELECT sx2.id FROM serpix_outbox sx2
  WHERE sx2.tx_id = t.id
  ORDER BY sx2.created_at DESC, sx2.id DESC
  LIMIT 1
)`;

export function nextBusinessVersion(prev: number | null, now: number): number {
  const base = prev ?? 0;
  return now > base ? now : base + 1;
}

export function syncBackoffMs(attemptsAfterFailure: number): number {
  const step = Math.min(Math.max(attemptsAfterFailure, 1), 10);
  return SYNC_BACKOFF_BASE_MS * 2 ** (step - 1);
}

/**
 * Decimal text to a positive cent count. Digit strings only — no binary float
 * of the amount. The carry below is a single digit (0–19).
 * Third decimal digit rounds half up. A leading minus is ignored (kind carries the sign).
 */
export function decimalTextToMinor(raw: string): number {
  const minor = parseDecimalMinor(raw);
  if (minor == null) throw new Error("monto inválido");
  return minor;
}

export function syncStatusFromOutbox(row: {
  is_business: number | boolean;
  sync_type: string | null;
  sync_sent_at: number | null;
  sync_failed_at: number | null;
}): SyncStatus | null {
  const business = row.is_business === 1 || row.is_business === true;
  const hasOutbox =
    row.sync_type != null || row.sync_sent_at != null || row.sync_failed_at != null;
  if (!hasOutbox) return business ? "pending" : null;
  if (row.sync_failed_at != null) return "error";
  if (row.sync_sent_at != null) return business ? "sent" : null;
  return "pending";
}

export function resolveBusinessAction(input: {
  isBusiness: number;
  businessVersion: number | null;
  mark: boolean | null;
  nextIsPayment: number;
  nextOwnership: string;
  syncFields: boolean;
  now: number;
}): BusinessAction {
  const marking = input.mark === true;
  const unmarking = input.mark === false;
  if (marking && input.nextIsPayment === 1) {
    return { kind: "reject", status: 400, error: "No se puede marcar un pago de tarjeta" };
  }
  if (marking && input.nextOwnership !== "personal") {
    return { kind: "reject", status: 400, error: "Solo podés marcar movimientos personales" };
  }

  const was = input.isBusiness === 1;
  const leavesScope = input.nextIsPayment === 1 || input.nextOwnership !== "personal";
  const version = nextBusinessVersion(input.businessVersion, input.now);

  if (unmarking) {
    if (!was) return { kind: "none" };
    return { kind: "delete", version, isBusiness: 0 };
  }
  if (was && leavesScope) {
    return { kind: "delete", version, isBusiness: 0 };
  }
  if (marking) {
    if (was && !input.syncFields) return { kind: "none" };
    return { kind: "upsert", version, isBusiness: 1 };
  }
  if (was && input.syncFields) {
    return { kind: "upsert", version, isBusiness: 1 };
  }
  return { kind: "none" };
}

export function buildDeletePayload(input: {
  eventId: string;
  sourceId: string;
  version: number;
}): string {
  return JSON.stringify({
    v: 1,
    event_id: input.eventId,
    type: "delete",
    source: "cuentix",
    source_id: input.sourceId,
    version: input.version,
  });
}

export function buildUpsertPayload(input: {
  eventId: string;
  sourceId: string;
  version: number;
  occurredAt: string;
  isCredit: number;
  amountArs: string | null;
  amountUsd: string | null;
  description: string;
  categoryName: string | null;
  categorySlug: string | null;
}): { ok: true; body: string } | { ok: false; error: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.occurredAt)) {
    return { ok: false, error: "Fecha inválida para enviar a Serpix" };
  }
  const picked = pickCurrency(input.amountArs, input.amountUsd);
  if (!picked) return { ok: false, error: "Este movimiento no tiene monto para mandar a Serpix" };
  let minor: number;
  try {
    minor = decimalTextToMinor(picked.text);
  } catch {
    return { ok: false, error: "El monto no se puede enviar a Serpix" };
  }
  if (minor <= 0) {
    return { ok: false, error: "El monto tiene que ser mayor a cero para mandarlo a Serpix" };
  }
  const body = JSON.stringify({
    v: 1,
    event_id: input.eventId,
    type: "upsert",
    source: "cuentix",
    source_id: input.sourceId,
    version: input.version,
    occurred_at: input.occurredAt,
    kind: input.isCredit === 1 ? "income" : "expense",
    amount_minor: minor,
    currency: picked.currency,
    description: clip(input.description.trim() || "Sin descripción", 500),
    category: categoryLabel(input.categoryName, input.categorySlug),
  });
  if (body.length > BODY_MAX) {
    return { ok: false, error: "El movimiento es demasiado largo para Serpix" };
  }
  return { ok: true, body };
}

export function enqueueOutboxStatements(db: PrepareDb, draft: OutboxDraft): D1Prepared[] {
  return [
    db
      .prepare(
        `INSERT INTO serpix_outbox (
           id, tx_id, event_id, type, payload, created_at, attempts,
           next_attempt_at, last_error, sent_at, failed_at
         ) VALUES (?, ?, ?, ?, ?, ?, 0, NULL, NULL, NULL, NULL)`,
      )
      .bind(draft.id, draft.txId, draft.eventId, draft.type, draft.payload, draft.createdAt),
  ];
}

export async function signSyncBody(
  secret: string,
  timestamp: string,
  nonce: string,
  rawBody: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${nonce}.${rawBody}`),
  );
  return `v1=${toHex(new Uint8Array(mac))}`;
}

export function randomSyncNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

export type FlushOptions = {
  now?: number;
  fetchImpl?: typeof fetch;
};

type OutboxRow = {
  id: string;
  tx_id: string;
  payload: string;
  attempts: number;
  created_at: number;
  next_attempt_at: number | null;
};

/**
 * Send pending events. `ids` limits the flush to those outbox rows' movements
 * (plus older unsent siblings, so a newer event wins). Omit `ids` for the cron.
 * Missing secret or URL leaves rows pending.
 */
export async function flushOutbox(env: Env, ids?: string[], opts?: FlushOptions): Promise<void> {
  try {
    await flushInner(env, ids, opts);
  } catch {
    // Leave the row pending. The cron retries. Do not surface body or secret.
  }
}

async function flushInner(env: Env, ids: string[] | undefined, opts: FlushOptions | undefined): Promise<void> {
  const secret = env.CUENTIX_SYNC_SECRET;
  const url = env.SERPIX_SYNC_URL;
  if (!secret || !url) return;
  if (ids && ids.length === 0) return;

  const now = opts?.now ?? Date.now();
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const rows = await loadPending(env, now, ids);
  if (rows.length === 0) return;

  const { send, drop } = coalesce(rows);
  if (drop.length > 0) {
    const placeholders = drop.map(() => "?").join(", ");
    await env.DB.prepare(
      `UPDATE serpix_outbox
       SET sent_at = ?, last_error = 'coalesced'
       WHERE sent_at IS NULL AND failed_at IS NULL AND id IN (${placeholders})`,
    )
      .bind(now, ...drop.map((row) => row.id))
      .run();
  }
  // Cron loads only the latest due row. Drop every older unsent sibling too,
  // so a later tick cannot deliver a stale event after the new one.
  if (send.length > 0) {
    const txIds = [...new Set(send.map((row) => row.tx_id))];
    const txPlace = txIds.map(() => "?").join(", ");
    const idPlace = send.map(() => "?").join(", ");
    await env.DB.prepare(
      `UPDATE serpix_outbox
       SET sent_at = ?, last_error = 'coalesced'
       WHERE sent_at IS NULL AND failed_at IS NULL
         AND tx_id IN (${txPlace})
         AND id NOT IN (${idPlace})`,
    )
      .bind(now, ...txIds, ...send.map((row) => row.id))
      .run();
  }

  for (const row of send) {
    if (!isDue(row, now)) continue;
    if (row.payload.length > BODY_MAX) {
      await markFailed(env, row, "too_large", now);
      continue;
    }
    const timestamp = String(now);
    const nonce = randomSyncNonce();
    const signature = await signSyncBody(secret, timestamp, nonce, row.payload);
    let res: Response;
    try {
      res = await fetchImpl(url, {
        method: "POST",
        redirect: "manual",
        headers: {
          "content-type": "application/json",
          "X-Sync-Timestamp": timestamp,
          "X-Sync-Nonce": nonce,
          "X-Sync-Signature": signature,
        },
        body: row.payload,
      });
    } catch {
      await markRetry(env, row, "network", now);
      continue;
    }
    if (res.status >= 200 && res.status < 300) {
      await markSent(env, row.id, now);
      continue;
    }
    const code = `http_${res.status}`;
    if (isRetryableStatus(res.status)) await markRetry(env, row, code, now);
    else await markFailed(env, row, code, now);
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 401 || status === 409 || status === 429 || status >= 500;
}

async function loadPending(env: Env, now: number, ids: string[] | undefined): Promise<OutboxRow[]> {
  if (ids && ids.length > 0) {
    const wanted = ids.slice(0, DUE_LIMIT);
    const placeholders = wanted.map(() => "?").join(", ");
    const res = await env.DB.prepare(
      `SELECT id, tx_id, payload, attempts, created_at, next_attempt_at
       FROM serpix_outbox
       WHERE sent_at IS NULL AND failed_at IS NULL
         AND tx_id IN (SELECT tx_id FROM serpix_outbox WHERE id IN (${placeholders}))
       ORDER BY created_at ASC, id ASC
       LIMIT 50`,
    )
      .bind(...wanted)
      .all<OutboxRow>();
    return (res.results ?? []).map(normalizeRow);
  }
  const res = await env.DB.prepare(
    `SELECT o.id, o.tx_id, o.payload, o.attempts, o.created_at, o.next_attempt_at
     FROM serpix_outbox o
     WHERE o.sent_at IS NULL AND o.failed_at IS NULL
       AND (o.next_attempt_at IS NULL OR o.next_attempt_at <= ?)
       AND NOT EXISTS (
         SELECT 1 FROM serpix_outbox n
         WHERE n.tx_id = o.tx_id
           AND n.sent_at IS NULL AND n.failed_at IS NULL
           AND (
             n.created_at > o.created_at
             OR (n.created_at = o.created_at AND n.id > o.id)
           )
       )
     ORDER BY o.created_at ASC
     LIMIT ${DUE_LIMIT}`,
  )
    .bind(now)
    .all<OutboxRow>();
  return (res.results ?? []).map(normalizeRow);
}

function normalizeRow(row: OutboxRow): OutboxRow {
  return {
    id: String(row.id),
    tx_id: String(row.tx_id),
    payload: String(row.payload),
    attempts: Number(row.attempts) || 0,
    created_at: Number(row.created_at) || 0,
    next_attempt_at: row.next_attempt_at == null ? null : Number(row.next_attempt_at),
  };
}

function coalesce(rows: OutboxRow[]): { send: OutboxRow[]; drop: OutboxRow[] } {
  const best = new Map<string, OutboxRow>();
  const drop: OutboxRow[] = [];
  for (const row of rows) {
    const cur = best.get(row.tx_id);
    if (!cur) {
      best.set(row.tx_id, row);
      continue;
    }
    const newer =
      row.created_at > cur.created_at ||
      (row.created_at === cur.created_at && row.id > cur.id);
    if (newer) {
      drop.push(cur);
      best.set(row.tx_id, row);
    } else {
      drop.push(row);
    }
  }
  return { send: [...best.values()], drop };
}

function isDue(row: OutboxRow, now: number): boolean {
  return row.next_attempt_at == null || row.next_attempt_at <= now;
}

async function markSent(env: Env, id: string, now: number): Promise<void> {
  await env.DB.prepare(
    `UPDATE serpix_outbox
     SET sent_at = ?, last_error = NULL
     WHERE id = ? AND sent_at IS NULL`,
  )
    .bind(now, id)
    .run();
}

async function markRetry(env: Env, row: OutboxRow, error: string, now: number): Promise<void> {
  const attempts = row.attempts + 1;
  if (attempts >= MAX_SYNC_ATTEMPTS) {
    await markFailed(env, row, error, now);
    return;
  }
  const next = now + syncBackoffMs(attempts);
  await env.DB.prepare(
    `UPDATE serpix_outbox
     SET attempts = ?, next_attempt_at = ?, last_error = ?
     WHERE id = ? AND sent_at IS NULL AND failed_at IS NULL`,
  )
    .bind(attempts, next, clip(error, 80), row.id)
    .run();
}

async function markFailed(env: Env, row: OutboxRow, error: string, now: number): Promise<void> {
  await env.DB.prepare(
    `UPDATE serpix_outbox
     SET attempts = ?, failed_at = ?, last_error = ?, next_attempt_at = NULL
     WHERE id = ? AND sent_at IS NULL AND failed_at IS NULL`,
  )
    .bind(row.attempts + 1, now, clip(error, 80), row.id)
    .run();
}

function pickCurrency(
  amountArs: string | null,
  amountUsd: string | null,
): { currency: "ARS" | "USD"; text: string } | null {
  const ars = present(amountArs);
  const usd = present(amountUsd);
  if (ars != null) return { currency: "ARS", text: ars };
  if (usd != null) return { currency: "USD", text: usd };
  return null;
}

function present(value: string | null): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function categoryLabel(name: string | null, slug: string | null): string {
  const trimmedName = (name ?? "").trim();
  if (
    trimmedName &&
    trimmedName.toLowerCase() !== "uncategorized" &&
    trimmedName.toLowerCase() !== "sin categoría"
  ) {
    return clip(trimmedName, 100);
  }
  const trimmedSlug = (slug ?? "").trim();
  if (trimmedSlug && trimmedSlug !== "uncategorized") return clip(trimmedSlug, 100);
  return "Cuentix";
}

function clip(value: string, max: number): string {
  const chars = [...value];
  return chars.length <= max ? value : chars.slice(0, max).join("");
}

function parseDecimalMinor(raw: string): number | null {
  let s = raw.trim();
  if (!s) return null;
  if (s[0] === "+" || s[0] === "-") s = s.slice(1).trim();
  if (!s) return null;
  if (s.includes(",") && s.includes(".")) s = s.replaceAll(",", "");
  else if (s.includes(",") && !s.includes(".")) s = s.replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const dot = s.indexOf(".");
  const whole = dot === -1 ? s : s.slice(0, dot);
  const frac = dot === -1 ? "" : s.slice(dot + 1);
  const frac3 = `${frac}000`.slice(0, 3);
  const cents = frac3.slice(0, 2);
  const roundUp = frac3.charCodeAt(2) >= 53;
  let digits = `${stripLeadingZeros(whole)}${cents}`;
  if (roundUp) digits = addDigitStrings(digits, "1");
  digits = stripLeadingZeros(digits);
  if (digits === "0") return 0;
  if (digits.length > 15) return null;
  const n = Number(digits);
  if (!Number.isSafeInteger(n)) return null;
  return n;
}

function stripLeadingZeros(value: string): string {
  let i = 0;
  while (i < value.length - 1 && value.charCodeAt(i) === 48) i += 1;
  return value.slice(i);
}

function addDigitStrings(a: string, b: string): string {
  let i = a.length - 1;
  let j = b.length - 1;
  let carry = 0;
  let out = "";
  while (i >= 0 || j >= 0 || carry > 0) {
    const da = i >= 0 ? a.charCodeAt(i) - 48 : 0;
    const db = j >= 0 ? b.charCodeAt(j) - 48 : 0;
    const sum = da + db + carry;
    out = String(sum % 10) + out;
    carry = Math.floor(sum / 10);
    i -= 1;
    j -= 1;
  }
  return out;
}

function toHex(bytes: Uint8Array): string {
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}
