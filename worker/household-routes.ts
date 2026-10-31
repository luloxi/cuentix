import type { SessionUser } from "./auth";
import type { Env } from "./env";
import { activeHousehold, listHouseholds, listMembers } from "./household";
import { HOUSEHOLD_COOKIE, json, notPorted, serializeCookie } from "./http";

const YEAR = 60 * 60 * 24 * 400;

export async function handleMe(req: Request, env: Env, user: SessionUser): Promise<Response> {
  const { list, active } = await activeHousehold(req, env, user.id);
  const members = active ? await listMembers(env, active.id) : [];
  return json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      image: user.image,
    },
    household: active
      ? { id: active.id, name: active.name, role: active.role }
      : null,
    households: list.map(publicHousehold),
    members,
    flags: {
      isAdmin: user.email.toLowerCase() === "lucianoolivabianco@gmail.com",
      needsOnboarding: active == null,
    },
  });
}

export async function handleHouseholdActive(
  req: Request,
  env: Env,
  user: SessionUser,
): Promise<Response> {
  if (req.method === "GET") {
    const { list, active } = await activeHousehold(req, env, user.id);
    return json({
      households: list.map(publicHousehold),
      activeHouseholdId: active?.id ?? null,
      household: active
        ? { id: active.id, name: active.name, role: active.role }
        : null,
    });
  }
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  const body = (await req.json().catch(() => null)) as {
    householdId?: string;
    action?: string;
  } | null;
  if (body?.action === "delete") return notPorted();
  const householdId = body?.householdId?.trim();
  if (!householdId) return json({ error: "Falta householdId" }, 400);
  const list = await listHouseholds(env, user.id);
  if (!list.some((row) => row.id === householdId)) {
    return json({ error: "No pertenecés a ese hogar" }, 403);
  }
  const cookie = serializeCookie(HOUSEHOLD_COOKIE, householdId, req, YEAR);
  return json(
    {
      ok: true,
      activeHouseholdId: householdId,
      households: list.map(publicHousehold),
    },
    200,
    [cookie],
  );
}

function publicHousehold(row: { id: string; name: string; role: "owner" | "member" }) {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    canDelete: false,
  };
}
