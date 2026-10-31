import {
  isBankAccountingEntry,
  isCardPaymentEntry,
  isInternalTransferDescription,
} from "@/lib/bbva/bank-entries";
import {
  filterToPrimaryCard,
  pickPrimaryCardLast4,
} from "@/lib/bbva/card-account";
import { convertUsdToArs } from "@/lib/fx/month-end-rates";
import { isPeriodDebtSource } from "@/lib/import/source";

/** Below this, Casita shows “Saldada” — only when a snapshot exists. */
export const SETTLED_THRESHOLD_ARS = 50;

/** Lookback from the newest Últimos movimientos date. */
export const SNAPSHOT_LOOKBACK_DAYS = 21;

/**
 * Running ledger of incomplete BBVA history invents millions.
 * Anything at or above this is treated as a bad ledger, not real debt.
 */
export const INCOMPLETE_LEDGER_ARS = 50_000;

export type DebtTx = {
  id?: string;
  date: string;
  descriptionNormalized: string;
  amountArs: number | string | null;
  amountUsd: number | string | null;
  installment?: string | null;
  isPayment: boolean;
  isCredit?: boolean;
  ownership?: string | null;
  paidByUserId?: string | null;
  source?: string | null;
  bank?: string | null;
  cardLast4?: string | null;
  statementId?: string | null;
};

export type DebtSettingsInput = {
  forceSettled?: boolean | null;
  cardLast4?: string | null;
  /** Rainman: editable card saldo — source of truth for Deuda hero. */
  saldoDeudaArs?: number | null;
  saldoDeudaUsd?: number | null;
};

export type OpenInstallment = {
  description: string;
  current: number;
  total: number;
  remainingCount: number;
  installmentArs: number;
  remainingArs: number;
  date: string;
  cardLast4: string | null;
};

export type OpenCharge = {
  id?: string;
  date: string;
  description: string;
  amountArs: number;
  amountUsd: number;
};

export type DebtPayment = {
  id: string;
  date: string;
  description: string;
  amountArs: number | null;
  amountUsd: number | null;
  kind: "payment" | "credit";
};

export type CardDebtResult = {
  currentBalanceArs: number;
  currentBalanceUsd: number;
  settled: boolean;
  forceSettled: boolean;
  openInstallments: OpenInstallment[];
  openCharges: OpenCharge[];
  payments: DebtPayment[];
  totalPaidArs: number;
  totalPaidUsd: number;
  totalChargesArs: number;
  totalChargesUsd: number;
  peakBalanceArs: number;
  /**
   * Rainman: open card saldo from the live snapshot (cuotas + cargos).
   * Same as currentBalanceArs when mode=snapshot; 0 when empty.
   */
  saldoSnapshotArs: number;
  /** Rainman: deuda_neta = saldo_snapshot − pagos_aplicados (floored at 0). */
  netDebtArs: number;
  primaryCardLast4: string | null;
  mode: "forced" | "snapshot" | "installments" | "manual" | "empty";
};

function n(v: unknown): number {
  if (v == null || v === "") return 0;
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

export function parseInstallment(
  raw: string | null | undefined,
): { current: number; total: number } | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s || s === "-" || s === "/") return null;
  const m = s.match(/(\d+)\s*\/\s*(\d+)/);
  if (!m) return null;
  const current = Number(m[1]);
  const total = Number(m[2]);
  if (
    !Number.isFinite(current) ||
    !Number.isFinite(total) ||
    current < 1 ||
    total < 1 ||
    current > total ||
    total > 60
  ) {
    return null;
  }
  return { current, total };
}

export function isPrivateToUser(
  r: { ownership?: string | null; paidByUserId?: string | null },
  userId: string,
): boolean {
  if (r.paidByUserId) return r.paidByUserId === userId;
  return r.ownership === "personal" || r.ownership == null;
}

