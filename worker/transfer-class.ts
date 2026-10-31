/**
 * Classify expense transfers by data, not by the label text.
 *
 * An expense-eligible row (`is_payment = 0` and `is_credit = 0`) whose
 * accent-folded description is a transfer is one of three things:
 *
 * - internal: the description carries an own-account id, or a 1:1 incoming
 *   twin of the same signed amount exists within one calendar day in another
 *   account of the same user. Internal ids are dropped from expense totals
 *   and stay visible in Consumos.
 * - third party: a non-own CUIT, CBU/CVU, alias, or payee name is present,
 *   and there is no own id and no twin. It counts as spending. No flag.
 * - revisar: none of the above. It counts, stays on Consumos, and the
 *   Worker sets `revisar: true` on the row. The flag is computed per request.
 *
 * Own ids are `OWN_ACCOUNT_IDS` (comma-separated CUITs, CBUs/CVUs, aliases;
 * never committed) plus every CUIT/CBU/CVU found on the user's rows whose
 * description contains an own-account marker. No real id is hardcoded.
 *
 * Direction uses the row's own currency (USD when |USD| >= 0.005 and the
 * counted ARS is 0 the way `ARS_EXPR` is 0 when both sides are nonzero,
 * otherwise ARS). Outgoing is a positive amount with `is_credit = 0`.
 * Incoming is `is_credit = 1` with a positive amount, or a negative amount
 * with `is_credit = 0`. A twin must be the opposite direction. The amount
 * compared is the transfer's own currency, same sign, strictly under
 * 0.01 ARS or 0.005 USD. +100 does not match -100: the signs disagree, so
 * both read as an outgoing magnitude in the transfer's own direction.
 * +100 outgoing does not match +100 outgoing.
 *
 * Pairing is 1:1. Closest day first, then transfer date, transfer id, twin
 * date, twin id. Each incoming row cancels at most one transfer. Rows in a
 * household the user does not belong to are ignored.
 *
 * `classifyTransferRows` and `deriveOwnAccountIds` take plain arrays. They
 * do not touch D1. The loader is one extra indexed statement on top of the
 * Fiwind echo lookup: `household_members.user_id`, then
 * `tx_household_date_idx (household_id, date)`. A failure returns no
 * internal ids, so those rows still count.
 */

import { loadFiwindEchoIds, type FiwindEchoDb } from "./fiwind-dups";

const ARS_TOLERANCE = 0.01;
const USD_TOLERANCE = 0.005;
const USD_CURRENCY_MIN = 0.005;
const DAY_MS = 86_400_000;

const OWN_MARKERS = ["OWN ACCOUNT", "OWN CUIT", "CUENTA PROPIA", "CUENTA TUYA"] as const;

const GENERIC_PAYEES = new Set([
  "OUTGOING TRANSFER (PAYEE UNKNOWN)",
  "FIWIND (PROBABLE)",
  "PAYEE UNKNOWN",
  "OUTGOING TRANSFER",
  "TRANSFERENCIA",
  "TRANSFERENCIA INMEDIATA",
  "TRANSFER TO",
  "TRANSF A",
]);

const NAME_PREFIXES = ["TRANSFERENCIA A ", "TRANSFER TO ", "TRANSF A "] as const;

export type TransferClassRow = {
  id: string;
  householdId: string;
  date: string;
  bank?: string | null;
  description?: string | null;
  amountArs?: string | number | null;
  amountUsd?: string | number | null;
  isPayment?: number | boolean | null;
  isCredit?: number | boolean | null;
};

export type TransferClass = {
  internalIds: Set<string>;
  thirdPartyIds: Set<string>;
  revisarIds: Set<string>;
};

export type IncomeMatchRow = {
  id: string;
  householdId?: string | null;
  date: string;
  amountArs?: string | number | null;
  amountUsd?: string | number | null;
};

type Currency = "ARS" | "USD";
type Direction = "outgoing" | "incoming";

type Side = {
  id: string;
  householdId: string;
  bank: string;
  date: string;
  day: number;
  ars: number;
  usd: number;
  isCredit: boolean;
  isPayment: boolean;
  description: string;
};

