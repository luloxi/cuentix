import { createHash } from "crypto";
import { and, eq } from "drizzle-orm";
import {
  isInternalTransferDescription,
  isNonIncomeTransferLabel,
} from "@/lib/bbva/bank-entries";
import { getDb, schema } from "@/lib/db";
import { ensureCategoriesSeeded, getCategoryMap } from "@/lib/household";
import { resolvePersonalHouseholdId } from "@/lib/personal-household";
import { reclassifyTargetForDescription } from "@/lib/import/fiwind";
import { fingerprintParts } from "@/lib/money";

export type ReclassifyFiwindResult = {
  scanned: number;
  updated: number;
  alreadyOk: number;
  skipped: number;
  /** Rainman: incomes removed (self / FX / DEBIN) */
  incomesRemoved: number;
  /** Rainman: txs marked Transferencia interna */
  internalMarked: number;
  /** Rainman: Consumos txs upserted from purged Variables incomes */
  internalUpserted: number;
};

function n(v: unknown): number {
  if (v == null || v === "") return 0;
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

function foldDesc(s: string): string {
  return s
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

function moneyKey(v: unknown): string {
  const x = n(v);
  return x !== 0 ? Math.abs(x).toFixed(2) : "";
}

/** Incomes → Transferencia interna always land on Personal (not active Casita). */
export function reclassifyIncomeTargetHouseholdId(
  activeHouseholdId: string,
  personalId: string | null | undefined,
): string {
  return personalId || activeHouseholdId;
}

/** Stable fp so re-running reclassify does not duplicate Consumos rows. */
export function internalTransferFingerprint(opts: {
  date: string;
  label: string;
  amountArs: number | null | undefined;
  amountUsd: number | null | undefined;
}): string {
  const base = fingerprintParts([
    "reclass-internal",
    opts.date,
    foldDesc(opts.label),
    moneyKey(opts.amountArs),
    moneyKey(opts.amountUsd),
  ]);
  return createHash("sha256").update(base).digest("hex").slice(0, 32);
}

function amountsMatch(
  aArs: unknown,
  aUsd: unknown,
  bArs: unknown,
  bUsd: unknown,
): boolean {
  const aA = Math.abs(n(aArs));
  const aU = Math.abs(n(aUsd));
  const bA = Math.abs(n(bArs));
  const bU = Math.abs(n(bUsd));
  if (aA > 0 && bA > 0) return Math.abs(aA - bA) < 0.02;
  if (aU > 0 && bU > 0) return Math.abs(aU - bU) < 0.02;
  if (aA > 0 || bA > 0) return Math.abs(aA - bA) < 0.02;
  if (aU > 0 || bU > 0) return Math.abs(aU - bU) < 0.02;
  return false;
}

/**
 * One-shot: existing household rows whose description is Fiwind noise
 * (TRANSFERENCIA ARS, amount-only Tipo, Conversiones, Compra KO, …)
 * get the accounting category. Also Rainman:
 * self-transfer / own FX → Transferencia interna (isPayment, never Ingresos);
 * matching income labels are deleted and upserted as Consumos Transferencia
 * interna so CR TBE / TRF / INM COE stay searchable (not wiped silently).
 * Never deletes transactions.
 */
export async function reclassifyFiwindNoise(
  householdId: string,
  opts?: { userId?: string | null },
): Promise<ReclassifyFiwindResult> {
  const db = (await getDb());
  // Rainman: category must exist before mark/upsert — otherwise Consumos stays empty.
  await ensureCategoriesSeeded();
  let { bySlug, byId } = await getCategoryMap({
    householdId,
    includeHidden: true,
  });

  const rows = await db
    .select({
      id: schema.transactions.id,
      descriptionNormalized: schema.transactions.descriptionNormalized,
      categoryId: schema.transactions.categoryId,
      isPayment: schema.transactions.isPayment,
      isCredit: schema.transactions.isCredit,
      date: schema.transactions.date,
      amountArs: schema.transactions.amountArs,
      amountUsd: schema.transactions.amountUsd,
      externalFingerprint: schema.transactions.externalFingerprint,
    })
    .from(schema.transactions)
    .where(eq(schema.transactions.householdId, householdId));

  let updated = 0;
  let alreadyOk = 0;
  let skipped = 0;
  let internalMarked = 0;

  let internalCat = bySlug.get("transferencia-interna");
  if (!internalCat) {
    // Seed race / old DB: re-seed and refresh map once.
    await ensureCategoriesSeeded();
    ({ bySlug, byId } = await getCategoryMap({
      householdId,
      includeHidden: true,
    }));
    internalCat =
      bySlug.get("transferencia-interna") ?? bySlug.get("conversiones");
  }

  async function markInternal(
    row: (typeof rows)[number],
    targetHouseholdId: string = householdId,
    opts?: { bankLabel?: string | null },
  ): Promise<boolean> {
    const patch: {
      isPayment?: boolean;
      isCredit?: boolean;
      categoryId?: string;
      descriptionNormalized?: string;
      descriptionRaw?: string;
      updatedAt: Date;
    } = { updatedAt: new Date() };
    let needs = false;
    if (!row.isPayment) {
      patch.isPayment = true;
      needs = true;
    }
    if (row.isCredit) {
      patch.isCredit = false;
      needs = true;
    }
    if (internalCat && row.categoryId !== internalCat.id) {
      patch.categoryId = internalCat.id;
      needs = true;
    }
    // Optional polish: mark-only with empty/weak desc → keep CR TBE/TRF/INM COE label
    const bankLabel = (opts?.bankLabel ?? "").replace(/\s+/g, " ").trim();
    const weakDesc = !(row.descriptionNormalized ?? "").replace(/\s+/g, " ").trim();
    if (
      bankLabel &&
      weakDesc &&
      isNonIncomeTransferLabel(bankLabel)
    ) {
      patch.descriptionNormalized = bankLabel;
      patch.descriptionRaw = bankLabel;
      needs = true;
    }
    if (!needs) return false;
    await db
      .update(schema.transactions)
      .set(patch)
      .where(
        and(
          eq(schema.transactions.id, row.id),
          eq(schema.transactions.householdId, targetHouseholdId),
        ),
      );
    if (patch.descriptionNormalized) {
      row.descriptionNormalized = patch.descriptionNormalized;
    }
    return true;
  }

  for (const row of rows) {
    const desc = row.descriptionNormalized;
    if (isInternalTransferDescription(desc)) {
      if (await markInternal(row)) {
        internalMarked += 1;
        updated += 1;
      } else {
        alreadyOk += 1;
      }
      continue;
    }

    const slug = reclassifyTargetForDescription(desc);
    if (!slug) {
      skipped += 1;
      continue;
    }
    const cat = bySlug.get(slug);
    if (!cat) {
      skipped += 1;
      continue;
    }
    const currentSlug = row.categoryId
      ? byId.get(row.categoryId)?.slug
      : null;
    if (currentSlug === slug) {
      alreadyOk += 1;
      continue;
    }
    await db
      .update(schema.transactions)
      .set({ categoryId: cat.id, updatedAt: new Date() })
      .where(
        and(
          eq(schema.transactions.id, row.id),
          eq(schema.transactions.householdId, householdId),
        ),
      );
    updated += 1;
  }

  let incomesRemoved = 0;
  let internalUpserted = 0;
  // Incomes land on Personal via resolvePersonalHouseholdId; active may be Casita.
  const userId = opts?.userId;
  let personalId: string | null = null;
  if (userId) {
    personalId =
      (await resolvePersonalHouseholdId(userId)) ?? householdId;

    // Scan incomes on Personal (and active if different — belt for mis-routed rows).
    const incomeHhIds = [...new Set([personalId, householdId].filter(Boolean))];
    const incomeChunks = await Promise.all(
      incomeHhIds.map((hh) =>
        db
          .select({
            id: schema.incomes.id,
            label: schema.incomes.label,
            date: schema.incomes.date,
            amountArs: schema.incomes.amountArs,
            amountUsd: schema.incomes.amountUsd,
            externalFingerprint: schema.incomes.externalFingerprint,
            householdId: schema.incomes.householdId,
          })
          .from(schema.incomes)
          .where(
            and(
              eq(schema.incomes.householdId, hh),
              eq(schema.incomes.userId, userId),
            ),
          ),
      ),
    );
    const incomes = incomeChunks.flat();

    // Match / upsert Consumos rows on Personal only (never Casita + personal ownership).
    const txRows = await db
      .select({
        id: schema.transactions.id,
        descriptionNormalized: schema.transactions.descriptionNormalized,
        categoryId: schema.transactions.categoryId,
        isPayment: schema.transactions.isPayment,
        isCredit: schema.transactions.isCredit,
        date: schema.transactions.date,
        amountArs: schema.transactions.amountArs,
        amountUsd: schema.transactions.amountUsd,
        externalFingerprint: schema.transactions.externalFingerprint,
      })
      .from(schema.transactions)
      .where(eq(schema.transactions.householdId, personalId));

    const byFp = new Map(txRows.map((t) => [t.externalFingerprint, t]));

    for (const inc of incomes) {
      if (!isNonIncomeTransferLabel(inc.label)) continue;

      const labelNorm = foldDesc(inc.label);
      const fp = internalTransferFingerprint({
        date: inc.date,
        label: inc.label,
        amountArs: inc.amountArs != null ? n(inc.amountArs) : null,
        amountUsd: inc.amountUsd != null ? n(inc.amountUsd) : null,
      });

      let matched =
        byFp.get(fp) ??
        txRows.find(
          (t) =>
            t.date === inc.date &&
            foldDesc(t.descriptionNormalized) === labelNorm &&
            amountsMatch(t.amountArs, t.amountUsd, inc.amountArs, inc.amountUsd),
        );

      if (matched) {
        if (await markInternal(matched, personalId, { bankLabel: inc.label })) {
          internalMarked += 1;
          updated += 1;
        }
      } else {
        const ars = n(inc.amountArs);
        const usd = n(inc.amountUsd);
        try {
          const [created] = await db
            .insert(schema.transactions)
            .values({
              householdId: personalId,
              date: inc.date,
              descriptionRaw: inc.label,
              descriptionNormalized: inc.label.replace(/\s+/g, " ").trim(),
              amountArs: ars !== 0 ? Math.abs(ars).toFixed(2) : null,
              amountUsd: usd !== 0 ? Math.abs(usd).toFixed(2) : null,
              isPayment: true,
              isCredit: false,
              categoryId: internalCat?.id ?? null,
              ownership: "personal",
              paidByUserId: userId,
              externalFingerprint: fp,
              source: "reclassify_internal",
              bank: "BBVA",
            })
            .returning({
              id: schema.transactions.id,
              descriptionNormalized: schema.transactions.descriptionNormalized,
              categoryId: schema.transactions.categoryId,
              isPayment: schema.transactions.isPayment,
              isCredit: schema.transactions.isCredit,
              date: schema.transactions.date,
              amountArs: schema.transactions.amountArs,
              amountUsd: schema.transactions.amountUsd,
              externalFingerprint: schema.transactions.externalFingerprint,
            });
          if (created) {
            txRows.push(created);
            byFp.set(fp, created);
            internalUpserted += 1;
            internalMarked += 1;
            updated += 1;
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (!/unique|duplicate/i.test(msg)) throw e;
          // Race / prior insert: mark existing fp row if present.
          const existing = byFp.get(fp);
          if (existing && (await markInternal(existing, personalId))) {
            internalMarked += 1;
            updated += 1;
          }
        }
      }

      await db.delete(schema.incomes).where(eq(schema.incomes.id, inc.id));
      incomesRemoved += 1;
    }
  }

  // Rainman backfill when incomes already gone: re-scan txs and ensure
  // Transferencia interna category + isPayment so Consumos search finds $300k.
  // Run on BOTH active household and Personal (CR TBE may live on either).
  if (internalCat) {
    const backfillIds = [...new Set(
      [householdId, personalId].filter((x): x is string => Boolean(x)),
    )];
    for (const hhId of backfillIds) {
      const fresh = await db
        .select({
          id: schema.transactions.id,
          descriptionNormalized: schema.transactions.descriptionNormalized,
          categoryId: schema.transactions.categoryId,
          isPayment: schema.transactions.isPayment,
          isCredit: schema.transactions.isCredit,
          date: schema.transactions.date,
          amountArs: schema.transactions.amountArs,
          amountUsd: schema.transactions.amountUsd,
          externalFingerprint: schema.transactions.externalFingerprint,
        })
        .from(schema.transactions)
        .where(eq(schema.transactions.householdId, hhId));

      for (const row of fresh) {
        if (!isInternalTransferDescription(row.descriptionNormalized)) continue;
        const needsCat = row.categoryId !== internalCat.id;
        const needsPay = !row.isPayment;
        const needsCredit = Boolean(row.isCredit);
        const needsFp = !row.externalFingerprint;
        if (!needsCat && !needsPay && !needsCredit && !needsFp) continue;
        const fp = internalTransferFingerprint({
          date: row.date,
          label: row.descriptionNormalized,
          amountArs: row.amountArs != null ? n(row.amountArs) : null,
          amountUsd: row.amountUsd != null ? n(row.amountUsd) : null,
        });
        await db
          .update(schema.transactions)
          .set({
            isPayment: true,
            isCredit: false,
            categoryId: internalCat.id,
            ...(needsFp ? { externalFingerprint: fp } : {}),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.transactions.id, row.id),
              eq(schema.transactions.householdId, hhId),
            ),
          );
        internalMarked += 1;
        updated += 1;
      }
    }
  }

  if (incomesRemoved > 0 || internalUpserted > 0) {
    console.info("[reclassifyFiwindNoise]", {
      householdId,
      personalId,
      incomesRemoved,
      internalUpserted,
      internalMarked,
    });
  }

    return {
    scanned: rows.length,
    updated,
    alreadyOk,
    skipped,
    incomesRemoved,
    internalMarked,
    internalUpserted,
  };
}
