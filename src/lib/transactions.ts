import { and, desc, eq } from "drizzle-orm";
import {
  isBankAccountingEntry,
  isInternalTransferDescription,
} from "@/lib/bbva/bank-entries";
import { queryMatchesBbvaInternalTransferTokens } from "@/lib/bbva/search-tokens";
import { isPeriodDebtSource } from "@/lib/import/source";
import { getDb, schema } from "@/lib/db";
import { getCategoryMap } from "@/lib/household";
import { periodFromDateString } from "@/lib/utils";
import { isConsumosHiddenPayment } from "@/lib/reintegro-hogar";
import { resolveAmountUpdates } from "@/lib/transaction-amounts";

/**
 * Visibility:
 * - shared → visible to every household member
 * - personal → only the member who paid / owns it (paidByUserId)
 */
export function isVisibleToUser(
  tx: { ownership: string; paidByUserId: string | null },
  userId: string,
): boolean {
  if (tx.ownership === "shared") return true;
  return tx.paidByUserId === userId;
}


/** Strip separators so "300.000,00" / "300000" / "$ 300.000" share a digit needle. */
export function digitsOnly(s: string): string {
  return s.replace(/\D/g, "");
}

/**
 * Haystacks for amount search: absolute value as plain digits, integer digits,
 * and ARS-formatted digits (dots/commas stripped via digitsOnly at match time).
 */
