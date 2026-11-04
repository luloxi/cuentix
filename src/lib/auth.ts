export const SESSION_COOKIE = "cuentix_session";
/** 30 days, in seconds. */
export const SESSION_MAX_AGE_SEC = 30 * 24 * 60 * 60;

/** Length-independent byte compare. Empty strings are equal to each other. */
export function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  const length = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let i = 0; i < length; i++) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}

function bytesToBase64Url(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let binary = "";
  for (let i = 0; i < view.length; i++) {
    binary += String.fromCharCode(view[i]!);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function hmacSha256(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return bytesToBase64Url(signature);
}

/** Cookie value: `<exp>.<base64url HMAC-SHA256(secret, exp)>`. */
export async function signSession(secret: string, exp: number): Promise<string> {
  if (!secret) throw new Error("missing session secret");
  if (!Number.isInteger(exp) || exp <= 0) throw new Error("bad exp");
  const signature = await hmacSha256(secret, String(exp));
  return `${exp}.${signature}`;
}

export async function verifySession(secret: string, token: string, nowSec: number): Promise<boolean> {
  if (!secret || !token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const expText = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!/^\d+$/.test(expText) || !signature) return false;
  const exp = Number(expText);
  if (!Number.isFinite(exp) || exp <= nowSec) return false;
  if (exp > nowSec + SESSION_MAX_AGE_SEC + 60) return false;
  const expected = await hmacSha256(secret, expText);
  return timingSafeEqual(signature, expected);
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE_SEC}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    if (key === name) return part.slice(index + 1).trim();
  }
  return null;
}
