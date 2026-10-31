import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/api-auth";
import { getUserHousehold } from "@/lib/household";
import {
  createHouseholdToken,
  getActiveHouseholdToken,
  HouseholdTokenExistsError,
  revokeActiveHouseholdTokens,
  rotateHouseholdToken,
} from "@/lib/agent/household-token";

function metaPayload(
  household: { id: string; name: string },
  meta: {
    prefix: string;
    createdAt: Date;
    lastUsedAt: Date | null;
  } | null,
  token?: string,
) {
  return {
    household: { id: household.id, name: household.name },
    hasToken: Boolean(meta),
    prefix: meta?.prefix ?? null,
    createdAt: meta?.createdAt ?? null,
    lastUsedAt: meta?.lastUsedAt ?? null,
    token: token ?? null,
  };
}

async function sessionHousehold() {
  const authResult = await requireSessionUser();
  if ("error" in authResult) return { error: authResult.error };
  const ctx = await getUserHousehold(authResult.user.id);
  if (!ctx) {
    return {
      error: NextResponse.json(
        {
          error: "Creá o uníte a un hogar primero",
          code: "no_household",
        },
        { status: 400 },
      ),
    };
  }
  return { user: authResult.user, ctx };
}

/** Active token metadata. Never returns the plaintext. Session cookie only. */
export async function GET() {
  const resolved = await sessionHousehold();
  if ("error" in resolved) return resolved.error;
  try {
    const meta = await getActiveHouseholdToken(resolved.ctx.household.id);
    return NextResponse.json(metaPayload(resolved.ctx.household, meta));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}

/**
 * Mint or rotate. Body `{ "action": "create" | "rotate" }`.
 * Plaintext is returned once in `token`.
 */
export async function POST(req: Request) {
  const resolved = await sessionHousehold();
  if ("error" in resolved) return resolved.error;
  const householdId = resolved.ctx.household.id;
  const createdBy = resolved.user.id;

  let action = "create";
  try {
    const body = (await req.json()) as { action?: string };
    if (body.action === "rotate" || body.action === "create") {
      action = body.action;
    }
  } catch {
    // empty body → create
  }

  try {
    const minted =
      action === "rotate"
        ? await rotateHouseholdToken({ householdId, createdBy })
        : await createHouseholdToken({ householdId, createdBy });
    return NextResponse.json(
      {
        ...metaPayload(resolved.ctx.household, minted.meta, minted.token),
        shownOnce: true,
      },
      { status: action === "rotate" ? 200 : 201 },
    );
  } catch (e) {
    if (e instanceof HouseholdTokenExistsError) {
      return NextResponse.json(
        {
          error: e.message,
          code: e.code,
          prefix: e.prefix,
        },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}

/** Revoke the active household token. */
export async function DELETE() {
  const resolved = await sessionHousehold();
  if ("error" in resolved) return resolved.error;
  try {
    const revoked = await revokeActiveHouseholdTokens(
      resolved.ctx.household.id,
    );
    return NextResponse.json({
      ...metaPayload(resolved.ctx.household, null),
      revoked,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}
