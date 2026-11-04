/**
 * GET `/api/admin/allowed-emails` — who may sign in.
 * Read-only. Adding or removing an address stays unported.
 */

import { ADMIN_EMAIL, type SessionUser } from "./auth";
import type { Env } from "./env";
import { json } from "./http";

type EmailRow = {
  email: string;
  createdAt: string | null;
  source: "admin" | "db" | "env";
};

export async function handleAllowedEmails(
  req: Request,
  env: Env,
  user: SessionUser,
): Promise<Response> {
  if (req.method !== "GET") return json({ error: "Método no permitido" }, 405);
  if (user.email.trim().toLowerCase() !== ADMIN_EMAIL) {
    return json({ error: "Solo admin" }, 403);
  }

  const stored = await env.DB.prepare(
    `SELECT email AS email, created_at AS created_at
     FROM allowed_emails
     ORDER BY email`,
  ).all<{ email: string; created_at: number | string | null }>();

  const emails: EmailRow[] = [{ email: ADMIN_EMAIL, createdAt: null, source: "admin" }];
  const seen = new Set<string>([ADMIN_EMAIL]);

  for (const row of stored.results ?? []) {
    const email = row.email.trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    emails.push({ email, createdAt: isoFromMs(row.created_at), source: "db" });
  }

  for (const email of envEmails(env.ALLOWED_EMAILS)) {
    if (seen.has(email)) continue;
    seen.add(email);
    emails.push({ email, createdAt: null, source: "env" });
  }

  return json({ emails });
}

function envEmails(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.includes("@"));
}

function isoFromMs(value: unknown): string | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n).toISOString();
}
