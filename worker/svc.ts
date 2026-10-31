import { netWorthDeltas } from "../src/lib/patrimonio";
import { ADMIN_EMAIL, type SessionUser } from "./auth";
import { buildMonthlyResumen } from "./dashboard";
import type { Env } from "./env";
import { buildAhorros, buildDebtStats, buildPatrimonio } from "./finance";
import { currentPeriodAr, json, periodRange, shiftPeriod } from "./http";
import { listServiceMovements } from "./transactions";

const MAX_MONTHS = 24;
const DEFAULT_MONTHS = 6;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const MAX_TOKEN_CHARS = 512;

/**
 * Read-only API for a server-to-server caller (plain fetch, including a
 * Worker service binding). Bearer is checked here and nowhere else.
 * Cookie sessions never satisfy this gate.
 */
export async function handleSvc(req: Request, env: Env): Promise<Response> {
  if (req.method !== "GET") return json({ error: "Método no permitido" }, 405);
  const user = await requireServiceUser(req, env);
  if (user instanceof Response) return user;

  const path = pathname(req);
  if (path === "/api/svc/resumen-mensual") return resumenMensual(req, env, user);
  if (path === "/api/svc/deuda-ahorro-patrimonio") return deudaAhorroPatrimonio(req, env, user);
  if (path === "/api/svc/ultimos-movimientos") return ultimosMovimientos(req, env, user);
  return json({ error: "No encontrado" }, 404);
}

async function requireServiceUser(req: Request, env: Env): Promise<SessionUser | Response> {
  const presented = bearerToken(req);
  const matches = await serviceTokenMatches(presented, env.MCP_SERVICE_TOKEN);
  if (!matches) return json({ error: "No autenticado" }, 401);

  const configured = env.MCP_SERVICE_USER_EMAIL?.trim().toLowerCase();
  const email = configured || ADMIN_EMAIL;
  const row = await env.DB.prepare(
    `SELECT id, email, name, image FROM auth_user WHERE lower(email) = ? LIMIT 1`,
  )
    .bind(email)
    .first<SessionUser>();
  if (!row?.id || !row.email) return json({ error: "No autenticado" }, 401);
  return { id: row.id, email: row.email, name: row.name ?? null, image: row.image ?? null };
}

function bearerToken(req: Request): string {
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)/i.exec(header.trim());
  return match?.[1] ?? "";
}

/**
 * SHA-256 both sides, then a full-length XOR compare.
 * An unset secret, a missing bearer, and a wrong bearer all fail the same way.
 */
async function serviceTokenMatches(presented: string, secret: string | undefined): Promise<boolean> {
  const material = presented.length > MAX_TOKEN_CHARS ? `too-long:${presented.length}` : presented;
  const [left, right] = await Promise.all([
    sha256Bytes(material),
    sha256Bytes(secret ?? ""),
  ]);
  const equal = timingSafeEqual(left, right);
  if (!secret || !presented || presented.length > MAX_TOKEN_CHARS) return false;
  return equal;
}

async function sha256Bytes(value: string): Promise<Uint8Array> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return new Uint8Array(buf);
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length === b.length ? 0 : 1;
  for (let i = 0; i < len; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

async function resumenMensual(req: Request, env: Env, user: SessionUser): Promise<Response> {
  const range = parseMonthRange(new URL(req.url));
  if (range instanceof Response) return range;
  const built = await buildMonthlyResumen(req, env, user, range.from, range.to);
  if (built instanceof Response) return built;
  return json(built);
}

async function deudaAhorroPatrimonio(req: Request, env: Env, user: SessionUser): Promise<Response> {
  const [debt, savings, patrimonio] = await Promise.all([
    buildDebtStats(env, user),
    buildAhorros(env, user),
    buildPatrimonio(req, env, user),
  ]);
  const changes = netWorthDeltas(
    patrimonio.current.date,
    patrimonio.current.netWorthArs,
    patrimonio.series,
  );
  return json({
    debt: {
      cardStatus: debt.cardStatus,
      summary: debt.summary,
    },
    savings: savings.summary,
    patrimonio: {
      ...patrimonio,
      changes,
    },
  });
}

async function ultimosMovimientos(req: Request, env: Env, user: SessionUser): Promise<Response> {
  const url = new URL(req.url);
  const limit = parseLimit(url.searchParams.get("limit"));
  if (limit instanceof Response) return limit;
  const period = url.searchParams.get("period");
  if (period != null && period !== "" && !periodRange(period)) {
    return json({ error: "Período inválido" }, 400);
  }
  const page = await listServiceMovements(req, env, user, { limit });
  if (page instanceof Response) return page;
  return json({ limit, total: page.total, movements: page.movements });
}

function parseMonthRange(url: URL): { from: string; to: string } | Response {
  const fromRaw = url.searchParams.get("from");
  const toRaw = url.searchParams.get("to");
  const hasFrom = fromRaw != null && fromRaw !== "";
  const hasTo = toRaw != null && toRaw !== "";
  if (hasFrom !== hasTo) return json({ error: "Período inválido" }, 400);

  let from: string;
  let to: string;
  if (!hasFrom || !hasTo || fromRaw == null || toRaw == null) {
    to = currentPeriodAr();
    from = shiftPeriod(to, -(DEFAULT_MONTHS - 1));
  } else if (!periodRange(fromRaw) || !periodRange(toRaw)) {
    return json({ error: "Período inválido" }, 400);
  } else {
    from = fromRaw;
    to = toRaw;
  }
  if (from > to || monthSpan(from, to) > MAX_MONTHS) {
    return json({ error: "Período inválido" }, 400);
  }
  return { from, to };
}

function monthSpan(from: string, to: string): number {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm) + 1;
}

function parseLimit(raw: string | null): number | Response {
  if (raw == null || raw.trim() === "") return DEFAULT_LIMIT;
  const text = raw.trim();
  if (!/^\d{1,2}$/.test(text)) return json({ error: "Límite inválido" }, 400);
  const n = Number(text);
  if (n < 1 || n > MAX_LIMIT) return json({ error: "Límite inválido" }, 400);
  return n;
}

function pathname(req: Request): string {
  const path = new URL(req.url).pathname;
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}
