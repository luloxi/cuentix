import { expenseAmountText, parseExpenseAmount } from "../src/lib/manual-expense";
import {
  TRUSTED_DEBT_MONTHS,
  assetsEquivalent,
  historyNote,
  historyStartsAt,
  netWorthArs,
  readDebt,
  type PatrimonioPoint,
} from "../src/lib/patrimonio";
import type { SessionUser } from "./auth";
import type { Env } from "./env";
import { loadFx } from "./fx";
import { activeHousehold } from "./household";
import { json, num, todayAr } from "./http";

const EVM = /^0x[a-fA-F0-9]{40}$/;

type SavingsRow = {
  id: string;
  kind: "bank" | "evm" | "cardano";
  label: string;
  address: string | null;
  amount_ars: string | null;
  amount_usd: string | null;
  last_balance_usd: string | null;
  last_synced_at: number | null;
};

type DebtRow = {
  force_settled: number | null;
  saldo_deuda_ars: string | null;
  saldo_deuda_usd: string | null;
  card_last4: string | null;
  rate_pct: string | null;
  min_payment_ars: string | null;
  due_day: number | null;
  notes: string | null;
  cleared_at: number | null;
  updated_at: number | null;
};

export async function handleAhorros(req: Request, env: Env, user: SessionUser): Promise<Response> {
  if (req.method === "GET") return listAhorros(req, env, user);
  if (req.method === "POST") return createAhorro(req, env, user);
  if (req.method === "PATCH") return patchAhorro(req, env, user);
  if (req.method === "DELETE") {
    return json(
      { error: "No se borran ahorros desde acá. El historial se conserva." },
      405,
    );
  }
  return json({ error: "Método no permitido" }, 405);
}

export async function handleDebtSettings(req: Request, env: Env, user: SessionUser): Promise<Response> {
  if (req.method === "GET") {
    const row = await debtRow(env, user.id);
    return json({ settings: serializeSettings(row) });
  }
  if (req.method === "POST" || req.method === "PATCH") return saveDebtSettings(req, env, user);
  return json({ error: "Método no permitido" }, 405);
}

export async function handleDebtStats(req: Request, env: Env, user: SessionUser): Promise<Response> {
  if (req.method !== "GET") return json({ error: "Método no permitido" }, 405);
  const row = await debtRow(env, user.id);
  const reading = readDebt({
    forceSettled: Boolean(row?.force_settled),
    saldoArs: row?.saldo_deuda_ars == null ? null : num(row.saldo_deuda_ars),
    saldoUsd: row?.saldo_deuda_usd == null ? null : num(row.saldo_deuda_usd),
    cardLast4: row?.card_last4 ?? null,
  });
  const [statements, pastInstallments] = await Promise.all([
    closedStatements(env, user.id),
    pastCuotas(env, user.id),
  ]);
  return json({
    cardStatus: reading.cardStatus,
    payments: [],
    openInstallments: [],
    openCharges: [],
    summary: {
      currentBalanceArs: reading.balanceArs,
      currentBalanceUsd: reading.balanceUsd,
      settled: reading.settled,
      forceSettled: reading.forceSettled,
      mode: reading.forceSettled ? "forced" : reading.cardStatus === "sin_snapshot" ? "empty" : "manual",
      primaryCardLast4: reading.activeCard ? row?.card_last4 ?? null : null,
      peakBalanceArs: 0,
      totalPaidArs: 0,
      totalPaidUsd: 0,
      totalChargesArs: 0,
      totalChargesUsd: 0,
      saldoSnapshotArs: reading.balanceArs,
      netDebtArs: reading.balanceArs,
    },
    statements,
    pastInstallments,
    trustedMonths: TRUSTED_DEBT_MONTHS,
  });
}

export async function handlePatrimonio(req: Request, env: Env, user: SessionUser): Promise<Response> {
  if (req.method !== "GET") return json({ error: "Método no permitido" }, 405);
  return json(await patrimonioPayload(env, user.id, true));
}

export async function handlePatrimonioSnapshot(req: Request, env: Env, user: SessionUser): Promise<Response> {
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  return json(await patrimonioPayload(env, user.id, true));
}

async function listAhorros(req: Request, env: Env, user: SessionUser): Promise<Response> {
  const url = new URL(req.url);
  const rows = await savingsRows(env, user.id);
  const fx = await loadFx();
  const summary = summarize(rows, fx.blue);
  return json({
    assets: rows.map(publicAsset),
    summary: {
      ...summary,
      balanceNote: url.searchParams.get("refresh") === "1"
        ? "Saldos guardados, sin sync en vivo."
        : "Saldos guardados, sin sync en vivo.",
    },
  });
}

