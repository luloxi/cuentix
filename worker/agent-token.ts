/**
 * GET `/api/household/agent-token` — whether this household has an MCP token.
 * Returns the prefix and dates only. The hash and the plaintext stay in D1.
 * Mint, rotate and revoke stay unported.
 */

import type { SessionUser } from "./auth";
import type { Env } from "./env";
import { activeHousehold } from "./household";
import { json } from "./http";

export async function handleAgentToken(
  req: Request,
  env: Env,
  user: SessionUser,
): Promise<Response> {
  if (req.method !== "GET") return json({ error: "Método no permitido" }, 405);
  const { active } = await activeHousehold(req, env, user.id);
  if (!active) {
    return json({
      household: null,
      hasToken: false,
      prefix: null,
      createdAt: null,
      lastUsedAt: null,
      token: null,
    });
  }

  const row = await env.DB.prepare(
    `SELECT token_prefix AS token_prefix,
            created_at AS created_at,
            last_used_at AS last_used_at
     FROM household_api_tokens
     WHERE household_id = ? AND revoked_at IS NULL
     ORDER BY created_at DESC
     LIMIT 1`,
  )
    .bind(active.id)
    .first<{
      token_prefix: string;
      created_at: number | string | null;
      last_used_at: number | string | null;
    }>();

  return json({
    household: { id: active.id, name: active.name },
    hasToken: Boolean(row?.token_prefix),
    prefix: row?.token_prefix ?? null,
    createdAt: isoFromMs(row?.created_at),
    lastUsedAt: isoFromMs(row?.last_used_at),
    token: null,
  });
}

function isoFromMs(value: unknown): string | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n).toISOString();
}
