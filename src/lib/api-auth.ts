import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { resolveSession, syncUser, type AppUser } from "@/lib/session";
import { parseBearerToken, resolveBearerAuth } from "@/lib/agent/auth";

export type ApiAuthKind = "session" | "household_token" | "global_token";

export type ApiAuthSuccess = {
  user: AppUser;
  householdId?: string;
  authKind: ApiAuthKind;
};

/**
 * Resolve logged-in user for API routes.
 * - PWA: Better Auth cookie session (row in D1 `auth_session`)
 * - Household MCP/agents: Authorization: Bearer <token del hogar>
 * - Admin/dev fallback: Authorization: Bearer AGENT_API_TOKEN
 * Returns { user, householdId?, authKind } or a NextResponse error.
 */
export async function requireApiUser(): Promise<
  ApiAuthSuccess | { error: NextResponse }
> {
  const authorization = (await headers()).get("authorization");
  const bearer = parseBearerToken(authorization);
  if (bearer) {
    const resolved = await resolveBearerAuth(bearer);
    if (!resolved) {
      return {
        error: NextResponse.json(
          { error: "Token inválido", code: "unauthorized" },
          { status: 401 },
        ),
      };
    }
    await syncUser(resolved.user);
    return {
      user: resolved.user,
      householdId: resolved.householdId,
      authKind: resolved.kind,
    };
  }

  return requireSessionUser();
}

/**
 * Cookie session only (PWA). Rejects Bearer — used to mint/rotate/revoke
 * household tokens so a stolen API token cannot mint another.
 */
export async function requireSessionUser(): Promise<
  ApiAuthSuccess | { error: NextResponse }
> {
  const session = await resolveSession();
  if (session.status === "forbidden") {
    return {
      error: NextResponse.json(
        { error: "Email no autorizado", code: "forbidden" },
        { status: 403 },
      ),
    };
  }
  if (session.status !== "ok") {
    return {
      error: NextResponse.json({ error: "No autenticado" }, { status: 401 }),
    };
  }
  await syncUser(session.user);
  return { user: session.user, authKind: "session" };
}
