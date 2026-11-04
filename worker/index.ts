import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SEC,
  clearSessionCookie,
  readCookie,
  sessionCookie,
  signSession,
  timingSafeEqual,
  verifySession,
} from "../src/lib/auth";
import { buenosAiresToday } from "../src/lib/dates";
import {
  accountNamesSql,
  balanceSeriesQuery,
  balanceTotalsSql,
  incomeByMonthQuery,
  insertAccountSql,
  isCurrency,
  isGranularity,
  isKind,
  latestBalancesSql,
  spendingByCategoryQuery,
  spendingSeriesQuery,
  transactionsQuery,
  upsertSnapshotSql,
  type Currency,
  type Kind,
} from "../src/lib/sql";

export interface QueryResult<T> {
  results?: T[];
}

export interface RunResult {
  meta?: { changes?: number };
}

export interface Statement {
  bind(...values: Array<string | number | null>): Statement;
  all<T = Record<string, unknown>>(): Promise<QueryResult<T>>;
  run(): Promise<RunResult>;
}

export interface Db {
  prepare(sql: string): Statement;
  batch(statements: Statement[]): Promise<unknown[]>;
}

export interface Env {
  DB: Db;
  ACCESS_KEY?: string;
  SESSION_SECRET?: string;
  BALANCES_TOKEN?: string;
}

export interface HandlerOptions {
  /** YYYY-MM-DD. Defaults to today in America/Argentina/Buenos_Aires. */
  today?: string;
  /** Epoch milliseconds used for cookie expiry. */
  now?: number;
}

interface SnapshotInput {
  account: string;
  currency: Currency;
  amount: number;
  date: string;
  source: "manual" | "routine";
}

const PAGE_SIZE = 50;
const MAX_SNAPSHOTS = 50;
const LOGIN_BODY_MAX = 2048;
const BALANCES_BODY_MAX = 20_000;

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
};

export async function handleRequest(request: Request, env: Env, options: HandlerOptions = {}): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const nowMs = options.now ?? Date.now();
  const today = options.today ?? buenosAiresToday(new Date(nowMs));

  if (!path.startsWith("/api/")) {
    return json({ error: "not_found" }, 404);
  }

  if (path === "/api/login" && request.method === "POST") {
    return login(request, env, nowMs);
  }

  if (path === "/api/logout" && request.method === "POST") {
    const ok = await hasSession(request, env, nowMs);
    const headers = { "set-cookie": clearSessionCookie() };
    if (!ok) return json({ error: "unauthorized" }, 401, headers);
    return json({ ok: true }, 200, headers);
  }

  if (path === "/api/balances" && request.method === "POST") {
    return postBalances(request, env, today);
  }

  if (!(await hasSession(request, env, nowMs))) {
    return json({ error: "unauthorized" }, 401);
  }

  if (path === "/api/balances/manual" && request.method === "POST") {
    return postManualBalance(request, env, today);
  }

  if (request.method !== "GET") {
    return json({ error: "method" }, 405);
  }

  try {
    if (path === "/api/spending-by-category") {
      return await spendingByCategory(env, url, today);
    }
    if (path === "/api/income-by-month") {
      return await incomeByMonth(env, url);
    }
    if (path === "/api/spending-series") {
      return await spendingSeries(env, url, today);
    }
    if (path === "/api/transactions") {
      return await transactions(env, url);
    }
    if (path === "/api/balances") {
      return await balances(env, url, today);
    }
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.code }, error.status);
    return json({ error: "db" }, 500);
  }

  return json({ error: "not_found" }, 404);
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

async function login(request: Request, env: Env, nowMs: number): Promise<Response> {
  let body: unknown;
  try {
    body = await readJson(request, LOGIN_BODY_MAX);
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.code }, error.status);
    return json({ error: "bad_request" }, 400);
  }
  const accessKey = body && typeof body === "object" && "accessKey" in body ? (body as { accessKey?: unknown }).accessKey : "";
  const provided = typeof accessKey === "string" ? accessKey : "";
  const secret = env.ACCESS_KEY ?? "";
  const matches = secret !== "" && provided !== "" && timingSafeEqual(provided, secret);
  if (!matches) return json({ error: "unauthorized" }, 401);
  if (!env.SESSION_SECRET) return json({ error: "unconfigured" }, 500);
  const exp = Math.floor(nowMs / 1000) + SESSION_MAX_AGE_SEC;
  const token = await signSession(env.SESSION_SECRET, exp);
  return json({ ok: true }, 200, { "set-cookie": sessionCookie(token) });
}

async function hasSession(request: Request, env: Env, nowMs: number): Promise<boolean> {
  const token = readCookie(request.headers.get("cookie"), SESSION_COOKIE);
  if (!token || !env.SESSION_SECRET) return false;
  return verifySession(env.SESSION_SECRET, token, Math.floor(nowMs / 1000));
}