type Pair = {
  distance: number;
  tDate: string;
  tId: string;
  mDate: string;
  mId: string;
};

export function foldTransferText(value: string | null | undefined): string {
  return (value ?? "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function hasOwnAccountMarker(description: string | null | undefined): boolean {
  const folded = foldTransferText(description);
  if (!folded) return false;
  return OWN_MARKERS.some((marker) => folded.includes(marker));
}

/** CUIT (11) and CBU/CVU (22). Dashes and spaces between digits are ignored. */
export function extractAccountIds(description: string | null | undefined): string[] {
  const text = description ?? "";
  const found = new Set<string>();
  const ids: string[] = [];
  const push = (digits: string) => {
    if (found.has(digits)) return;
    found.add(digits);
    ids.push(digits);
  };
  const occupied: Array<[number, number]> = [];
  const cbu = /(?<!\d)\d(?:[\s-]?\d){21}(?!\d)/g;
  for (const match of text.matchAll(cbu)) {
    const digits = match[0].replace(/\D/g, "");
    if (digits.length !== 22) continue;
    push(digits);
    const start = match.index ?? 0;
    occupied.push([start, start + match[0].length]);
  }
  const overlaps = (start: number, end: number) => occupied.some(([from, to]) => start < to && end > from);
  const cuit = /(?<!\d)\d{2}[\s-]?\d{8}[\s-]?\d(?!\d)/g;
  for (const match of text.matchAll(cuit)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (overlaps(start, end)) continue;
    const digits = match[0].replace(/\D/g, "");
    if (digits.length === 11) push(digits);
  }
  return ids;
}

/** Comma-separated digit strings or aliases. Dashes inside a digit id are ignored. */
export function parseOwnAccountIds(raw: string | null | undefined): Set<string> {
  const out = new Set<string>();
  if (!raw) return out;
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const digits = trimmed.replace(/[\s-]/g, "");
    if (/^\d{11}$/.test(digits) || /^\d{22}$/.test(digits)) {
      out.add(digits);
      continue;
    }
    const alias = foldTransferText(trimmed);
    if (alias) out.add(alias);
  }
  return out;
}

/**
 * Config ids plus every CUIT/CBU/CVU on a row whose description contains an
 * own-account marker. Aliases come from config only.
 */
export function deriveOwnAccountIds(
  rows: readonly { description?: string | null }[],
  configured?: string | null | ReadonlySet<string>,
): Set<string> {
  const own =
    configured instanceof Set
      ? new Set(configured)
      : parseOwnAccountIds(typeof configured === "string" ? configured : null);
  for (const row of rows) {
    if (!hasOwnAccountMarker(row.description)) continue;
    for (const id of extractAccountIds(row.description)) own.add(id);
  }
  return own;
}

