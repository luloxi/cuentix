/**
 * Reclasificar Fiwind. Reads of the transactions table stay on one household,
 * use tx_household_date_idx, tx_household_desc_idx, or the primary key,
 * and stop at a LIMIT. description_normalized is matched by equality.
 * Similar counts and updates use the list visibility predicate.
 */
import {
  counterpartyKey,
  similarDescriptionVariants,
} from "../src/lib/fiwind-similar";
import type { SessionUser } from "./auth";
import { listVisibleCategories } from "./categories";
import type { Env } from "./env";
import { activeHousehold, forceSharedOnly } from "./household";
import { json, num, periodRange } from "./http";

const SIMILAR_CAP = 500;
const COUNT_PROBE = SIMILAR_CAP + 1;
const MAX_LIMIT = 100;
const MAX_OFFSET = 1000;

type TxVisibility = {
  ownership: string;
  paid_by_user_id: string | null;
};

type MovementRow = TxVisibility & {
  id: string;
  date: string;
  description_normalized: string;
  amount_ars: string | null;
  amount_usd: string | null;
  is_business: number;
  category_id: string | null;
  category_slug: string | null;
  category_name: string | null;
};

type TargetRow = TxVisibility & {
  id: string;
  description_normalized: string;
  is_business: number;
};

const MOVEMENTS_SQL = `SELECT t.id, t.date, t.description_normalized, t.amount_ars, t.amount_usd,
            t.ownership, t.paid_by_user_id, t.is_business, t.category_id,
            c.slug AS category_slug, c.name AS category_name
     FROM transactions t INDEXED BY tx_household_date_idx
     LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.household_id = ?
       AND t.date >= ? AND t.date < ?
       AND t.bank = 'Fiwind'
       AND (t.ownership = 'shared' OR t.paid_by_user_id = ?)
     ORDER BY t.date DESC, t.id DESC
     LIMIT ? OFFSET ?`;

const MOVEMENTS_SHARED_SQL = `SELECT t.id, t.date, t.description_normalized, t.amount_ars, t.amount_usd,
            t.ownership, t.paid_by_user_id, t.is_business, t.category_id,
            c.slug AS category_slug, c.name AS category_name
     FROM transactions t INDEXED BY tx_household_date_idx
     LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.household_id = ?
       AND t.date >= ? AND t.date < ?
       AND t.bank = 'Fiwind'
       AND t.ownership = 'shared'
     ORDER BY t.date DESC, t.id DESC
     LIMIT ? OFFSET ?`;

const TARGET_SQL = `SELECT t.id, t.description_normalized, t.ownership, t.paid_by_user_id, t.is_business
     FROM transactions t
     WHERE t.id = ? AND t.household_id = ? AND t.bank = 'Fiwind'
     LIMIT 1`;

const TARGET_UPDATE_SQL = `UPDATE transactions
     SET category_id = ?, updated_at = ?
     WHERE id = ? AND household_id = ? AND bank = 'Fiwind' AND is_business = 0`;

export async function handleFiwindReclassify(
  req: Request,
  env: Env,
  user: SessionUser,
): Promise<Response> {
  const path = new URL(req.url).pathname.replace(/\/+$/, "") || "/";
  if (path === "/api/fiwind/movements") {
    if (req.method !== "GET") return json({ error: "Método no permitido" }, 405);
    return listMovements(req, env, user);
  }
  if (path === "/api/fiwind/similar") {
    if (req.method !== "GET") return json({ error: "Método no permitido" }, 405);
    return similarOf(req, env, user);
  }
  if (path === "/api/fiwind/reclassify") {
    if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
    return reclassify(req, env, user);
  }
  return json({ error: "No encontrado" }, 404);
}

async function listMovements(req: Request, env: Env, user: SessionUser): Promise<Response> {
  const { active } = await activeHousehold(req, env, user.id);
  if (!active) return json({ error: "NO_HOUSEHOLD" }, 400);
  const url = new URL(req.url);
  const period = (url.searchParams.get("period") ?? "").trim();
  const range = periodRange(period);
  if (!range) return json({ error: "Indicá un mes (YYYY-MM)" }, 400);
  const limit = clampInt(url.searchParams.get("limit"), 50, 1, MAX_LIMIT);
  const offset = readOffset(url.searchParams.get("offset"));
  if (offset === "too-far") {
    const categories = await listVisibleCategories(env, active.id);
    return json({ movements: [], categories, period, limit, offset: MAX_OFFSET + 1 });
  }
  const sharedOnly = forceSharedOnly(active.name);
  const listSql = sharedOnly ? MOVEMENTS_SHARED_SQL : MOVEMENTS_SQL;
  const listBinds = sharedOnly
    ? [active.id, range.start, range.end, limit, offset]
    : [active.id, range.start, range.end, user.id, limit, offset];
  const [page, categories] = await Promise.all([
    env.DB.prepare(listSql).bind(...listBinds).all<MovementRow>(),
    listVisibleCategories(env, active.id),
  ]);
  const movements = (page.results ?? []).map(toMovement);
  return json({ movements, categories, period, limit, offset });
}