async function postBalances(request: Request, env: Env, today: string): Promise<Response> {
  const header = request.headers.get("authorization") ?? "";
  const prefix = "Bearer ";
  const token = header.startsWith(prefix) ? header.slice(prefix.length) : "";
  const secret = env.BALANCES_TOKEN ?? "";
  if (!secret || !timingSafeEqual(token, secret)) {
    return json({ error: "unauthorized" }, 401);
  }
  let body: unknown;
  try {
    body = await readJson(request, BALANCES_BODY_MAX);
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.code }, error.status);
    return json({ error: "bad_request" }, 400);
  }
  const parsed = parseBalanceBody(body, today, "routine");
  if ("error" in parsed) return json({ error: parsed.error }, 400);
  try {
    await upsertSnapshots(env.DB, parsed.snapshots);
  } catch {
    return json({ error: "db" }, 500);
  }
  return json({ ok: true, upserted: parsed.snapshots.length }, 200);
}

async function postManualBalance(request: Request, env: Env, today: string): Promise<Response> {
  let body: unknown;
  try {
    body = await readJson(request, BALANCES_BODY_MAX);
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.code }, error.status);
    return json({ error: "bad_request" }, 400);
  }
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  const wrapped = record && Array.isArray(record.snapshots) ? record : { snapshots: record ? [record] : [], source: "manual" };
  const parsed = parseBalanceBody(wrapped, today, "manual");
  if ("error" in parsed) return json({ error: parsed.error }, 400);
  if (parsed.snapshots.length !== 1) return json({ error: "bad_request" }, 400);
  const snapshot = { ...parsed.snapshots[0]!, source: "manual" as const };
  try {
    await upsertSnapshots(env.DB, [snapshot]);
  } catch {
    return json({ error: "db" }, 500);
  }
  return json({ ok: true, upserted: 1 }, 200);
}

function parseBalanceBody(
  body: unknown,
  today: string,
  defaultSource: "manual" | "routine",
): { snapshots: SnapshotInput[] } | { error: string } {
  if (!body || typeof body !== "object") return { error: "bad_request" };
  const record = body as Record<string, unknown>;
  if (!Array.isArray(record.snapshots)) return { error: "bad_request" };
  if (record.snapshots.length < 1 || record.snapshots.length > MAX_SNAPSHOTS) return { error: "bad_request" };
  let source: "manual" | "routine" = defaultSource;
  if (record.source !== undefined) {
    if (record.source !== "manual" && record.source !== "routine") return { error: "bad_request" };
    source = record.source;
  }
  const snapshots: SnapshotInput[] = [];
  for (const item of record.snapshots) {
    const snapshot = parseSnapshot(item, today, source);
    if ("error" in snapshot) return snapshot;
    snapshots.push(snapshot);
  }
  return { snapshots };
}

function parseSnapshot(item: unknown, today: string, source: "manual" | "routine"): SnapshotInput | { error: string } {
  if (!item || typeof item !== "object") return { error: "bad_request" };
  const record = item as Record<string, unknown>;
  if (typeof record.account !== "string") return { error: "bad_request" };
  const account = record.account.trim();
  if (!account || account.length > 60 || /[\u0000-\u001f]/.test(account)) return { error: "bad_request" };
  if (typeof record.currency !== "string" || !isCurrency(record.currency)) return { error: "bad_request" };
  if (typeof record.amount !== "number" || !Number.isFinite(record.amount)) return { error: "bad_request" };
  let date = today;
  if (record.date !== undefined && record.date !== null && record.date !== "") {
    if (typeof record.date !== "string" || !isIsoDate(record.date)) return { error: "bad_request" };
    date = record.date;
  }
  return { account, currency: record.currency, amount: record.amount, date, source };
}

async function upsertSnapshots(db: Db, snapshots: SnapshotInput[]): Promise<void> {
  const statements: Statement[] = [];
  for (const snapshot of snapshots) {
    statements.push(db.prepare(insertAccountSql).bind(snapshot.account));
    statements.push(
      db.prepare(upsertSnapshotSql).bind(
        snapshot.date,
        snapshot.currency,
        snapshot.amount,
        snapshot.source,
        snapshot.account,
      ),
    );
  }
  await db.batch(statements);
}

async function spendingByCategory(env: Env, url: URL, today: string): Promise<Response> {
  const currency = currencyParam(url, "ARS");
  const days = daysParam(url);
  const query = spendingByCategoryQuery(currency, today, days);
  const rows = await allRows(env, query.sql, query.params);
  const mapped = rows.map((row) => ({
    category: String(row.category),
    count: num(row.count),
    total: num(row.total),
  }));
  let total = 0;
  for (const row of mapped) total += row.total;
  return json({ currency, days, today, total: round2(total), rows: mapped }, 200, undefined, true);
}

async function incomeByMonth(env: Env, url: URL): Promise<Response> {
  const currency = currencyParam(url, "ARS");
  const query = incomeByMonthQuery(currency);
  const rows = await allRows(env, query.sql, query.params);
  const mapped = rows.map((row) => ({
    month: String(row.month),
    count: num(row.count),
    total: num(row.total),
  }));
  let total = 0;
  for (const row of mapped) total += row.total;
  return json({ currency, total: round2(total), rows: mapped }, 200, undefined, true);
}