export function isTransferDescription(description: string | null | undefined): boolean {
  const folded = foldTransferText(description);
  if (!folded) return false;
  if (folded.includes("TRANSFERENCIA INMEDIATA")) return true;
  if (folded === "TRANSFERENCIA" || folded.startsWith("TRANSFERENCIA")) return true;
  if (folded.includes("OUTGOING TRANSFER")) return true;
  if (folded.includes("TRANSFER TO")) return true;
  if (folded.includes("TRANSF A")) return true;
  return false;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function aliasesIn(description: string | null | undefined): string[] {
  const folded = foldTransferText(description);
  if (!folded) return [];
  return [...folded.matchAll(/[A-Z][A-Z0-9]*(?:\.[A-Z0-9]+)+/g)].map((match) => match[0]);
}

function hasAliasToken(folded: string, alias: string): boolean {
  const needle = foldTransferText(alias);
  if (!needle) return false;
  const re = new RegExp(`(?:^|[^A-Z0-9.])${escapeRegExp(needle)}(?:[^A-Z0-9.]|$)`);
  return re.test(folded);
}

/** True when the text contains a CUIT/CBU/CVU or alias from `ownIds`. */
export function descriptionHasOwnId(description: string | null | undefined, ownIds: ReadonlySet<string>): boolean {
  if (ownIds.size === 0) return false;
  for (const id of extractAccountIds(description)) {
    if (ownIds.has(id)) return true;
  }
  const folded = foldTransferText(description);
  for (const alias of aliasesIn(description)) {
    if (ownIds.has(alias)) return true;
  }
  for (const id of ownIds) {
    if (/^\d{11}$/.test(id) || /^\d{22}$/.test(id)) continue;
    if (hasAliasToken(folded, id)) return true;
  }
  return false;
}

function payeeSegment(description: string | null | undefined): string | null {
  const raw = description ?? "";
  if (raw.includes("|")) return foldTransferText(raw.split("|")[0] ?? "");
  const folded = foldTransferText(raw);
  for (const prefix of NAME_PREFIXES) {
    const at = folded.indexOf(prefix);
    if (at >= 0) return folded.slice(at + prefix.length).trim();
  }
  return null;
}

function isGenericPayee(segment: string): boolean {
  if (!segment) return true;
  if (GENERIC_PAYEES.has(segment)) return true;
  return segment.includes("PAYEE UNKNOWN");
}

/** Non-own CUIT/CBU/CVU/alias, or a payee name that is not a generic placeholder. */
export function transferHasCounterpart(description: string | null | undefined, ownIds: ReadonlySet<string>): boolean {
  for (const id of extractAccountIds(description)) {
    if (!ownIds.has(id)) return true;
  }
  for (const alias of aliasesIn(description)) {
    if (!ownIds.has(alias)) return true;
  }
  const segment = payeeSegment(description);
  return segment != null && !isGenericPayee(segment);
}

/** Transfer label with no own id, no marker, and no counterpart. */
export function isUndeterminedTransfer(description: string | null | undefined, ownIds: ReadonlySet<string>): boolean {
  if (!isTransferDescription(description)) return false;
  if (hasOwnAccountMarker(description)) return false;
  if (descriptionHasOwnId(description, ownIds)) return false;
  if (transferHasCounterpart(description, ownIds)) return false;
  return true;
}

function parseAmount(value: string | number | null | undefined): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (value == null) return 0;
  const text = String(value).trim();
  if (!text) return 0;
  const amount = Number(text);
  return Number.isFinite(amount) ? amount : 0;
}

function countedArsAbs(ars: number, usd: number): number {
  if (Math.abs(usd) > 0 && Math.abs(ars) > 0) return 0;
  return Math.abs(ars);
}

function ownCurrency(ars: number, usd: number): Currency {
  if (Math.abs(usd) >= USD_CURRENCY_MIN && countedArsAbs(ars, usd) === 0) return "USD";
  return "ARS";
}

function tolerance(currency: Currency): number {
  return currency === "ARS" ? ARS_TOLERANCE : USD_TOLERANCE;
}

function withinTolerance(left: number, right: number, tol: number): boolean {
  const scale = 1_000_000;
  return Math.abs(Math.round(left * scale) - Math.round(right * scale)) < Math.round(tol * scale);
}

function dayIndex(iso: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const utc = Date.UTC(year, month - 1, day);
  const check = new Date(utc);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    return null;
  }
  return Math.floor(utc / DAY_MS);
}

