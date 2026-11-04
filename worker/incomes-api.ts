/**
 * GET/POST/DELETE `/api/incomes`. Period-aware and scoped to the active
 * household. Twin/internal classification matches the dashboard neta.
 */

import {
  isIncomeFrequency,
  isIncomeKind,
  monthlyIncomeEvolution,
  periodIncomeEntries,
  type IncomeFrequency,
  type IncomeKind,
} from "../src/lib/incomes";
import { isNonIncomeTransferLabel } from "../src/lib/bbva/bank-entries";
import type { SessionUser } from "./auth";
import type { Env } from "./env";
import { activeHousehold } from "./household";
import {
  annotateIncomeRows,
  type IncomeContext,
  type IncomeRow,
} from "./income";
import { currentPeriodAr, json, num, periodRange } from "./http";
import { loadExcludedMovementIds } from "./transfer-class";

type DbIncome = {
  id: string;
  household_id: string;
  date: string;
  label: string;
  kind: string | null;
  frequency: string | null;
  amount_ars: string | null;
  amount_usd: string | null;
  created_at: number | null;
};

export async function handleIncomes(
  req: Request,
  env: Env,
  user: SessionUser,
): Promise<Response> {
  if (req.method === "GET") return listIncomes(req, env, user);
  if (req.method === "POST") return createIncome(req, env, user);
  if (req.method === "DELETE") return deleteIncome(req, env, user);
  return json({ error: "Método no permitido" }, 405);
}

async function listIncomes(req: Request, env: Env, user: SessionUser): Promise<Response> {
  const { active } = await activeHousehold(req, env, user.id);
  if (!active) return json({ error: "NO_HOUSEHOLD" }, 400);

  const url = new URL(req.url);
  const rawPeriod = url.searchParams.get("period") || currentPeriodAr();
  if (!periodRange(rawPeriod)) return json({ error: "Período inválido" }, 400);
  const period = rawPeriod;

  const [rows, movements] = await Promise.all([
    incomeRows(env, user.id, active.id),
    loadExcludedMovementIds(env.DB, user.id, env.OWN_ACCOUNT_IDS),
  ]);
  const ctx: IncomeContext = {
    ownIds: movements.ownIds,
    userHouseholdIds: movements.userHouseholdIds,
    outgoing: movements.incomeOutgoing,
  };
  const annotated = annotateIncomeRows(rows, ctx);
  const visible = annotated.filter((row) => !row.internal);
  const serialized = visible.map(serialize);
  const forEntries = visible.map((row) => ({
    id: row.id ?? "",
    date: row.date,
    label: row.label,
    kind: row.kind,
    frequency: row.frequency,
    amountArs: row.amount_ars,
    amountUsd: row.amount_usd,
  }));
  const periodEntries = periodIncomeEntries(forEntries, period);
  const monthlyEvolution = monthlyIncomeEvolution(forEntries, { months: 12 });
  const filtered = serialized.filter((row) => {
    if (row.kind === "recurring") return true;
    return row.date.startsWith(period);
  });

  return json({
    period,
    incomes: url.searchParams.has("period") ? filtered : serialized,
    periodEntries,
    monthlyEvolution,
  });
}

async function createIncome(req: Request, env: Env, user: SessionUser): Promise<Response> {
  const { active } = await activeHousehold(req, env, user.id);
  if (!active) return json({ error: "NO_HOUSEHOLD" }, 400);

  const body = (await req.json().catch(() => null)) as {
    date?: string;
    label?: string;
    amountArs?: number | null;
    amountUsd?: number | null;
    kind?: string;
    frequency?: string | null;
  } | null;
  if (!body) return json({ error: "JSON inválido" }, 400);

  const date = (body.date || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return json({ error: "Fecha inválida (YYYY-MM-DD)" }, 400);
  }
  const label = (body.label || "").trim();
  if (!label) return json({ error: "Falta la descripción" }, 400);
  if (isNonIncomeTransferLabel(label)) {
    return json(
      {
        error:
          "Eso es Transferencia interna (self/FX/DEBIN), no un ingreso. Marcá Transferencia interna en Consumos.",
      },
      400,
    );
  }

  const kind: IncomeKind = isIncomeKind(body.kind) ? body.kind : "variable";
  let frequency: IncomeFrequency | null = null;
  if (kind === "recurring") {
    if (!isIncomeFrequency(body.frequency)) {
      return json(
        { error: "Elegí la frecuencia: mensual, quincenal o semanal" },
        400,
      );
    }
    frequency = body.frequency;
  }

  const amountArs = moneyOrNull(body.amountArs);
  const amountUsd = moneyOrNull(body.amountUsd);
  if ((amountArs == null || amountArs === 0) && (amountUsd == null || amountUsd === 0)) {
    return json({ error: "Poné un monto en pesos y/o dólares" }, 400);
  }

  const id = crypto.randomUUID();
  const now = Date.now();
  const row = await env.DB.prepare(
    `INSERT INTO incomes (
       id, user_id, household_id, kind, frequency, date, label,
       amount_ars, amount_usd, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING id, household_id, date, label, kind, frequency, amount_ars, amount_usd, created_at`,
  )
    .bind(
      id,
      user.id,
      active.id,
      kind,
      frequency,
      date,
      label,
      amountArs != null ? String(amountArs) : null,
      amountUsd != null ? String(amountUsd) : null,
      now,
      now,
    )
    .first<DbIncome>();

  const created: DbIncome = row ?? {
    id,
    household_id: active.id,
    date,
    label,
    kind,
    frequency,
    amount_ars: amountArs != null ? String(amountArs) : null,
    amount_usd: amountUsd != null ? String(amountUsd) : null,
    created_at: now,
  };
  return json({ income: serialize(created) });
}

async function deleteIncome(req: Request, env: Env, user: SessionUser): Promise<Response> {
  const { active } = await activeHousehold(req, env, user.id);
  if (!active) return json({ error: "NO_HOUSEHOLD" }, 400);
  const id = new URL(req.url).searchParams.get("id")?.trim();
  if (!id) return json({ error: "Falta id" }, 400);

  await env.DB.prepare(
    "DELETE FROM incomes WHERE id = ? AND user_id = ? AND household_id = ?",
  )
    .bind(id, user.id, active.id)
    .run();
  return json({ ok: true });
}

export async function incomeRows(
  env: Env,
  userId: string,
  householdId: string,
): Promise<IncomeRow[]> {
  const res = await env.DB.prepare(
    `SELECT id, household_id, date, label, kind, frequency, amount_ars, amount_usd, created_at
     FROM incomes WHERE user_id = ? AND household_id = ? ORDER BY date DESC LIMIT 400`,
  )
    .bind(userId, householdId)
    .all<DbIncome>();
  return res.results ?? [];
}

function serialize(row: IncomeRow & { created_at?: number | null }) {
  const kind: IncomeKind = row.kind === "recurring" ? "recurring" : "variable";
  const frequency =
    kind === "recurring" && isIncomeFrequency(row.frequency) ? row.frequency : null;
  return {
    id: row.id,
    kind,
    frequency,
    date: row.date,
    label: row.label,
    amountArs: row.amount_ars == null || row.amount_ars === "" ? null : num(row.amount_ars),
    amountUsd: row.amount_usd == null || row.amount_usd === "" ? null : num(row.amount_usd),
    createdAt:
      row.created_at != null && Number.isFinite(Number(row.created_at))
        ? new Date(Number(row.created_at)).toISOString()
        : null,
  };
}

function moneyOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}