/** Fiwind / other banks are not BBVA card debt. */
export function isBbvaCardDebtRow(r: {
  source?: string | null;
  bank?: string | null;
}): boolean {
  const bank = r.bank?.trim() || "";
  if (bank && bank !== "BBVA") return false;
  const source = r.source ?? "";
  if (!source) return bank === "BBVA" || bank === "";
  if (source.startsWith("bbva")) return true;
  if (
    source === "bbva_import" ||
    source === "bbva_xlsx" ||
    source === "bbva_period" ||
    source === "bbva_pdf"
  ) {
    return true;
  }
  // Classic Excel mapped to bbva_import; untagged BBVA tables.
  if (
    (source === "xlsx_import" || source === "xls" || source === "xlsx") &&
    (!bank || bank === "BBVA")
  ) {
    return true;
  }
  return false;
}

function foldDesc(d: string): string {
  return d
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

function planKey(
  description: string,
  total: number,
  installmentArs: number,
): string {
  return `${foldDesc(description)}|${total}|${installmentArs.toFixed(2)}`;
}

function toArs(
  ars: number,
  usd: number,
  usdRate: number,
): number {
  return ars + convertUsdToArs(usd, usdRate);
}

function isChargeRow(r: DebtTx): boolean {
  if (r.isPayment || r.isCredit) return false;
  if (isCardPaymentEntry(r.descriptionNormalized)) return false;
  if (isBankAccountingEntry(r.descriptionNormalized)) return false;
  if (r.ownership === "shared") return false;
  return true;
}

export function groupOpenInstallments(
  rows: DebtTx[],
  usdRate = 0,
): OpenInstallment[] {
  type Acc = {
    description: string;
    current: number;
    total: number;
    installmentArs: number;
    date: string;
    cardLast4: string | null;
  };
  const byKey = new Map<string, Acc>();
  for (const r of rows) {
    if (!isChargeRow(r)) continue;
    const inst = parseInstallment(r.installment);
    if (!inst) continue;
    const ars = Math.abs(n(r.amountArs));
    const usd = Math.abs(n(r.amountUsd));
    const installmentArs = toArs(ars, usd, usdRate);
    if (installmentArs <= 0) continue;
    const key = planKey(r.descriptionNormalized, inst.total, installmentArs);
    const prev = byKey.get(key);
    if (!prev || inst.current > prev.current) {
      byKey.set(key, {
        description: r.descriptionNormalized.replace(/\s+/g, " ").trim(),
        current: inst.current,
        total: inst.total,
        installmentArs,
        date: r.date,
        cardLast4: r.cardLast4 ?? null,
      });
    }
  }

  const open: OpenInstallment[] = [];
  for (const p of byKey.values()) {
    if (p.current >= p.total) continue;
    const remainingCount = p.total - p.current;
    open.push({
      description: p.description,
      current: p.current,
      total: p.total,
      remainingCount,
      installmentArs: p.installmentArs,
      remainingArs: remainingCount * p.installmentArs,
      date: p.date,
      cardLast4: p.cardLast4,
    });
  }
  open.sort((a, b) => b.remainingArs - a.remainingArs);
  return open;
}

function maxDate(rows: DebtTx[]): string | null {
  let max: string | null = null;
  for (const r of rows) {
    if (!max || r.date > max) max = r.date;
  }
  return max;
}

function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** Period xls / PDF are history; everything else can be a live snapshot. */
export function isSnapshotDebtRow(r: { source?: string | null }): boolean {
  return !isPeriodDebtSource(r.source);
}

/**
 * Real card activity for anchoring the 21d Últimos movimientos window.
 * Bank CA self-transfers / FX / accounting must not age out TEMBICI/Ecobici
 * when a newer CR TBE lands as bbva_import.
 */
export function isCardSnapshotActivity(r: DebtTx): boolean {
  const desc = r.descriptionNormalized ?? "";
  if (isCardPaymentEntry(desc)) return true;
  if (isInternalTransferDescription(desc)) return false;
  if (isBankAccountingEntry(desc)) return false;
  // Open charges / cuotas (including untagged ultimos without last4).
  if (r.isPayment && !isCardPaymentEntry(desc)) return false;
  if (r.isCredit) return false;
  return true;
}

/**
 * Latest Últimos movimientos window — not the period xls history.
 * Anchor on real card charges/payments so bank CA noise does not drop
 * TEMBICI outside the lookback. Still returns payments in-window for Pagado.
 */
export function latestSnapshotRows(rows: DebtTx[]): DebtTx[] {
  const snapshot = rows.filter(isSnapshotDebtRow);
  const anchors = snapshot.filter(isCardSnapshotActivity);
  const newest = maxDate(anchors.length > 0 ? anchors : snapshot);
  if (!newest) return [];
  const from = addDaysIso(newest, -SNAPSHOT_LOOKBACK_DAYS);
  return snapshot.filter((r) => {
    if (r.date < from) return false;
    // Keep card activity + card payments; drop bank CA accounting from debt view.
    return isCardSnapshotActivity(r) || isCardPaymentEntry(r.descriptionNormalized ?? "");
  });
}

function openChargesFrom(rows: DebtTx[]): OpenCharge[] {
  const out: OpenCharge[] = [];
  for (const r of rows) {
    if (!isChargeRow(r)) continue;
    if (parseInstallment(r.installment)) continue;
    const amountArs = Math.abs(n(r.amountArs));
    const amountUsd = Math.abs(n(r.amountUsd));
    if (amountArs <= 0 && amountUsd <= 0) continue;
    out.push({
      id: r.id,
      date: r.date,
      description: r.descriptionNormalized.replace(/\s+/g, " ").trim(),
      amountArs,
      amountUsd,
    });
  }
  out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return out;
}

function paymentList(rows: DebtTx[]): DebtPayment[] {
  const out: DebtPayment[] = [];
  for (const r of rows) {
    const desc = r.descriptionNormalized ?? "";
    const looksPay = isCardPaymentEntry(desc);
    const isPay = Boolean(r.isPayment);
    const isCredit = Boolean(r.isCredit);
    // Rainman: self-transfer / own FX never inflate debt (nor count as card payment).
    if (isInternalTransferDescription(desc) && !looksPay) continue;
    if (!(looksPay || isPay || isCredit)) continue;
    if (isBankAccountingEntry(desc) && !looksPay && !isPay) continue;
    const kind: "payment" | "credit" =
      looksPay || (isPay && !isCredit) ? "payment" : "credit";
    out.push({
      id: r.id ?? `${r.date}|${desc}`,
      date: r.date,
      description: desc,
      amountArs: r.amountArs != null ? n(r.amountArs) : null,
      amountUsd: r.amountUsd != null ? n(r.amountUsd) : null,
      kind,
    });
  }
  out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return out;
}

function sumCharges(charges: OpenCharge[], usdRate: number) {
  let ars = 0;
  let usd = 0;
  for (const c of charges) {
    ars += c.amountArs;
    usd += c.amountUsd;
  }
  return { ars, usd, combined: toArs(ars, usd, usdRate) };
}

/**
 * Real open card debt: remaining cuotas on the latest snapshot +
 * small un-installmented charges (TEMBICI / Ecobici). Never a running
 * ledger of period xls history (that invents millions when payments
 * are missing).
 */
export function computeCardDebt(
  rows: DebtTx[],
  opts: {
    userId: string;
    settings?: DebtSettingsInput | null;
    usdRate?: number;
    knownDescriptions?: Iterable<string>;
  },
): CardDebtResult {
  const usdRate = opts.usdRate ?? 0;
  const forceSettled = Boolean(opts.settings?.forceSettled);
  const empty: CardDebtResult = {
    currentBalanceArs: 0,
    currentBalanceUsd: 0,
    // Empty / no snapshot is not Saldada — only forceSettled is.
    settled: forceSettled,
    forceSettled,
    openInstallments: [],
    openCharges: [],
    payments: [],
    totalPaidArs: 0,
    totalPaidUsd: 0,
    totalChargesArs: 0,
    totalChargesUsd: 0,
    peakBalanceArs: 0,
    saldoSnapshotArs: 0,
    netDebtArs: 0,
    primaryCardLast4: opts.settings?.cardLast4 ?? null,
    mode: forceSettled ? "forced" : "empty",
  };

  if (forceSettled) {
    return empty;
  }

  const mine = rows.filter(
    (r) =>
      isPrivateToUser(r, opts.userId) &&
      isBbvaCardDebtRow(r) &&
      r.ownership !== "shared",
  );

  const primaryCardLast4 = pickPrimaryCardLast4(mine, {
    preferredLast4: opts.settings?.cardLast4,
    knownDescriptions: opts.knownDescriptions,
  });
  // Period xls lists every card; Últimos movimientos often has no last4.
  // Never last4-filter snapshot rows — that dropped TEMBICI / Ecobici.
  const periodMine = mine.filter((r) => isPeriodDebtSource(r.source));
  const snapshotMine = mine.filter(isSnapshotDebtRow);
  const scopedPeriod = filterToPrimaryCard(periodMine, primaryCardLast4);
  const scoped = [...scopedPeriod, ...snapshotMine];

  const snapshot = latestSnapshotRows(scoped);
  const payments = paymentList(snapshot);
  const totalPaidArs = payments
    .filter((p) => p.kind === "payment")
    .reduce((s, p) => s + Math.abs(p.amountArs ?? 0), 0);
  const totalPaidUsd = payments
    .filter((p) => p.kind === "payment")
    .reduce((s, p) => s + Math.abs(p.amountUsd ?? 0), 0);

  const snapshotInstallments = groupOpenInstallments(snapshot, usdRate);
  const snapshotCharges = openChargesFrom(snapshot);

  const periodOnly = scoped.filter((r) => isPeriodDebtSource(r.source));
  const periodInstallments = groupOpenInstallments(periodOnly, usdRate);

  let openInstallments: OpenInstallment[];
  let openCharges: OpenCharge[];
  let mode: CardDebtResult["mode"];

  if (snapshot.length > 0) {
    // Latest Últimos movimientos is the source of truth after cancel/payoff.
    // Period cuotas that no longer appear there are not current debt.
    openInstallments = snapshotInstallments;
    openCharges = snapshotCharges;
    mode = "snapshot";
  } else if (periodInstallments.length > 0) {
    openInstallments = periodInstallments;
    openCharges = [];
    mode = "installments";
  } else {
    openInstallments = [];
    openCharges = [];
    mode = "empty";
  }

  const chargeSum = sumCharges(openCharges, usdRate);

  // Rainman minimal path: editable saldo_deuda is the only balance source of truth.
  // Without it → Sin snapshot (mode empty). Never invent from CA noise / TEMBICI sum.
  const saldoArsRaw = opts.settings?.saldoDeudaArs;
  const saldoUsdRaw = opts.settings?.saldoDeudaUsd;
  const hasSaldo = saldoArsRaw != null || saldoUsdRaw != null;

  let currentBalanceArs = 0;
  let currentBalanceUsd = 0;
  let settled = false;

  if (hasSaldo) {
    const balanceArs = Math.abs(n(saldoArsRaw));
    const balanceUsd = Math.abs(n(saldoUsdRaw));
    currentBalanceArs =
      balanceArs < SETTLED_THRESHOLD_ARS && balanceUsd < 0.01 ? 0 : balanceArs;
    currentBalanceUsd = currentBalanceArs === 0 ? 0 : balanceUsd;
    settled = currentBalanceArs === 0 && currentBalanceUsd === 0;
    mode = "manual";
  } else {
    // Keep cuotas/cargos lists for context, but do not invent a hero balance.
    currentBalanceArs = 0;
    currentBalanceUsd = 0;
    settled = false;
    mode = "empty";
  }

  const saldoSnapshotArs = hasSaldo ? currentBalanceArs : 0;
  const netDebtArs = saldoSnapshotArs;

  return {
    currentBalanceArs,
    currentBalanceUsd,
    settled,
    forceSettled: false,
    openInstallments,
    openCharges,
    payments,
    totalPaidArs,
    totalPaidUsd,
    totalChargesArs: chargeSum.ars,
    totalChargesUsd: chargeSum.usd,
    peakBalanceArs: currentBalanceArs,
    saldoSnapshotArs,
    netDebtArs,
    primaryCardLast4,
    mode,
  };
}