function cmpText(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function flag(value: number | boolean | null | undefined): boolean {
  return value === true || value === 1;
}

function amountIn(side: Side, currency: Currency): number {
  return currency === "USD" ? side.usd : side.ars;
}

/** Outgoing or incoming in the row's own currency. Null when the amount is 0. */
export function transferDirection(row: TransferClassRow): Direction | null {
  const side = toSide(row);
  if (!side) return null;
  return directionOf(side);
}

function directionOf(side: Side): Direction | null {
  const amount = amountIn(side, ownCurrency(side.ars, side.usd));
  if (amount > 0 && !side.isCredit) return "outgoing";
  if (side.isCredit && amount > 0) return "incoming";
  if (amount < 0 && !side.isCredit) return "incoming";
  return null;
}

function toSide(row: TransferClassRow): Side | null {
  if (!row.id || !row.householdId || !row.date) return null;
  const day = dayIndex(row.date);
  if (day == null) return null;
  return {
    id: row.id,
    householdId: row.householdId,
    bank: row.bank ?? "",
    date: row.date,
    day,
    ars: parseAmount(row.amountArs),
    usd: parseAmount(row.amountUsd),
    isCredit: flag(row.isCredit),
    isPayment: flag(row.isPayment),
    description: row.description ?? "",
  };
}

function otherAccount(left: Side, right: Side, homes: ReadonlySet<string>): boolean {
  if (!homes.has(left.householdId) || !homes.has(right.householdId)) return false;
  if (left.householdId !== right.householdId) return true;
  return left.bank !== right.bank;
}

function expenseTransfer(side: Side, homes: ReadonlySet<string>): boolean {
  if (!homes.has(side.householdId)) return false;
  if (side.isPayment || side.isCredit) return false;
  if (directionOf(side) !== "outgoing") return false;
  return isTransferDescription(side.description);
}

/**
 * Ids of outgoing transfers cancelled by an incoming twin. Own-id matches are
 * not included; pass them in `skipIds` so they do not consume the twin.
 */
export function pairInternalTransferIds(
  rows: readonly TransferClassRow[],
  userHouseholdIds: ReadonlySet<string>,
  skipIds?: ReadonlySet<string>,
): Set<string> {
  const sides: Side[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row.id || seen.has(row.id)) continue;
    const side = toSide(row);
    if (!side) continue;
    seen.add(row.id);
    sides.push(side);
  }
  const outgoing = sides.filter(
    (side) => expenseTransfer(side, userHouseholdIds) && !skipIds?.has(side.id),
  );
  if (outgoing.length === 0) return new Set();

  const buckets = new Map<string, Side[]>();
  const pushBucket = (currency: Currency, amount: number, row: Side) => {
    if (amount === 0) return;
    const key = `${currency}:${Math.round(amount / tolerance(currency))}`;
    const list = buckets.get(key);
    if (list) list.push(row);
    else buckets.set(key, [row]);
  };
  for (const row of sides) {
    if (directionOf(row) !== "incoming") continue;
    if (!userHouseholdIds.has(row.householdId)) continue;
    pushBucket("ARS", row.ars, row);
    pushBucket("USD", row.usd, row);
  }

  const pairs: Pair[] = [];
  for (const transfer of outgoing) {
    const currency = ownCurrency(transfer.ars, transfer.usd);
    const amount = amountIn(transfer, currency);
    if (amount === 0) continue;
    const tol = tolerance(currency);
    const key = Math.round(amount / tol);
    for (let delta = -1; delta <= 1; delta += 1) {
      const list = buckets.get(`${currency}:${key + delta}`);
      if (!list) continue;
      for (const twin of list) {
        if (twin.id === transfer.id) continue;
        if (!otherAccount(transfer, twin, userHouseholdIds)) continue;
        const twinAmount = amountIn(twin, currency);
        // Same sign. +100 does not match -100.
        if (amount * twinAmount <= 0) continue;
        if (!withinTolerance(amount, twinAmount, tol)) continue;
        if (directionOf(twin) !== "incoming") continue;
        const distance = Math.abs(transfer.day - twin.day);
        if (distance > 1) continue;
        pairs.push({
          distance,
          tDate: transfer.date,
          tId: transfer.id,
          mDate: twin.date,
          mId: twin.id,
        });
      }
    }
  }

  pairs.sort(
    (a, b) =>
      a.distance - b.distance ||
      cmpText(a.tDate, b.tDate) ||
      cmpText(a.tId, b.tId) ||
      cmpText(a.mDate, b.mDate) ||
      cmpText(a.mId, b.mId),
  );

  const usedTransfer = new Set<string>();
  const usedTwin = new Set<string>();
  const internal = new Set<string>();
  for (const pair of pairs) {
    if (usedTransfer.has(pair.tId) || usedTwin.has(pair.mId)) continue;
    usedTransfer.add(pair.tId);
    usedTwin.add(pair.mId);
    internal.add(pair.tId);
  }
  return internal;
}