export function amountSearchDigitStrings(
  amount: number | string | null | undefined,
): string[] {
  if (amount == null || amount === "") return [];
  const n = Math.abs(typeof amount === "number" ? amount : Number(amount));
  if (!Number.isFinite(n) || n === 0) return [];
  const fixed = n.toFixed(2); // "300000.00"
  const intPart = Math.trunc(n).toString(); // "300000"
  // es-AR: 300.000,00 — digitsOnly yields 30000000 (with cents) or we also keep int
  const ars = new Intl.NumberFormat("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
  const out = new Set<string>();
  for (const h of [fixed, intPart, ars, String(n)]) {
    const d = digitsOnly(h);
    if (d) out.add(d);
  }
  // Also bare integer without cents padding for partial "300000" vs "30000000"
  out.add(intPart);
  return [...out];
}

export { queryMatchesBbvaInternalTransferTokens } from "@/lib/bbva/search-tokens";

/**
 * Consumos `q` match: description substring OR amount digits (partial).
 * Monk types `300000` while desc is `CR TBE INM COE` — amount must hit.
 * Also: q with BBVA ticket tokens matches transferencia-interna / internal-desc
 * even when descriptionNormalized lacks the letters CR TBE.
 */
export function transactionMatchesQuery(
  row: {
    descriptionNormalized: string;
    amountArs?: number | string | null;
    amountUsd?: number | string | null;
    /** Category slug when available (listTransactions has byId). */
    categorySlug?: string | null;
  },
  q: string,
): boolean {
  const needle = q.trim();
  if (!needle) return true;
  const upper = needle.toUpperCase();
  if (row.descriptionNormalized.toUpperCase().includes(upper)) return true;

  if (queryMatchesBbvaInternalTransferTokens(needle)) {
    const slug = (row.categorySlug ?? "").trim().toLowerCase();
    if (slug === "transferencia-interna") return true;
    if (isInternalTransferDescription(row.descriptionNormalized)) return true;
  }

  const qDigits = digitsOnly(needle);
  if (qDigits.length === 0) return false;

  for (const hay of [
    ...amountSearchDigitStrings(row.amountArs),
    ...amountSearchDigitStrings(row.amountUsd),
  ]) {
    if (hay.includes(qDigits)) return true;
  }
  return false;
}

/**
 * List household transactions for Consumos / analysis APIs.
 * Kept free of PDF/xlsx import deps so /api/transactions can load on serverless.
 */

/**
 * Consumos search: non-empty `q` spans all months.
 * Period filter would hide cross-month CR TBE / Transferencia interna.
 */
export function periodFilterAppliesForSearch(opts?: {
  period?: string;
  q?: string;
}): boolean {
  if (!opts?.period) return false;
  if (opts.q != null && String(opts.q).trim() !== "") return false;
  return true;
}

export async function listTransactions(
  householdId: string,
  opts?: {
    period?: string;
    categoryId?: string;
    q?: string;
    /** Only rows with no category or Uncategorized */
    uncategorizedOnly?: boolean;
    /** Include card payments / credits (default false — Consumos shows expenses only) */
    includePayments?: boolean;
    /**
     * When set, apply privacy: personal only if paidByUserId matches,
     * shared always visible. Required for multi-member households.
     */
    viewerUserId?: string;
    /** Only shared (Hogar). Ignores personal even of the viewer. */
    sharedOnly?: boolean;
  },
) {
  const db = (await getDb());
  const { byId, bySlug } = await getCategoryMap();
  const uncatId = bySlug.get("uncategorized")?.id ?? null;

  const rows = await db
    .select()
    .from(schema.transactions)
    .where(eq(schema.transactions.householdId, householdId))
    .orderBy(desc(schema.transactions.date));

  return rows.filter((r) => {
    if (
      !opts?.includePayments &&
      isConsumosHiddenPayment(
        r.isPayment,
        r.descriptionNormalized,
        r.categoryId ? byId.get(r.categoryId)?.slug : null,
      )
    ) {
      return false;
    }
    if (!opts?.includePayments && r.isCredit) {
      const slug = r.categoryId ? byId.get(r.categoryId)?.slug : null;
      if (
        slug !== "transferencia-interna" &&
        !isInternalTransferDescription(r.descriptionNormalized)
      ) {
        return false;
      }
    }
    if (
      !opts?.includePayments &&
      isBankAccountingEntry(r.descriptionNormalized)
    ) {
      // Rainman: Transferencia interna stays listed (out of neta) —
      // by slug OR description when category was never seeded.
      const slug = r.categoryId ? byId.get(r.categoryId)?.slug : null;
      if (
        slug !== "transferencia-interna" &&
        !isInternalTransferDescription(r.descriptionNormalized)
      ) {
        return false;
      }
    }
    if (!opts?.includePayments && isPeriodDebtSource(r.source)) {
      return false;
    }

    if (opts?.sharedOnly) {
      if (r.ownership !== "shared") return false;
    } else if (opts?.viewerUserId) {
      if (!isVisibleToUser(r, opts.viewerUserId)) return false;
    }

    // When q is set, do not apply period — search finds cross-month rows.
    if (periodFilterAppliesForSearch({ period: opts?.period, q: opts?.q })) {
      if (periodFromDateString(r.date) !== opts!.period) return false;
    }
    if (opts?.categoryId && r.categoryId !== opts.categoryId) return false;
    if (opts?.uncategorizedOnly) {
      const slug = r.categoryId ? byId.get(r.categoryId)?.slug : null;
      const bare =
        !r.categoryId || r.categoryId === uncatId || slug === "uncategorized";
      if (!bare) return false;
    }
    if (opts?.q) {
      const slug = r.categoryId ? byId.get(r.categoryId)?.slug : null;
      if (
        !transactionMatchesQuery(
          { ...r, categorySlug: slug },
          opts.q,
        )
      ) {
        return false;
      }
    }
    return true;
  });
}


export async function updateTransaction(
  householdId: string,
  id: string,
  patch: {
    categoryId?: string | null;
    ownership?: "personal" | "shared";
    paidByUserId?: string | null;
    splitPct?: number;
    bank?: string | null;
    date?: string;
    amountArs?: number | null;
    amountUsd?: number | null;
    /** Internal transfer / non-spend — out of neta; visible if Transferencia interna. */
    isPayment?: boolean;
    /** Credits that become Transferencia interna must clear isCredit so lists show them. */
    isCredit?: boolean;
  },
) {
  const db = (await getDb());

  if (patch.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(patch.date)) {
    throw new Error("Fecha inválida (YYYY-MM-DD)");
  }

  const { amountArs, amountUsd, ...rest } = patch;
  const set: {
    categoryId?: string | null;
    ownership?: "personal" | "shared";
    paidByUserId?: string | null;
    splitPct?: number;
    bank?: string | null;
    date?: string;
    amountArs?: string | null;
    amountUsd?: string | null;
    isPayment?: boolean;
    isCredit?: boolean;
    updatedAt: Date;
  } = { ...rest, updatedAt: new Date() };

  // undefined = leave unchanged. null = explicit clear.
  // Important: `"amountArs" in { amountArs: undefined }` is true — Cubierto /
  // Reintegro PATCH used to pass undefined amounts and wipe montos to null,
  // so Resumen Cubiertos summed $0 while neta still dropped (isPayment).
  const amountUpdates = resolveAmountUpdates({ amountArs, amountUsd });
  if ("amountArs" in amountUpdates) set.amountArs = amountUpdates.amountArs;
  if ("amountUsd" in amountUpdates) set.amountUsd = amountUpdates.amountUsd;

  // Drop undefined keys so drizzle does not write NULLs for omitted fields.
  for (const key of Object.keys(set) as Array<keyof typeof set>) {
    if (set[key] === undefined) delete set[key];
  }

  const [row] = await db
    .update(schema.transactions)
    .set(set)
    .where(
      and(
        eq(schema.transactions.id, id),
        eq(schema.transactions.householdId, householdId),
      ),
    )
    .returning();
  return row;
}

/**
 * Move a gasto to another household the user belongs to.
 * Receipts follow; household-scoped categories fall back to uncategorized.
 * Assigning to a household ⇒ ownership shared; Personal stays in-place via PATCH ownership.
 */
export async function moveTransactionToHousehold(opts: {
  fromHouseholdId: string;
  toHouseholdId: string;
  txId: string;
  userId: string;
  /** Default shared (assign to hogar). Personal bank space uses "personal". */
  ownership?: "personal" | "shared";
}) {
  const {
    fromHouseholdId,
    toHouseholdId,
    txId,
    userId,
    ownership = "shared",
  } = opts;
  if (fromHouseholdId === toHouseholdId) {
    throw new Error("Ya está en ese hogar");
  }
  const db = (await getDb());

  const [before] = await db
    .select()
    .from(schema.transactions)
    .where(
      and(
        eq(schema.transactions.id, txId),
        eq(schema.transactions.householdId, fromHouseholdId),
      ),
    )
    .limit(1);
  if (!before) throw new Error("No encontrado");
  if (!isVisibleToUser(before, userId)) throw new Error("Sin permiso");
  if (
    before.ownership === "personal" &&
    before.paidByUserId !== userId
  ) {
    throw new Error("Sin permiso");
  }

  const { byId, bySlug } = await getCategoryMap({
    householdId: toHouseholdId,
    includeHidden: true,
  });
  let nextCategoryId = before.categoryId;
  if (nextCategoryId) {
    const cat = byId.get(nextCategoryId);
    // Drop categories that belong to another household (not system / not target).
    if (!cat) {
      nextCategoryId = bySlug.get("uncategorized")?.id ?? null;
    }
  }

  let fingerprint = before.externalFingerprint;
  const clash = await db
    .select({ id: schema.transactions.id })
    .from(schema.transactions)
    .where(
      and(
        eq(schema.transactions.householdId, toHouseholdId),
        eq(schema.transactions.externalFingerprint, fingerprint),
      ),
    )
    .limit(1);
  if (clash.length) {
    fingerprint = `${fingerprint}:moved:${Date.now().toString(36)}`.slice(0, 64);
  }

  const [row] = await db
    .update(schema.transactions)
    .set({
      householdId: toHouseholdId,
      ownership,
      categoryId: nextCategoryId,
      externalFingerprint: fingerprint,
      paidByUserId: before.paidByUserId ?? userId,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.transactions.id, txId),
        eq(schema.transactions.householdId, fromHouseholdId),
      ),
    )
    .returning();

  if (!row) throw new Error("No se pudo mover");

  await db
    .update(schema.receipts)
    .set({ householdId: toHouseholdId })
    .where(eq(schema.receipts.transactionId, txId));

  return row;
}
