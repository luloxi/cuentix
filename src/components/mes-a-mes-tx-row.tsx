"use client";

import { cn, formatArs, formatUsd, formatDateAr } from "@/lib/utils";
import { isReintegroHogarTipo } from "@/lib/reintegro-hogar";
import { isGastoCubiertoTipo } from "@/lib/gasto-cubierto";
import { isTransferenciaInternaTipo } from "@/lib/bbva/bank-entries";
import { BusinessSyncToggle, type SyncStatus } from "@/components/business-sync-toggle";

type CategoryOpt = { id: string; slug: string; name: string };

export type MesAMesTx = {
  id: string;
  date: string;
  descriptionNormalized: string;
  amountArs: number | null;
  amountUsd: number | null;
  isPayment?: boolean;
  /** Server flag: outbound-prefix payee OR bare payee. Missing on old responses. */
  reintegroHogar?: boolean;
  /** Server flag: outbound-prefix payee only. Missing on old responses. */
  reintegroPayee?: boolean;
  ownership: "personal" | "shared";
  category: CategoryOpt | null;
  isBusiness?: boolean;
  syncStatus?: SyncStatus | null;
};

type HouseholdOption = { id: string; name: string };

/**
 * Expense row for Resumen: name always visible + currency impossible to confuse.
 * Assign mirrors Consumos Lista (Personal + per-hogar / Reintegro / Transferencia).
 */
export function MesAMesTxRow({
  t,
  categories,
  households,
  activeHouseholdId,
  savingId,
  onChangeCategory,
  onAssignChange,
  onToggleBusiness,
}: {
  t: MesAMesTx;
  categories: CategoryOpt[];
  households: HouseholdOption[];
  activeHouseholdId: string | null;
  savingId: string | null;
  onChangeCategory: (txId: string, categoryId: string) => void;
  onAssignChange: (tx: MesAMesTx, value: string) => void;
  onToggleBusiness?: (tx: MesAMesTx) => void;
}) {
  const hasArs =
    t.amountArs != null &&
    Number.isFinite(t.amountArs) &&
    Math.abs(t.amountArs) > 0;
  const hasUsd =
    t.amountUsd != null &&
    Number.isFinite(t.amountUsd) &&
    Math.abs(t.amountUsd) > 0;

  const opts =
    households.length > 0
      ? households
      : activeHouseholdId
        ? [{ id: activeHouseholdId, name: "Hogar" }]
        : [];
  const assignValue = isReintegroHogarTipo(
    Boolean(t.isPayment),
    Boolean(t.reintegroHogar),
  )
    ? "reintegro"
    : isTransferenciaInternaTipo(Boolean(t.isPayment), t.category, t.descriptionNormalized)
      ? "internal"
      : isGastoCubiertoTipo(Boolean(t.isPayment), t.category)
        ? "cubierto"
        : t.ownership === "personal"
          ? "personal"
          : activeHouseholdId ?? "shared";

  return (
    <li className="rounded-xl border border-zinc-100/80 bg-white px-3 py-2.5 text-sm shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs tabular-nums text-zinc-500">
            {formatDateAr(t.date)}
          </p>
          <p className="mt-0.5 break-words font-medium leading-snug text-zinc-900 dark:text-zinc-50">
            {t.descriptionNormalized || "Sin descripción"}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {hasArs && (
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-100 px-2 py-1 dark:bg-zinc-800">
              <span className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">
                Pesos
              </span>
              <span className="text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
                {formatArs(Math.abs(t.amountArs!))}
              </span>
            </span>
          )}
          {hasUsd && (
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-sky-100 px-2 py-1 dark:bg-sky-950">
              <span className="text-[10px] font-bold uppercase tracking-wide text-sky-700 dark:text-sky-300">
                Dólares
              </span>
              <span className="text-sm font-semibold tabular-nums text-sky-900 dark:text-sky-100">
                {formatUsd(Math.abs(t.amountUsd!))}
              </span>
            </span>
          )}
          {!hasArs && !hasUsd && (
            <span className="text-zinc-400">—</span>
          )}
        </div>
      </div>
      <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
        <select
          value={t.category?.id ?? ""}
          disabled={savingId === t.id}
          onChange={(e) => onChangeCategory(t.id, e.target.value)}
          onClick={(e) => e.stopPropagation()}
          className="lc-input w-full !px-2 !py-1.5 text-xs"
          aria-label="Categoría"
        >
          <option value="">Sin categoría</option>
          {categories.map((cat) => (
            <option key={cat.id} value={cat.id}>
              {cat.name}
            </option>
          ))}
        </select>
        <select
          value={
            assignValue === "shared" && activeHouseholdId
              ? activeHouseholdId
              : assignValue
          }
          disabled={savingId === t.id}
          onChange={(e) => onAssignChange(t, e.target.value)}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "lc-input w-full !px-2 !py-1.5 text-xs font-medium",
            assignValue === "reintegro"
              ? "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
              : assignValue === "cubierto"
                ? "border-emerald-300 bg-emerald-50 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100"
                : t.ownership === "shared"
                  ? "border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-100"
                  : "",
          )}
          aria-label="Asignar a"
        >
          <option value="personal">Personal</option>
          {opts.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name}
            </option>
          ))}
          {opts.length === 0 && <option value="shared">Hogar</option>}
          <option value="cubierto">Cubierto</option>
          <option value="reintegro">Reintegro hogar</option>
          <option value="internal">Transferencia interna</option>
        </select>
      </div>
      {onToggleBusiness ? (
        <div className="mt-2">
          <BusinessSyncToggle
            isBusiness={Boolean(t.isBusiness)}
            syncStatus={t.syncStatus ?? null}
            canMark={t.ownership === "personal" && !t.isPayment}
            disabled={savingId === t.id}
            onToggle={() => onToggleBusiness(t)}
          />
        </div>
      ) : null}
    </li>
  );
}