async function createAhorro(req: Request, env: Env, user: SessionUser): Promise<Response> {
  const { active } = await activeHousehold(req, env, user.id);
  if (!active) return json({ error: "Sin espacio" }, 400);
  const body = (await req.json().catch(() => null)) as {
    kind?: string;
    label?: string;
    address?: string;
    amountArs?: unknown;
    amountUsd?: unknown;
  } | null;
  if (!body) return json({ error: "JSON inválido" }, 400);
  const kind = body.kind;
  if (kind !== "bank" && kind !== "evm" && kind !== "cardano") {
    return json({ error: "Tipo inválido" }, 400);
  }
  const label = (body.label ?? "").trim().slice(0, 80) || defaultLabel(kind);
  const ars = parseExpenseAmount(body.amountArs);
  const usd = parseExpenseAmount(body.amountUsd);
  if (!ars.ok || !usd.ok) return json({ error: "Monto inválido" }, 400);

  let address: string | null = null;
  let amountArs: string | null = null;
  let amountUsd: string | null = null;
  let lastBalance: string | null = null;
  if (kind === "bank") {
    amountArs = expenseAmountText(ars.amount ?? 0);
    amountUsd = expenseAmountText(usd.amount ?? 0);
  } else {
    const raw = (body.address ?? "").trim();
    if (kind === "evm") {
      if (!EVM.test(raw)) {
        return json({ error: "Pegá la address 0x. El nombre ENS no se resuelve acá." }, 400);
      }
      address = raw.toLowerCase();
    } else {
      if (raw.length < 5 || raw.length > 120) {
        return json({ error: "Dirección de Cardano inválida" }, 400);
      }
      address = raw;
    }
    lastBalance = expenseAmountText(usd.amount);
  }

  const id = crypto.randomUUID();
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO savings_assets (
       id, user_id, household_id, kind, label, address,
       amount_ars, amount_usd, last_balance_usd, last_synced_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      user.id,
      active.id,
      kind,
      label,
      address,
      amountArs,
      amountUsd,
      lastBalance,
      lastBalance != null ? now : null,
      now,
      now,
    )
    .run();
  return json({ id }, 201);
}

async function patchAhorro(req: Request, env: Env, user: SessionUser): Promise<Response> {
  const body = (await req.json().catch(() => null)) as {
    id?: string;
    label?: string;
    amountArs?: unknown;
    amountUsd?: unknown;
    address?: string;
  } | null;
  if (!body?.id) return json({ error: "Falta id" }, 400);
  const existing = await env.DB.prepare(
    `SELECT id, kind, label, address FROM savings_assets WHERE id = ? AND user_id = ?`,
  )
    .bind(body.id, user.id)
    .first<{ id: string; kind: string; label: string; address: string | null }>();
  if (!existing) return json({ error: "No encontrado" }, 404);

  const sets: string[] = ["updated_at = ?"];
  const binds: unknown[] = [Date.now()];
  if (body.label != null) {
    const label = body.label.trim().slice(0, 80);
    if (label) {
      sets.push("label = ?");
      binds.push(label);
    }
  }
  if (existing.kind === "bank") {
    if (body.amountArs !== undefined) {
      const parsed = parseExpenseAmount(body.amountArs);
      if (!parsed.ok) return json({ error: "Monto inválido" }, 400);
      sets.push("amount_ars = ?");
      binds.push(expenseAmountText(parsed.amount ?? 0));
    }
    if (body.amountUsd !== undefined) {
      const parsed = parseExpenseAmount(body.amountUsd);
      if (!parsed.ok) return json({ error: "Monto inválido" }, 400);
      sets.push("amount_usd = ?");
      binds.push(expenseAmountText(parsed.amount ?? 0));
    }
  } else if (body.amountUsd !== undefined) {
    const parsed = parseExpenseAmount(body.amountUsd);
    if (!parsed.ok) return json({ error: "Monto inválido" }, 400);
    sets.push("last_balance_usd = ?");
    binds.push(expenseAmountText(parsed.amount));
    sets.push("last_synced_at = ?");
    binds.push(Date.now());
    sets.push("sync_error = NULL");
  }
  if (existing.kind !== "bank" && body.address) {
    const raw = body.address.trim();
    if (existing.kind === "evm") {
      if (!EVM.test(raw)) {
        return json({ error: "Pegá la address 0x. El nombre ENS no se resuelve acá." }, 400);
      }
      sets.push("address = ?");
      binds.push(raw.toLowerCase());
    } else if (raw.length >= 5 && raw.length <= 120) {
      sets.push("address = ?");
      binds.push(raw);
    }
  }
  binds.push(existing.id, user.id);
  await env.DB.prepare(
    `UPDATE savings_assets SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`,
  )
    .bind(...binds)
    .run();
  return json({ ok: true });
}

