import { createHmac, timingSafeEqual } from "crypto";

export const PRO_PLAN = {
  name: "Pro",
  amountArs: 9990,
  interval: "mes",
} as const;

export function polarServer(): "sandbox" | "production" {
  return process.env.POLAR_SERVER === "production" ? "production" : "sandbox";
}

export function polarApiBase(): string {
  return polarServer() === "production"
    ? "https://api.polar.sh/v1"
    : "https://sandbox-api.polar.sh/v1";
}

export function isPolarCheckoutConfigured(): boolean {
  return Boolean(
    process.env.POLAR_ACCESS_TOKEN?.trim() &&
      process.env.POLAR_PRODUCT_ID?.trim(),
  );
}

export function polarWebhookSecret(): string | null {
  const secret = process.env.POLAR_WEBHOOK_SECRET?.trim();
  return secret || null;
}

export function polarAccessToken(): string | null {
  const token = process.env.POLAR_ACCESS_TOKEN?.trim();
  return token || null;
}

export function polarProductId(): string | null {
  const id = process.env.POLAR_PRODUCT_ID?.trim();
  return id || null;
}

/** Public origin for Polar success/return URLs. */
export function appUrlFromRequest(req: Request): string {
  const env = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  if (env) return env;
  const host =
    req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  if (host) {
    const proto = req.headers.get("x-forwarded-proto") ?? "https";
    return `${proto}://${host}`;
  }
  return "http://localhost:3000";
}

export function clientIp(req: Request): string | undefined {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return (
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-real-ip") ??
    undefined
  );
}

export async function polarFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const token = polarAccessToken();
  if (!token) {
    throw new Error("Falta POLAR_ACCESS_TOKEN");
  }
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(`${polarApiBase()}${path}`, { ...init, headers });
}

export type PolarCheckout = { id: string; url: string | null };

export async function createPolarCheckout(body: Record<string, unknown>) {
  const res = await polarFetch("/checkouts/", {
    method: "POST",
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as PolarCheckout & {
    detail?: string;
    error?: string;
  };
  if (!res.ok) {
    const msg =
      (typeof data.detail === "string" && data.detail) ||
      (typeof data.error === "string" && data.error) ||
      `Polar checkout ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

/** Standard Webhooks (whsec_...) used by Polar. */
export function verifyPolarWebhook(
  body: string,
  headers: Headers,
  secret: string,
): unknown {
  const msgId = headers.get("webhook-id");
  const timestamp = headers.get("webhook-timestamp");
  const signatureHeader = headers.get("webhook-signature");
  if (!msgId || !timestamp || !signatureHeader) {
    throw new Error("Faltan headers de webhook");
  }
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 60 * 5) {
    throw new Error("Timestamp de webhook inválido");
  }

  let key = secret;
  if (secret.startsWith("whsec_")) {
    key = secret.slice("whsec_".length);
  }
  const secretBytes = Buffer.from(key, "base64");
  const toSign = `${msgId}.${timestamp}.${body}`;
  const expected = createHmac("sha256", secretBytes).update(toSign).digest("base64");

  const parts = signatureHeader.split(" ").flatMap((p) => p.split(","));
  const versions = parts
    .map((p) => p.trim())
    .filter((p) => p.startsWith("v1,"))
    .map((p) => p.slice(3));
  // Also accept "v1,<sig>" space-separated Standard Webhooks format: "v1,sig1 v1,sig2"
  const sigs = signatureHeader
    .split(" ")
    .map((chunk) => {
      const [ver, sig] = chunk.split(",", 2);
      return ver === "v1" ? sig : null;
    })
    .filter((s): s is string => Boolean(s));

  const candidates = sigs.length ? sigs : versions;
  const ok = candidates.some((sig) => {
    try {
      const a = Buffer.from(sig);
      const b = Buffer.from(expected);
      return a.length === b.length && timingSafeEqual(a, b);
    } catch {
      return false;
    }
  });
  if (!ok) {
    throw new Error("Firma inválida");
  }
  return JSON.parse(body) as unknown;
}