export function classifyTransferRows(
  rows: readonly TransferClassRow[],
  ownIds: ReadonlySet<string>,
  userHouseholdIds: ReadonlySet<string>,
): TransferClass {
  const internalIds = new Set<string>();
  const thirdPartyIds = new Set<string>();
  const revisarIds = new Set<string>();
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row.id || seen.has(row.id)) continue;
    const side = toSide(row);
    if (!side || !expenseTransfer(side, userHouseholdIds)) continue;
    seen.add(row.id);
    if (descriptionHasOwnId(side.description, ownIds)) internalIds.add(side.id);
  }
  for (const id of pairInternalTransferIds(rows, userHouseholdIds, internalIds)) {
    internalIds.add(id);
  }
  seen.clear();
  for (const row of rows) {
    if (!row.id || seen.has(row.id)) continue;
    const side = toSide(row);
    if (!side || !expenseTransfer(side, userHouseholdIds)) continue;
    seen.add(row.id);
    if (internalIds.has(side.id)) continue;
    if (transferHasCounterpart(side.description, ownIds)) thirdPartyIds.add(side.id);
    else if (isUndeterminedTransfer(side.description, ownIds)) revisarIds.add(side.id);
  }
  return { internalIds, thirdPartyIds, revisarIds };
}

type IncomeSide = {
  id: string;
  householdId: string;
  date: string;
  day: number;
  ars: number;
  usd: number;
};

/**
 * Variable income ids cancelled by an outgoing transaction of the same signed
 * amount within one day, in another account of the same user. 1:1, closest
 * day first, then income date, income id, transaction date, transaction id.
 */
export function pairIncomeInternalIds(
  incomes: readonly IncomeMatchRow[],
  outgoing: readonly TransferClassRow[],
  userHouseholdIds: ReadonlySet<string>,
): Set<string> {
  const incomesSides: IncomeSide[] = [];
  const seenIncome = new Set<string>();
  for (const row of incomes) {
    if (!row.id || !row.householdId || seenIncome.has(row.id)) continue;
    if (!userHouseholdIds.has(row.householdId)) continue;
    const day = dayIndex(row.date);
    if (day == null) continue;
    seenIncome.add(row.id);
    incomesSides.push({
      id: row.id,
      householdId: row.householdId,
      date: row.date,
      day,
      ars: parseAmount(row.amountArs),
      usd: parseAmount(row.amountUsd),
    });
  }
  const txs: Side[] = [];
  const seenTx = new Set<string>();
  for (const row of outgoing) {
    if (!row.id || seenTx.has(row.id)) continue;
    const side = toSide(row);
    if (!side || !userHouseholdIds.has(side.householdId)) continue;
    if (directionOf(side) !== "outgoing") continue;
    seenTx.add(row.id);
    txs.push(side);
  }
  if (incomesSides.length === 0 || txs.length === 0) return new Set();

  const pairs: Pair[] = [];
  for (const income of incomesSides) {
    const currency = ownCurrency(income.ars, income.usd);
    const amount = currency === "USD" ? income.usd : income.ars;
    if (amount <= 0) continue;
    const tol = tolerance(currency);
    for (const tx of txs) {
      const txAmount = amountIn(tx, currency);
      if (amount * txAmount <= 0) continue;
      if (!withinTolerance(amount, txAmount, tol)) continue;
      const distance = Math.abs(income.day - tx.day);
      if (distance > 1) continue;
      const incomeSide: Side = {
        ...tx,
        id: income.id,
        householdId: income.householdId,
        bank: "",
        date: income.date,
        day: income.day,
      };
      if (!otherAccount(incomeSide, tx, userHouseholdIds)) continue;
      pairs.push({
        distance,
        tDate: income.date,
        tId: income.id,
        mDate: tx.date,
        mId: tx.id,
      });
    }
  }

  pairs.sort(
    (a, b) =>
      a.distance - b.distance ||
      cmpText(a.tDate, b.tDate) ||
      cmpText(a.tId, b.tId) ||
      cmpText(a.mDate, b.mDate) ||
      cmpText(a.mId, b.mId),
  );

  const usedIncome = new Set<string>();
  const usedTx = new Set<string>();
  const internal = new Set<string>();
  for (const pair of pairs) {
    if (usedIncome.has(pair.tId) || usedTx.has(pair.mId)) continue;
    usedIncome.add(pair.tId);
    usedTx.add(pair.mId);
    internal.add(pair.tId);
  }
  return internal;
}

