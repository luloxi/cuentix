/**
 * GET `/api/grupo` — invite code and members of the active household.
 * Read-only. Creating or joining a household stays unported.
 */

import type { SessionUser } from "./auth";
import type { Env } from "./env";
import { activeHousehold } from "./household";
import { json } from "./http";

export async function handleGrupo(
  req: Request,
  env: Env,
  user: SessionUser,
): Promise<Response> {
  if (req.method !== "GET") return json({ error: "Método no permitido" }, 405);
  const { active } = await activeHousehold(req, env, user.id);
  if (!active) return json({ error: "NO_HOUSEHOLD" }, 400);

  const [home, members] = await Promise.all([
    env.DB.prepare(
      `SELECT name AS name, invite_code AS invite_code
       FROM households WHERE id = ?`,
    )
      .bind(active.id)
      .first<{ name: string; invite_code: string }>(),
    env.DB.prepare(
      `SELECT m.user_id AS user_id,
              m.role AS role,
              u.email AS email,
              COALESCE(NULLIF(m.display_name, ''), NULLIF(u.name, ''), NULLIF(u.email, ''), m.user_id) AS name
       FROM household_members m
       LEFT JOIN users u ON u.id = m.user_id
       WHERE m.household_id = ?
       ORDER BY m.joined_at`,
    )
      .bind(active.id)
      .all<{ user_id: string; role: string; email: string | null; name: string }>(),
  ]);

  if (!home) return json({ error: "NO_HOUSEHOLD" }, 400);

  return json({
    householdName: home.name,
    inviteCode: home.invite_code,
    members: (members.results ?? []).map((row) => ({
      userId: row.user_id,
      name: row.name,
      email: row.email,
      role: row.role === "owner" ? "owner" : "member",
    })),
  });
}
