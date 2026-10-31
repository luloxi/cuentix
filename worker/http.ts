const COOKIE = "cuentix_session";
export const OAUTH_COOKIE = "cuentix_oauth";
export const HOUSEHOLD_COOKIE = "lc_household";

export function json(data: unknown, status = 200, cookies?: string[]): Response {
  const headers = new Headers();
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  for (const cookie of cookies ?? []) headers.append("set-cookie", cookie);
  return new Response(JSON.stringify(data), { status, headers });
}

export function redirect(location: string, cookies?: string[]): Response {
  const headers = new Headers();
  headers.set("location", location);
  headers.set("cache-control", "no-store");
  for (const cookie of cookies ?? []) headers.append("set-cookie", cookie);
  return new Response(null, { status: 302, headers });
}

export function notPorted(): Response {
  return json(
    { error: "Disponible pronto", code: "not_ported" },
    501,
  );
}

export function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.get("cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq);
    if (key !== name) continue;
    try {
      return decodeURIComponent(trimmed.slice(eq + 1));
    } catch {
      return trimmed.slice(eq + 1);
    }
  }
  return null;
}

export function requestIsSecure(req: Request): boolean {
  if (new URL(req.url).protocol === "https:") return true;
  return req.headers.get("x-forwarded-proto") === "https";
}

export function sessionCookie(token: string, req: Request, maxAge = 60 * 60 * 24 * 30): string {
  return serializeCookie(COOKIE, token, req, maxAge);
}

export function clearSessionCookie(req: Request): string {
  return serializeCookie(COOKIE, "", req, 0);
}

export function readSessionCookie(req: Request): string | null {
  return readCookie(req, COOKIE);
}

export function serializeCookie(
  name: string,
  value: string,
  req: Request,
  maxAge: number,
): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (requestIsSecure(req)) parts.push("Secure");
  return parts.join("; ");
}

export async function sha256Hex(value: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  const bytes = new Uint8Array(buf);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}

export function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return base64url(buf);
}

export function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function num(value: unknown): number {
  if (value == null || value === "") return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function periodRange(period: string): { start: string; end: string } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return {
    start: `${m[1]}-${m[2]}-01`,
    end: `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`,
  };
}

export function shiftPeriod(period: string, delta: number): string {
  const [year, month] = period.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Current YYYY-MM in Argentina. */
export function currentPeriodAr(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  if (year && month) return `${year}-${month}`;
  return shiftPeriod(
    `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`,
    0,
  );
}