async function patrimonioPayload(env: Env, userId: string, writeToday: boolean) {
  const position = await livePosition(env, userId);
  const date = todayAr();
  if (writeToday) await insertSnapshot(env, userId, date, position);
  const stored = await env.DB.prepare(
    `SELECT date, assets_ars, assets_usd, debt_ars, debt_usd, net_worth_ars, fx_rate, source
     FROM patrimonio_snapshots
     WHERE user_id = ?
     ORDER BY date DESC
     LIMIT 400`,
  )
    .bind(userId)
    .all<{
      date: string;
      assets_ars: string;
      assets_usd: string;
      debt_ars: string;
      debt_usd: string;
      net_worth_ars: string;
      fx_rate: string | null;
      source: string;
    }>();
  const series: PatrimonioPoint[] = (stored.results ?? []).map((row) => ({
    date: row.date,
    assetsArs: num(row.assets_ars),
    assetsUsd: num(row.assets_usd),
    debtArs: num(row.debt_ars),
    debtUsd: num(row.debt_usd),
    netWorthArs: num(row.net_worth_ars),
    fxRate: row.fx_rate != null ? num(row.fx_rate) : null,
    source: snapshotSource(row.source),
  })).reverse();
  const starts = historyStartsAt(series);
  return {
    current: {
      date,
      assetsArs: position.assetsArs,
      assetsUsd: position.assetsUsd,
      debtArs: position.debtArs,
      debtUsd: position.debtUsd,
      netWorthArs: position.netWorthArs,
      fxRate: position.fxRate,
      source: "snapshot" as const,
      cardStatus: position.cardStatus,
    },
    series,
    historyStartsAt: starts,
    note: historyNote(starts),
    trustedMonths: TRUSTED_DEBT_MONTHS,
    derived: false,
  };
}

async function livePosition(env: Env, userId: string) {
  const [sums, debt, fx] = await Promise.all([
    env.DB.prepare(
      `SELECT
         SUM(CASE WHEN kind = 'bank' THEN CAST(IFNULL(amount_ars, '0') AS REAL) ELSE 0 END) AS ars,
         SUM(CASE WHEN kind = 'bank' THEN CAST(IFNULL(amount_usd, '0') AS REAL) ELSE 0 END) AS usd,
         SUM(CASE WHEN kind != 'bank' THEN CAST(IFNULL(last_balance_usd, '0') AS REAL) ELSE 0 END) AS usdc
       FROM savings_assets WHERE user_id = ?`,
    )
      .bind(userId)
      .first<{ ars: number | null; usd: number | null; usdc: number | null }>(),
    debtRow(env, userId),
    loadFx(),
  ]);
  const reading = readDebt({
    forceSettled: Boolean(debt?.force_settled),
    saldoArs: debt?.saldo_deuda_ars == null ? null : num(debt.saldo_deuda_ars),
    saldoUsd: debt?.saldo_deuda_usd == null ? null : num(debt.saldo_deuda_usd),
    cardLast4: debt?.card_last4 ?? null,
  });
  const assets = assetsEquivalent({
    bankArs: num(sums?.ars),
    bankUsd: num(sums?.usd),
    walletUsd: num(sums?.usdc),
    fxRate: fx.blue,
  });
  return {
    assetsArs: assets.assetsArs,
    assetsUsd: assets.assetsUsd,
    debtArs: reading.balanceArs,
    debtUsd: reading.balanceUsd,
    netWorthArs: netWorthArs(assets.assetsArs, reading.balanceArs),
    fxRate: fx.blue,
    cardStatus: reading.cardStatus,
  };
}