/**
 * One statement, three binds of `user_id` (membership, then the user's
 * incomes twice). Transaction reads are `household_id` equality plus a
 * ±1 day range on `tx_household_date_idx`. There is no date-only predicate.
 *
 * `hh` is one row per household. `tx` is an expense-eligible transfer-shaped
 * row. `marker` is a row that can contribute an own-account id. `near` is a
 * possible twin in the date window. `inc` is an outgoing transaction that
 * can cancel an income row.
 */
export const TRANSFER_CANDIDATE_SQL = `
WITH user_households AS (
  SELECT household_id FROM household_members WHERE user_id = ?
),
transfers AS (
  SELECT
    t.id,
    t.household_id,
    t.date,
    t.bank,
    t.description_normalized,
    t.amount_ars,
    t.amount_usd,
    t.is_payment,
    t.is_credit
  FROM user_households uh
  INNER JOIN transactions t ON t.household_id = uh.household_id
  WHERE t.is_payment = 0
    AND t.is_credit = 0
    AND (
      upper(IFNULL(t.description_normalized, '')) LIKE '%TRANSFERENCIA%'
      OR upper(IFNULL(t.description_normalized, '')) LIKE '%OUTGOING TRANSFER%'
      OR upper(IFNULL(t.description_normalized, '')) LIKE '%TRANSFER TO%'
      OR upper(IFNULL(t.description_normalized, '')) LIKE '%TRANSF A%'
    )
)
SELECT
  'hh' AS kind,
  uh.household_id AS id,
  uh.household_id AS household_id,
  NULL AS date,
  NULL AS bank,
  NULL AS description_normalized,
  NULL AS amount_ars,
  NULL AS amount_usd,
  NULL AS is_payment,
  NULL AS is_credit
FROM user_households uh
UNION ALL
SELECT
  'tx',
  tr.id,
  tr.household_id,
  tr.date,
  tr.bank,
  tr.description_normalized,
  tr.amount_ars,
  tr.amount_usd,
  tr.is_payment,
  tr.is_credit
FROM transfers tr
UNION ALL
SELECT
  'marker',
  t.id,
  t.household_id,
  t.date,
  t.bank,
  t.description_normalized,
  t.amount_ars,
  t.amount_usd,
  t.is_payment,
  t.is_credit
FROM user_households uh
INNER JOIN transactions t ON t.household_id = uh.household_id
WHERE upper(IFNULL(t.description_normalized, '')) LIKE '%CUENTA PROPIA%'
   OR upper(IFNULL(t.description_normalized, '')) LIKE '%CUENTA TUYA%'
   OR upper(IFNULL(t.description_normalized, '')) LIKE '%OWN ACCOUNT%'
   OR upper(IFNULL(t.description_normalized, '')) LIKE '%OWN CUIT%'
UNION ALL
SELECT
  'near',
  m.id,
  m.household_id,
  m.date,
  m.bank,
  m.description_normalized,
  m.amount_ars,
  m.amount_usd,
  m.is_payment,
  m.is_credit
FROM transfers n
INNER JOIN transactions m
  ON m.household_id = n.household_id
 AND m.date >= date(n.date, '-1 days')
 AND m.date <= date(n.date, '+1 days')
 AND m.id <> n.id
 AND IFNULL(m.bank, '') <> IFNULL(n.bank, '')
 AND (
   (
     abs(CAST(IFNULL(n.amount_ars, '0') AS REAL)) >= 0.01
     AND abs(abs(CAST(IFNULL(m.amount_ars, '0') AS REAL)) - abs(CAST(IFNULL(n.amount_ars, '0') AS REAL))) < 0.01
   )
   OR (
     abs(CAST(IFNULL(n.amount_usd, '0') AS REAL)) >= 0.005
     AND abs(abs(CAST(IFNULL(m.amount_usd, '0') AS REAL)) - abs(CAST(IFNULL(n.amount_usd, '0') AS REAL))) < 0.005
   )
 )
UNION ALL
SELECT
  'near',
  m.id,
  m.household_id,
  m.date,
  m.bank,
  m.description_normalized,
  m.amount_ars,
  m.amount_usd,
  m.is_payment,
  m.is_credit
FROM transfers n
INNER JOIN user_households uh ON uh.household_id <> n.household_id
INNER JOIN transactions m
  ON m.household_id = uh.household_id
 AND m.date >= date(n.date, '-1 days')
 AND m.date <= date(n.date, '+1 days')
 AND m.id <> n.id
 AND (
   (
     abs(CAST(IFNULL(n.amount_ars, '0') AS REAL)) >= 0.01
     AND abs(abs(CAST(IFNULL(m.amount_ars, '0') AS REAL)) - abs(CAST(IFNULL(n.amount_ars, '0') AS REAL))) < 0.01
   )
   OR (
     abs(CAST(IFNULL(n.amount_usd, '0') AS REAL)) >= 0.005
     AND abs(abs(CAST(IFNULL(m.amount_usd, '0') AS REAL)) - abs(CAST(IFNULL(n.amount_usd, '0') AS REAL))) < 0.005
   )
 )
UNION ALL
SELECT
  'inc',
  m.id,
  m.household_id,
  m.date,
  m.bank,
  m.description_normalized,
  m.amount_ars,
  m.amount_usd,
  m.is_payment,
  m.is_credit
FROM user_households uh
INNER JOIN incomes i ON i.household_id = uh.household_id AND i.user_id = ?
INNER JOIN transactions m
  ON m.household_id = i.household_id
 AND m.date >= date(i.date, '-1 days')
 AND m.date <= date(i.date, '+1 days')
WHERE m.is_credit = 0
  AND IFNULL(m.bank, '') <> ''
  AND (
    (
      CAST(IFNULL(m.amount_ars, '0') AS REAL) * CAST(IFNULL(i.amount_ars, '0') AS REAL) > 0
      AND abs(CAST(IFNULL(m.amount_ars, '0') AS REAL) - CAST(IFNULL(i.amount_ars, '0') AS REAL)) < 0.01
    )
    OR (
      CAST(IFNULL(m.amount_usd, '0') AS REAL) * CAST(IFNULL(i.amount_usd, '0') AS REAL) > 0
      AND abs(CAST(IFNULL(m.amount_usd, '0') AS REAL) - CAST(IFNULL(i.amount_usd, '0') AS REAL)) < 0.005
    )
  )
UNION ALL
SELECT
  'inc',
  m.id,
  m.household_id,
  m.date,
  m.bank,
  m.description_normalized,
  m.amount_ars,
  m.amount_usd,
  m.is_payment,
  m.is_credit
FROM user_households home
INNER JOIN incomes i ON i.household_id = home.household_id AND i.user_id = ?
INNER JOIN user_households uh ON uh.household_id <> i.household_id
INNER JOIN transactions m
  ON m.household_id = uh.household_id
 AND m.date >= date(i.date, '-1 days')
 AND m.date <= date(i.date, '+1 days')
WHERE m.is_credit = 0
  AND (
    (
      CAST(IFNULL(m.amount_ars, '0') AS REAL) * CAST(IFNULL(i.amount_ars, '0') AS REAL) > 0
      AND abs(CAST(IFNULL(m.amount_ars, '0') AS REAL) - CAST(IFNULL(i.amount_ars, '0') AS REAL)) < 0.01
    )
    OR (
      CAST(IFNULL(m.amount_usd, '0') AS REAL) * CAST(IFNULL(i.amount_usd, '0') AS REAL) > 0
      AND abs(CAST(IFNULL(m.amount_usd, '0') AS REAL) - CAST(IFNULL(i.amount_usd, '0') AS REAL)) < 0.005
    )
  )
`;

