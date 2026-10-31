import type { Env } from "./env";
import {
  buildSvcDeudaAhorroPatrimonio,
  buildSvcResumenMensual,
  buildSvcUltimosMovimientos,
  resolveServiceOwner,
} from "./svc";

/** Codes from the lulox-mcp service-binding contract. */
export type RpcErrorCode = "no_owner" | "invalid" | "not_found" | "not_enabled" | "internal";

export type RpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: RpcErrorCode; message: string } };

const MAX_QUERY = 200;

type ResumenData = Exclude<Awaited<ReturnType<typeof buildSvcResumenMensual>>, Response>;
type DeudaData = Awaited<ReturnType<typeof buildSvcDeudaAhorroPatrimonio>>;
type MovimientosData = Exclude<Awaited<ReturnType<typeof buildSvcUltimosMovimientos>>, Response>;

/**
 * Read-only finance RPC for the lulox-mcp service binding.
 * No bearer token: the binding is the trust boundary.
 * No Workers runtime import, so tests can run under tsx.
 */
export function resumenMensual(env: Env, input: unknown): Promise<RpcResult<ResumenData>> {
  return run(() => resumenMensualInner(env, input));
}

export function deudaAhorroPatrimonio(env: Env, input: unknown): Promise<RpcResult<DeudaData>> {
  return run(() => deudaAhorroPatrimonioInner(env, input));
}

export function ultimosMovimientos(env: Env, input: unknown): Promise<RpcResult<MovimientosData>> {
  return run(() => ultimosMovimientosInner(env, input));
}

async function resumenMensualInner(env: Env, input: unknown): Promise<RpcResult<ResumenData>> {
  const rec = asRecord(input);
  if (!rec) return invalid("invalid input");
  const user = await resolveServiceOwner(env);
  if (!user) return noOwner();
  const built = await buildSvcResumenMensual(env, { from: rec.from, to: rec.to }, user);
  if (built instanceof Response) return fromHttp(built);
  return ok(built);
}

async function deudaAhorroPatrimonioInner(env: Env, input: unknown): Promise<RpcResult<DeudaData>> {
  const rec = asRecord(input);
  if (!rec) return invalid("invalid input");
  const user = await resolveServiceOwner(env);
  if (!user) return noOwner();
  return ok(await buildSvcDeudaAhorroPatrimonio(env, rec, user));
}

async function ultimosMovimientosInner(
  env: Env,
  input: unknown,
): Promise<RpcResult<MovimientosData>> {
  const rec = asRecord(input);
  if (!rec) return invalid("invalid input");
  const query = readQuery(rec);
  if (!query.ok) return query.result;
  const user = await resolveServiceOwner(env);
  if (!user) return noOwner();
  const built = await buildSvcUltimosMovimientos(
    env,
    { limit: rec.limit, period: rec.period, q: query.value },
    user,
  );
  if (built instanceof Response) return fromHttp(built);
  return ok(built);
}

async function run<T>(body: () => Promise<RpcResult<T>>): Promise<RpcResult<T>> {
  try {
    return await body();
  } catch {
    return internal();
  }
}

function asRecord(input: unknown): Record<string, unknown> | null {
  if (input === undefined) return {};
  if (input === null || typeof input !== "object" || Array.isArray(input)) return null;
  return input as Record<string, unknown>;
}

/** `query` maps to the HTTP `q` param. Omitted means no search. */
function readQuery(
  input: Record<string, unknown>,
): { ok: true; value: string | null } | { ok: false; result: RpcResult<never> } {
  if (!Object.hasOwn(input, "query") || input.query === undefined) return { ok: true, value: null };
  const query = input.query;
  if (typeof query !== "string" || query.length < 1 || query.length > MAX_QUERY || query.trim() === "") {
    return { ok: false, result: invalid("invalid query") };
  }
  return { ok: true, value: query };
}

async function fromHttp(res: Response): Promise<RpcResult<never>> {
  let message = "";
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === "string") message = body.error;
  } catch {
    message = "";
  }
  if (res.status === 400 && message === "Período inválido") return invalid("invalid period");
  if (res.status === 400 && message === "Límite inválido") return invalid("invalid limit");
  if (res.status === 400 && message === "NO_HOUSEHOLD") return fail("not_found", "not found");
  return internal();
}

function noOwner(): RpcResult<never> {
  return fail("no_owner", "no owner");
}

function invalid(message: string): RpcResult<never> {
  return fail("invalid", message);
}

function internal(): RpcResult<never> {
  return fail("internal", "internal error");
}

function fail(code: RpcErrorCode, message: string): RpcResult<never> {
  return { ok: false, error: { code, message } };
}

function ok<T>(data: T): RpcResult<T> {
  return { ok: true, data };
}