async function insertSnapshot(
  env: Env,
  userId: string,
  date: string,
  position: {
    assetsArs: number;
    assetsUsd: number;
    debtArs: number;
    debtUsd: number;
    netWorthArs: number;
    fxRate: number | null;
  },
) {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO patrimonio_snapshots (
       id, user_id, date, assets_ars, assets_usd, debt_ars, debt_usd, net_worth_ars, fx_rate, source, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'snapshot', ?)`,
  )
    .bind(
      crypto.randomUUID(),
      userId,
      date,
      expenseAmountText(position.assetsArs) ?? "0.00",
      expenseAmountText(position.assetsUsd) ?? "0.00",
      expenseAmountText(position.debtArs) ?? "0.00",
      expenseAmountText(position.debtUsd) ?? "0.00",
      expenseAmountText(position.netWorthArs) ?? "0.00",
      position.fxRate != null && position.fxRate > 0 ? expenseAmountText(position.fxRate) : null,
      Date.now(),
    )
    .run();
}

async function savingsRows(env: Env, userId: string): Promise<SavingsRow[]> {
  const res = await env.DB.prepare(
    `SELECT id, kind, label, address, amount_ars, amount_usd, last_balance_usd, last_synced_at
     FROM savings_assets WHERE user_id = ? ORDER BY kind, label`,
  )
    .bind(userId)
    .all<SavingsRow>();
  return res.results ?? [];
}

function publicAsset(row: SavingsRow) {
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    address: row.address,
    amountArs: row.amount_ars != null ? num(row.amount_ars) : null,
    amountUsd: row.amount_usd != null ? num(row.amount_usd) : null,
    lastBalanceUsd: row.last_balance_usd != null ? num(row.last_balance_usd) : null,
    lastSyncedAt: row.last_synced_at != null ? new Date(row.last_synced_at).toISOString() : null,
    syncError: null,
  };
}

function summarize(rows: SavingsRow[], blue: number | null) {
  let totalArs = 0;
  let totalUsdBanks = 0;
  let totalUsdc = 0;
  for (const row of rows) {
    if (row.kind === "bank") {
      totalArs += num(row.amount_ars);
      totalUsdBanks += num(row.amount_usd);
    } else {
      totalUsdc += num(row.last_balance_usd);
    }
  }
  const totalUsd = totalUsdBanks + totalUsdc;
  const rate = blue != null && blue > 0 ? blue : 0;
  return {
    totalArs,
    totalUsd,
    totalUsdBanks,
    totalUsdc,
    netArs: totalArs + totalUsd * rate,
    blueRate: rate || null,
  };
}

async function debtRow(env: Env, userId: string): Promise<DebtRow | null> {
  return env.DB.prepare(
    `SELECT force_settled, saldo_deuda_ars, saldo_deuda_usd, card_last4,
            rate_pct, min_payment_ars, due_day, notes, cleared_at, updated_at
     FROM debt_settings WHERE user_id = ?`,
  )
    .bind(userId)
    .first<DebtRow>();
}

function serializeSettings(row: DebtRow | null) {
  if (!row) {
    return {
      ratePct: null,
      minPaymentArs: null,
      dueDay: null,
      notes: null,
      forceSettled: false,
      clearedAt: null,
      cardLast4: null,
      saldoDeudaArs: null,
      saldoDeudaUsd: null,
      updatedAt: null,
    };
  }
  return {
    ratePct: row.rate_pct != null ? num(row.rate_pct) : null,
    minPaymentArs: row.min_payment_ars != null ? num(row.min_payment_ars) : null,
    dueDay: row.due_day,
    notes: row.notes,
    forceSettled: Boolean(row.force_settled),
    clearedAt: row.cleared_at != null ? new Date(row.cleared_at).toISOString() : null,
    cardLast4: row.card_last4,
    saldoDeudaArs: row.saldo_deuda_ars != null ? num(row.saldo_deuda_ars) : null,
    saldoDeudaUsd: row.saldo_deuda_usd != null ? num(row.saldo_deuda_usd) : null,
    updatedAt: row.updated_at != null ? new Date(row.updated_at).toISOString() : null,
  };
}

async function saveDebtSettings(req: Request, env: Env, user: SessionUser): Promise<Response> {
  const body = (await req.json().catch(() => null)) as {
    ratePct?: number | null;
    minPaymentArs?: number | null;
    dueDay?: number | null;
    notes?: string | null;
    forceSettled?: boolean | null;
    cardLast4?: string | null;
    saldoDeudaArs?: number | null;
    saldoDeudaUsd?: number | null;
  } | null;
  if (!body) return json({ error: "JSON inválido" }, 400);
  const current = await debtRow(env, user.id);
  let dueDay = current?.due_day ?? null;
  if (body.dueDay !== undefined) {
    if (body.dueDay == null) dueDay = null;
    else {
      const day = Math.round(Number(body.dueDay));
      if (!Number.isFinite(day) || day < 1 || day > 31) {
        return json({ error: "El día de vencimiento tiene que ser entre 1 y 31" }, 400);
      }
      dueDay = day;
    }
  }
  const rate = body.ratePct !== undefined ? optionalMoney(body.ratePct) : current?.rate_pct ?? null;
  const minPay = body.minPaymentArs !== undefined ? optionalMoney(body.minPaymentArs) : current?.min_payment_ars ?? null;
  const saldoArs = body.saldoDeudaArs !== undefined ? optionalMoney(body.saldoDeudaArs) : current?.saldo_deuda_ars ?? null;
  const saldoUsd = body.saldoDeudaUsd !== undefined ? optionalMoney(body.saldoDeudaUsd) : current?.saldo_deuda_usd ?? null;
  if (rate === false || minPay === false || saldoArs === false || saldoUsd === false) {
    return json({ error: "Monto inválido" }, 400);
  }
  const notes = body.notes !== undefined
    ? (body.notes == null ? null : String(body.notes).trim().slice(0, 500) || null)
    : current?.notes ?? null;
  let force = Boolean(current?.force_settled);
  let cleared = current?.cleared_at ?? null;
  if (body.forceSettled !== undefined) {
    force = Boolean(body.forceSettled);
    cleared = force ? (cleared ?? Date.now()) : null;
  }
  let cardLast4 = current?.card_last4 ?? null;
  if (body.cardLast4 !== undefined) {
    if (body.cardLast4 == null || body.cardLast4 === "") cardLast4 = null;
    else {
      const match = String(body.cardLast4).match(/(\d{4})\s*$/);
      cardLast4 = match ? match[1] : String(body.cardLast4).replace(/\D/g, "").slice(-4) || null;
    }
  }
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO debt_settings (
       user_id, rate_pct, min_payment_ars, due_day, notes, force_settled, cleared_at,
       card_last4, saldo_deuda_ars, saldo_deuda_usd, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       rate_pct = excluded.rate_pct,
       min_payment_ars = excluded.min_payment_ars,
       due_day = excluded.due_day,
       notes = excluded.notes,
       force_settled = excluded.force_settled,
       cleared_at = excluded.cleared_at,
       card_last4 = excluded.card_last4,
       saldo_deuda_ars = excluded.saldo_deuda_ars,
       saldo_deuda_usd = excluded.saldo_deuda_usd,
       updated_at = excluded.updated_at`,
  )
    .bind(user.id, rate, minPay, dueDay, notes, force ? 1 : 0, cleared, cardLast4, saldoArs, saldoUsd, now)
    .run();
  const saved = await debtRow(env, user.id);
  return json({ settings: serializeSettings(saved) });
}