export type TransferCandidateRow = {
  kind: string;
  id: string | null;
  household_id: string | null;
  date: string | null;
  bank: string | null;
  description_normalized: string | null;
  amount_ars: string | number | null;
  amount_usd: string | number | null;
  is_payment: number | null;
  is_credit: number | null;
};

export type TransferClassDb = {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      all<T = TransferCandidateRow>(): Promise<{ results?: T[] }>;
    };
  };
};

export type MovementExclusion = {
  /** Fiwind echo ids plus internal-transfer ids. Safe to pass to `expenseSql`. */
  excludedIds: string[];
  /** Internal transfers only. Consumos keeps these visible. */
  internalIds: string[];
  revisarIds: ReadonlySet<string>;
  ownIds: ReadonlySet<string>;
  userHouseholdIds: ReadonlySet<string>;
  incomeOutgoing: TransferClassRow[];
};

function emptyTransfer(raw: string | null | undefined): Omit<MovementExclusion, "excludedIds"> & {
  internalIds: string[];
} {
  return {
    internalIds: [],
    revisarIds: new Set(),
    ownIds: parseOwnAccountIds(raw),
    userHouseholdIds: new Set(),
    incomeOutgoing: [],
  };
}

function mapCandidate(row: TransferCandidateRow): TransferClassRow | null {
  if (!row.id || !row.household_id || !row.date) return null;
  return {
    id: String(row.id),
    householdId: String(row.household_id),
    date: String(row.date),
    bank: row.bank,
    description: row.description_normalized,
    amountArs: row.amount_ars,
    amountUsd: row.amount_usd,
    isPayment: row.is_payment,
    isCredit: row.is_credit,
  };
}