async function spendingSeries(env: Env, url: URL, today: string): Promise<Response> {
  const currency = currencyParam(url, "ARS");
  const raw = url.searchParams.get("granularity") ?? "day";
  if (!isGranularity(raw)) throw new HttpError(400, "bad_request");
  const query = spendingSeriesQuery(currency, today, raw);
  const rows = await allRows(env, query.sql, query.params);
  return json(
    {
      currency,
      granularity: raw,
      today,
      rows: rows.map((row) => ({
        bucket: String(row.bucket),
        count: num(row.count),
        total: num(row.total),
      })),
    },
    200,
    undefined,
    true,
  );
}

async function transactions(env: Env, url: URL): Promise<Response> {
  const kindRaw = url.searchParams.get("kind") ?? "";
  const currencyRaw = url.searchParams.get("currency") ?? "";
  if (kindRaw !== "" && !isKind(kindRaw)) throw new HttpError(400, "bad_request");
  if (currencyRaw !== "" && !isCurrency(currencyRaw)) throw new HttpError(400, "bad_request");
  const cursor = parseCursor(url.searchParams.get("cursor"));
  if ("error" in cursor) throw new HttpError(400, "bad_request");
  const query = transactionsQuery({
    kind: kindRaw as "" | Kind,
    currency: currencyRaw as "" | Currency,
    cursorDate: cursor.date,
    cursorId: cursor.id,
    limit: PAGE_SIZE + 1,
  });
  const rows = await allRows(env, query.sql, query.params);
  const page = rows.slice(0, PAGE_SIZE).map((row) => ({
    id: num(row.id),
    date: String(row.date),
    amount: num(row.amount),
    currency: String(row.currency),
    account: String(row.account),
    category: String(row.category),
    description: String(row.description),
    kind: String(row.kind),
  }));
  const last = page[page.length - 1];
  const nextCursor = rows.length > PAGE_SIZE && last ? `${last.date}|${last.id}` : null;
  return json({ rows: page, nextCursor }, 200, undefined, true);
}

async function balances(env: Env, url: URL, today: string): Promise<Response> {
  const currencyRaw = url.searchParams.get("currency") ?? "ARS";
  if (!isCurrency(currencyRaw)) throw new HttpError(400, "bad_request");
  const latest = await allRows(env, latestBalancesSql, []);
  const totals = await allRows(env, balanceTotalsSql, []);
  const seriesQuery = balanceSeriesQuery(currencyRaw);
  const series = await allRows(env, seriesQuery.sql, seriesQuery.params);
  const accounts = await allRows(env, accountNamesSql, []);
  return json(
    {
      today,
      currency: currencyRaw,
      latest: latest.map((row) => ({
        account: String(row.account),
        currency: String(row.currency),
        amount: num(row.amount),
        date: String(row.date),
        source: String(row.source),
      })),
      totals: totals.map((row) => ({ currency: String(row.currency), total: num(row.total) })),
      series: series.map((row) => ({
        account: String(row.account),
        date: String(row.date),
        amount: num(row.amount),
      })),
      accounts: accounts.map((row) => String(row.name)),
    },
    200,
    undefined,
    true,
  );
}

function currencyParam(url: URL, fallback: Currency): Currency {
  const raw = url.searchParams.get("currency") ?? fallback;
  if (!isCurrency(raw)) throw new HttpError(400, "bad_request");
  return raw;
}

function daysParam(url: URL): number {
  const raw = url.searchParams.get("days");
  if (raw === null || raw === "") return 90;
  if (!/^\d+$/.test(raw)) throw new HttpError(400, "bad_request");
  const days = Number(raw);
  if (days < 1 || days > 3660) throw new HttpError(400, "bad_request");
  return days;
}

function parseCursor(raw: string | null): { date: string; id: number } | { error: true } {
  if (!raw) return { date: "", id: 0 };
  const pipe = raw.lastIndexOf("|");
  if (pipe <= 0) return { error: true };
  const date = raw.slice(0, pipe);
  const idText = raw.slice(pipe + 1);
  if (!isIsoDate(date) || !/^\d+$/.test(idText)) return { error: true };
  return { date, id: Number(idText) };
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

async function allRows(env: Env, sql: string, params: Array<string | number | null>): Promise<Record<string, unknown>[]> {
  const statement = params.length > 0 ? env.DB.prepare(sql).bind(...params) : env.DB.prepare(sql);
  const result = await statement.all<Record<string, unknown>>();
  return result.results ?? [];
}

async function readJson(request: Request, maxBytes: number): Promise<unknown> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) throw new HttpError(413, "too_large");
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, "too_large");
  if (!text) throw new HttpError(400, "bad_request");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HttpError(400, "bad_request");
  }
}

function num(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function json(data: unknown, status: number, extra?: Record<string, string>, cache = false): Response {
  const headers: Record<string, string> = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": cache ? "private, max-age=30" : "no-store",
  };
  if (extra) Object.assign(headers, extra);
  return new Response(JSON.stringify(data), { status, headers });
}