function optionalMoney(value: unknown): string | null | false {
  if (value == null || value === "") return null;
  const parsed = parseExpenseAmount(value);
  if (!parsed.ok) return false;
  return expenseAmountText(parsed.amount);
}

async function closedStatements(env: Env, userId: string) {
  const res = await env.DB.prepare(
    `SELECT s.id AS id, s.file_name AS file_name, s.source AS source, s.status AS status, s.closed_at AS closed_at
     FROM card_statements s
     INNER JOIN household_members m ON m.household_id = s.household_id
     WHERE m.user_id = ? AND s.status = 'closed'
     ORDER BY s.closed_at DESC
     LIMIT 24`,
  )
    .bind(userId)
    .all<{ id: string; file_name: string | null; source: string; status: string; closed_at: number | null }>();
  return (res.results ?? []).map((row) => ({
    id: row.id,
    fileName: row.file_name,
    source: row.source,
    status: row.status,
    closedAt: row.closed_at != null ? new Date(row.closed_at).toISOString() : null,
  }));
}

async function pastCuotas(env: Env, userId: string) {
  const res = await env.DB.prepare(
    `SELECT t.date AS date, t.description_normalized AS description, t.installment AS installment, t.amount_ars AS amount_ars
     FROM transactions t
     INNER JOIN household_members m ON m.household_id = t.household_id
     WHERE m.user_id = ?
       AND t.installment IS NOT NULL
       AND length(trim(t.installment)) > 0
     ORDER BY t.date DESC
     LIMIT 15`,
  )
    .bind(userId)
    .all<{ date: string; description: string; installment: string | null; amount_ars: string | null }>();
  return (res.results ?? []).map((row) => ({
    date: row.date,
    description: row.description,
    installment: row.installment,
    amountArs: row.amount_ars != null ? num(row.amount_ars) : null,
  }));
}

function snapshotSource(value: string): PatrimonioPoint["source"] {
  if (value === "derived" || value === "manual") return value;
  return "snapshot";
}

function defaultLabel(kind: "bank" | "evm" | "cardano"): string {
  if (kind === "evm") return "Wallet EVM";
  if (kind === "cardano") return "Wallet Cardano";
  return "Banco";
}
