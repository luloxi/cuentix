import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api-auth";
import {
  deleteOwnedSoloHousehold,
  getUserHousehold,
  isProtectedHouseholdName,
  listUserHouseholds,
  purgeTestMonkHouseholds,
} from "@/lib/household";
import { writePreferredHouseholdId } from "@/lib/household-cookie";
import { pickActiveHouseholdId } from "@/lib/household-select";

export async function GET() {
  const authResult = await requireApiUser();
  if ("error" in authResult) return authResult.error;
  if (authResult.authKind === "household_token") {
    return NextResponse.json(
      {
        error: "Usá la sesión de la app para listar hogares",
        code: "session_required",
      },
      { status: 403 },
    );
  }
  const { user: sessionUser } = authResult;
  try {
    const purged = await purgeTestMonkHouseholds(sessionUser.id);
    const households = await listUserHouseholds(sessionUser.id);
    const active = await getUserHousehold(sessionUser.id);
    return NextResponse.json({
      households: households.map((h) => ({
        id: h.id,
        name: h.name,
        role: h.role,
        joinedAt: h.joinedAt,
        canDelete:
          h.role === "owner" && !isProtectedHouseholdName(h.name),
      })),
      activeHouseholdId: active?.household.id ?? null,
      household: active,
      purgedTestMonk: purged,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  const authResult = await requireApiUser();
  if ("error" in authResult) return authResult.error;
  if (authResult.authKind === "household_token") {
    return NextResponse.json(
      {
        error: "Usá la sesión de la app para cambiar de hogar",
        code: "session_required",
      },
      { status: 403 },
    );
  }
  const { user: sessionUser } = authResult;
  try {
    const body = (await req.json().catch(() => null)) as {
      householdId?: string;
      action?: string;
    } | null;
    const householdId = body?.householdId?.trim();
    if (!householdId) {
      return NextResponse.json(
        { error: "Falta householdId" },
        { status: 400 },
      );
    }

    if (body?.action === "delete") {
      await deleteOwnedSoloHousehold(sessionUser.id, householdId);
      const households = await listUserHouseholds(sessionUser.id);
      const active = await getUserHousehold(sessionUser.id);
      if (active) await writePreferredHouseholdId(active.household.id);
      return NextResponse.json({
        ok: true,
        deletedHouseholdId: householdId,
        households: households.map((h) => ({
          id: h.id,
          name: h.name,
          role: h.role,
          joinedAt: h.joinedAt,
          canDelete:
            h.role === "owner" && !isProtectedHouseholdName(h.name),
        })),
        activeHouseholdId: active?.household.id ?? null,
      });
    }

    const households = await listUserHouseholds(sessionUser.id);
    const allowed = pickActiveHouseholdId(
      households.map((h) => ({ householdId: h.id, joinedAt: h.joinedAt })),
      householdId,
    );
    if (allowed !== householdId) {
      return NextResponse.json(
        { error: "No pertenecés a ese hogar" },
        { status: 403 },
      );
    }

    await writePreferredHouseholdId(householdId);
    const ctx = await getUserHousehold(sessionUser.id, householdId);
    return NextResponse.json({
      ok: true,
      activeHouseholdId: householdId,
      household: ctx,
      households: households.map((h) => ({
        id: h.id,
        name: h.name,
        role: h.role,
        joinedAt: h.joinedAt,
      })),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 400 },
    );
  }
}