async function similarOf(req: Request, env: Env, user: SessionUser): Promise<Response> {
  const { active } = await activeHousehold(req, env, user.id);
  if (!active) return json({ error: "NO_HOUSEHOLD" }, 400);
  const url = new URL(req.url);
  const id = (url.searchParams.get("id") ?? "").trim();
  if (!id) return json({ error: "Falta id" }, 400);
  const loaded = await loadTarget(env, id, active.id);
  if (loaded instanceof Response) return loaded;
  const sharedOnly = forceSharedOnly(active.name);
  if (!canSee(loaded, user.id, sharedOnly)) {
    return json({ error: "Sin permiso" }, 403);
  }
  const categoryId = (url.searchParams.get("categoryId") ?? "").trim() || null;
  return json(await describeSimilar(env, active.id, loaded, user.id, sharedOnly, categoryId));
}

async function reclassify(req: Request, env: Env, user: SessionUser): Promise<Response> {
  const { active } = await activeHousehold(req, env, user.id);
  if (!active) return json({ error: "NO_HOUSEHOLD" }, 400);
  const body = (await req.json().catch(() => null)) as {
    id?: unknown;
    categoryId?: unknown;
    applyToSimilar?: unknown;
    expectedCount?: unknown;
  } | null;
  if (!body || typeof body.id !== "string" || !body.id.trim()) {
    return json({ error: "Falta id" }, 400);
  }
  if (typeof body.categoryId !== "string" || !body.categoryId.trim()) {
    return json({ error: "Elegí una categoría" }, 400);
  }
  const id = body.id.trim();
  const categoryId = body.categoryId.trim();
  const applyToSimilar = body.applyToSimilar === true;
  const expected = readExpectedCount(body.expectedCount);
  if (expected === "bad" || (applyToSimilar && expected == null)) {
    return json({ error: "expectedCount inválido" }, 400);
  }

  const loaded = await loadTarget(env, id, active.id);
  if (loaded instanceof Response) return loaded;
  const sharedOnly = forceSharedOnly(active.name);
  if (!canSee(loaded, user.id, sharedOnly)) {
    return json({ error: "Sin permiso" }, 403);
  }
  if (loaded.is_business === 1) {
    return json(
      {
        error: "Este movimiento es de negocio. Cambialo desde el gasto para avisar a Serpix.",
        code: "business",
      },
      409,
    );
  }
  const visible = await categoryVisible(env, categoryId, active.id);
  if (!visible) return json({ error: "Categoría inválida" }, 400);

  const variants = variantsFor(loaded.description_normalized);
  let similarUpdated = 0;
  if (applyToSimilar) {
    const stats = await describeSimilar(env, active.id, loaded, user.id, sharedOnly, categoryId);
    if (expected !== stats.count) {
      return json(
        {
          error: "La cantidad de similares cambió. Confirmá de nuevo.",
          count: stats.count,
          capped: stats.capped,
          skippedBusiness: stats.skippedBusiness,
        },
        409,
      );
    }
  }

  const now = Date.now();
  const targetStmt = env.DB.prepare(TARGET_UPDATE_SQL).bind(categoryId, now, loaded.id, active.id);
  let updated = 0;
  if (applyToSimilar && variants.length > 0) {
    const slots = variants.map(() => "?").join(", ");
    const similarSql = `UPDATE transactions
       SET category_id = ?, updated_at = ?
       WHERE id IN (
         SELECT id FROM transactions INDEXED BY tx_household_desc_idx
         WHERE household_id = ?
           AND bank = 'Fiwind'
           AND description_normalized IN (${slots})
           AND id != ?
           AND is_business = 0
           AND ${visibilitySql(sharedOnly)}
           AND category_id IS NOT ?
         ORDER BY date DESC, id
         LIMIT ${SIMILAR_CAP}
       )`;
    const similarBinds: unknown[] = [categoryId, now, active.id, ...variants, loaded.id];
    if (!sharedOnly) similarBinds.push(user.id);
    similarBinds.push(categoryId);
    const similarStmt = env.DB.prepare(similarSql).bind(...similarBinds);
    const results = await env.DB.batch([targetStmt, similarStmt]);
    updated = changesOf(results[0]);
    similarUpdated = changesOf(results[1]);
  } else {
    updated = changesOf(await targetStmt.run());
  }
  return json({ ok: true, updated, similarUpdated });
}