export async function loadTransferSnapshot(
  db: TransferClassDb,
  userId: string,
  ownAccountIdsRaw: string | null | undefined,
): Promise<Omit<MovementExclusion, "excludedIds">> {
  try {
    const res = await db
      .prepare(TRANSFER_CANDIDATE_SQL)
      .bind(userId, userId, userId)
      .all<TransferCandidateRow>();
    const homes = new Set<string>();
    const rows: TransferClassRow[] = [];
    const seen = new Set<string>();
    const markers: Array<{ description: string | null }> = [];
    const outgoing: TransferClassRow[] = [];
    const seenOut = new Set<string>();
    for (const row of res.results ?? []) {
      if (row.kind === "hh") {
        if (row.household_id) homes.add(String(row.household_id));
        continue;
      }
      const mapped = mapCandidate(row);
      if (!mapped) continue;
      if (row.kind === "marker") markers.push({ description: mapped.description ?? null });
      if (row.kind === "inc") {
        if (!seenOut.has(mapped.id)) {
          seenOut.add(mapped.id);
          outgoing.push(mapped);
        }
        continue;
      }
      if (seen.has(mapped.id)) continue;
      seen.add(mapped.id);
      rows.push(mapped);
    }
    const ownIds = deriveOwnAccountIds(markers, parseOwnAccountIds(ownAccountIdsRaw));
    const classified = classifyTransferRows(rows, ownIds, homes);
    return {
      internalIds: [...classified.internalIds].sort(),
      revisarIds: classified.revisarIds,
      ownIds,
      userHouseholdIds: homes,
      incomeOutgoing: outgoing,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "error";
    console.error("transfer class load failed", message.slice(0, 180));
    return emptyTransfer(ownAccountIdsRaw);
  }
}

/**
 * Fiwind echo ids union internal-transfer ids. One Fiwind statement plus one
 * transfer statement, in parallel. Either failure leaves that half empty, so
 * the rows it could not classify still count.
 */
export async function loadExcludedMovementIds(
  db: FiwindEchoDb & TransferClassDb,
  userId: string,
  ownAccountIdsRaw: string | null | undefined,
): Promise<MovementExclusion> {
  const [echoIds, transfer] = await Promise.all([
    loadFiwindEchoIds(db, userId),
    loadTransferSnapshot(db, userId, ownAccountIdsRaw),
  ]);
  const excluded = new Set<string>(echoIds);
  for (const id of transfer.internalIds) excluded.add(id);
  return {
    excludedIds: [...excluded].sort(),
    internalIds: transfer.internalIds,
    revisarIds: transfer.revisarIds,
    ownIds: transfer.ownIds,
    userHouseholdIds: transfer.userHouseholdIds,
    incomeOutgoing: transfer.incomeOutgoing,
  };
}
