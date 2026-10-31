import type { SessionUser } from "./auth";
import type { Env } from "./env";
import { activeHousehold } from "./household";
import { json, notPorted } from "./http";

export async function handleCategories(req: Request, env: Env, user: SessionUser): Promise<Response> {
  if (req.method !== "GET") return notPorted();
  const { active } = await activeHousehold(req, env, user.id);
  if (!active) return json({ error: "NO_HOUSEHOLD" }, 400);
  const categories = await listVisibleCategories(env, active.id);
  return json({ categories });
}

export async function listVisibleCategories(env: Env, householdId: string) {
  const res = await env.DB.prepare(
    `SELECT c.id, c.slug, c.name, c.kind, c.is_system, c.household_id
     FROM categories c
     WHERE (c.household_id IS NULL OR c.household_id = ?)
       AND NOT EXISTS (
         SELECT 1 FROM household_category_prefs p
         WHERE p.household_id = ? AND p.category_id = c.id AND p.hidden = 1
       )
     ORDER BY c.name`,
  )
    .bind(householdId, householdId)
    .all<{
      id: string;
      slug: string;
      name: string;
      kind: string;
      is_system: number;
      household_id: string | null;
    }>();
  return (res.results ?? []).map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    kind: row.kind,
    isSystem: Boolean(row.is_system),
    householdId: row.household_id,
    hidden: false,
    canDelete: !row.is_system && row.household_id === householdId,
  }));
}