async function loadTarget(env: Env, id: string, householdId: string): Promise<TargetRow | Response> {
  const row = await env.DB.prepare(TARGET_SQL).bind(id, householdId).first<TargetRow>();
  if (!row) return json({ error: "No encontrado" }, 404);
  return row;
}

async function describeSimilar(
  env: Env,
  householdId: string,
  row: TargetRow,
  userId: string,
  sharedOnly: boolean,
  categoryId: string | null,
) {
  const variants = variantsFor(row.description_normalized);
  const key = counterpartyKey(row.description_normalized);
  if (variants.length === 0) {
    return { key, variants, count: 0, capped: false, skippedBusiness: 0 };
  }
  const [raw, skippedRaw] = await Promise.all([
    countProbe(env, householdId, variants, row.id, 0, userId, sharedOnly, categoryId),
    countProbe(env, householdId, variants, row.id, 1, userId, sharedOnly, categoryId),
  ]);
  const capped = raw > SIMILAR_CAP;
  return {
    key,
    variants,
    count: capped ? SIMILAR_CAP : raw,
    capped,
    skippedBusiness: skippedRaw,
  };
}

async function countProbe(
  env: Env,
  householdId: string,
  variants: string[],
  excludeId: string,
  business: 0 | 1,
  userId: string,
  sharedOnly: boolean,
  categoryId: string | null,
): Promise<number> {
  const slots = variants.map(() => "?").join(", ");
  const sql = `SELECT COUNT(*) AS n FROM (
       SELECT id FROM transactions INDEXED BY tx_household_desc_idx
       WHERE household_id = ?
         AND bank = 'Fiwind'
         AND description_normalized IN (${slots})
         AND id != ?
         AND is_business = ?
         AND ${visibilitySql(sharedOnly)}
         ${categoryId != null ? "AND category_id IS NOT ?" : ""}
       ORDER BY date DESC, id
       LIMIT ${COUNT_PROBE}
     )`;
  const binds: unknown[] = [householdId, ...variants, excludeId, business];
  if (!sharedOnly) binds.push(userId);
  if (categoryId != null) binds.push(categoryId);
  const row = await env.DB.prepare(sql).bind(...binds).first<{ n: number }>();
  return num(row?.n);
}

function visibilitySql(sharedOnly: boolean): string {
  return sharedOnly ? "ownership = 'shared'" : "(ownership = 'shared' OR paid_by_user_id = ?)";
}

function variantsFor(description: string): string[] {
  return similarDescriptionVariants(description).slice(0, 8);
}

async function categoryVisible(env: Env, categoryId: string, householdId: string): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT c.id
     FROM categories c
     WHERE c.id = ?
       AND (c.household_id IS NULL OR c.household_id = ?)
       AND NOT EXISTS (
         SELECT 1 FROM household_category_prefs p
         WHERE p.household_id = ? AND p.category_id = c.id AND p.hidden = 1
       )
     LIMIT 1`,
  )
    .bind(categoryId, householdId, householdId)
    .first<{ id: string }>();
  return Boolean(row);
}

function canSee(row: TxVisibility, userId: string, sharedOnly: boolean): boolean {
  if (sharedOnly) return row.ownership === "shared";
  return row.ownership === "shared" || row.paid_by_user_id === userId;
}

function toMovement(row: MovementRow) {
  return {
    id: row.id,
    date: row.date,
    description: row.description_normalized,
    amountArs: row.amount_ars != null ? num(row.amount_ars) : null,
    amountUsd: row.amount_usd != null ? num(row.amount_usd) : null,
    isBusiness: row.is_business === 1,
    category: row.category_id
      ? {
          id: row.category_id,
          slug: row.category_slug ?? "uncategorized",
          name: row.category_name ?? "Sin categoría",
        }
      : null,
  };
}

function readExpectedCount(value: unknown): number | null | "bad" {
  if (value == null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return "bad";
  return value;
}

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  if (raw == null || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function readOffset(raw: string | null): number | "too-far" {
  if (raw == null || raw.trim() === "") return 0;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return 0;
  if (n > MAX_OFFSET) return "too-far";
  return n;
}

function changesOf(result: unknown): number {
  const meta = (result as { meta?: { changes?: number } } | null | undefined)?.meta;
  return num(meta?.changes);
}
