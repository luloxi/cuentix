"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, Wallet, X } from "lucide-react";
import { EmptyState, ListSkeleton } from "@/components/ui";
import { formatPeriodLabel } from "@/lib/period-label";
import { cn, currentPeriodAr, formatArs, formatDateAr, formatUsd } from "@/lib/utils";

type Category = { id: string; slug: string; name: string };

type Movement = {
  id: string;
  date: string;
  description: string;
  amountArs: number | null;
  amountUsd: number | null;
  isBusiness: boolean;
  category: Category | null;
};

type Similar = {
  key: string;
  variants: string[];
  count: number;
  capped: boolean;
  skippedBusiness: number;
};

type MovementsPayload = {
  movements?: Movement[];
  categories?: Category[];
  limit?: number;
  error?: string;
};

const PAGE = 50;

function shiftPeriod(period: string, delta: number): string {
  const [year, month] = period.split("-").map(Number);
  const date = new Date(Date.UTC(year || 2026, (month || 1) - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function amountLabel(row: Movement): string {
  const parts: string[] = [];
  if (row.amountArs != null && row.amountArs !== 0) parts.push(formatArs(row.amountArs));
  if (row.amountUsd != null && row.amountUsd !== 0) parts.push(formatUsd(row.amountUsd));
  if (parts.length > 0) return parts.join(" · ");
  if (row.amountArs != null) return formatArs(row.amountArs);
  if (row.amountUsd != null) return formatUsd(row.amountUsd);
  return "—";
}

function variantPreview(variants: string[]): string {
  const shown = variants.slice(0, 3);
  if (shown.length === 0) return "";
  return `${shown.join(", ")}${variants.length > shown.length ? "…" : ""}`;
}

function similarLabel(similar: Similar): string {
  const noun = similar.count === 1 && !similar.capped ? "similar" : "similares";
  const amount = similar.capped
    ? `${similar.count} ${noun} o más`
    : `${similar.count} ${noun}`;
  const preview = variantPreview(similar.variants);
  return preview ? `Aplicar a ${amount} (${preview})` : `Aplicar a ${amount}`;
}

export function FiwindReclassifyPanel({
  onToast,
}: {
  onToast: (message: string) => void;
}) {
  const [period, setPeriod] = useState(currentPeriodAr);
  const [tick, setTick] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [selected, setSelected] = useState<Movement | null>(null);
  const periodRef = useRef(period);

  useEffect(() => {
    const ac = new AbortController();
    const nextPeriod = period;
    periodRef.current = nextPeriod;
    void (async () => {
      try {
        const params = new URLSearchParams({
          period: nextPeriod,
          limit: String(PAGE),
          offset: "0",
        });
        const res = await fetch(`/api/fiwind/movements?${params}`, {
          credentials: "include",
          signal: ac.signal,
        });
        const data = (await res.json().catch(() => null)) as MovementsPayload | null;
        if (ac.signal.aborted || periodRef.current !== nextPeriod) return;
        if (!res.ok) throw new Error(data?.error || "No se pudieron cargar los movimientos");
        const rows = data?.movements ?? [];
        setCategories(data?.categories ?? []);
        setMovements(rows);
        setOffset(0);
        setHasMore(rows.length >= (data?.limit ?? PAGE));
        setError(null);
      } catch (err) {
        if (ac.signal.aborted || (err instanceof Error && err.name === "AbortError")) return;
        if (periodRef.current !== nextPeriod) return;
        setMovements([]);
        setError(err instanceof Error ? err.message : "Error de red");
      } finally {
        if (!ac.signal.aborted && periodRef.current === nextPeriod) setLoading(false);
      }
    })();
    return () => ac.abort();
  }, [period, tick]);

  function changePeriod(next: string) {
    if (!/^\d{4}-\d{2}$/.test(next) || next === period) return;
    periodRef.current = next;
    setSelected(null);
    setLoading(true);
    setError(null);
    setMovements([]);
    setPeriod(next);
  }

  async function loadMore() {
    const nextPeriod = period;
    const nextOffset = offset + PAGE;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams({
        period: nextPeriod,
        limit: String(PAGE),
        offset: String(nextOffset),
      });
      const res = await fetch(`/api/fiwind/movements?${params}`, { credentials: "include" });
      const data = (await res.json().catch(() => null)) as MovementsPayload | null;
      if (periodRef.current !== nextPeriod) return;
      if (!res.ok) throw new Error(data?.error || "No se pudieron cargar los movimientos");
      const rows = data?.movements ?? [];
      setMovements((prev) => [...prev, ...rows]);
      setOffset(nextOffset);
      setHasMore(rows.length >= (data?.limit ?? PAGE));
    } catch (err) {
      if (periodRef.current !== nextPeriod) return;
      setError(err instanceof Error ? err.message : "Error de red");
    } finally {
      if (periodRef.current === nextPeriod) setLoadingMore(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="lc-btn lc-btn-secondary min-h-11 min-w-11 cursor-pointer px-0 disabled:cursor-not-allowed"
          aria-label="Mes anterior"
          onClick={() => changePeriod(shiftPeriod(period, -1))}
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </button>
        <label className="min-w-0 flex-1">
          <span className="sr-only">Mes</span>
          <input
            type="month"
            value={period}
            aria-label={`Mes: ${formatPeriodLabel(period)}`}
            onChange={(event) => changePeriod(event.target.value)}
            className="lc-input min-h-11 w-full cursor-pointer"
          />
        </label>
        <button
          type="button"
          className="lc-btn lc-btn-secondary min-h-11 min-w-11 cursor-pointer px-0 disabled:cursor-not-allowed"
          aria-label="Mes siguiente"
          onClick={() => changePeriod(shiftPeriod(period, 1))}
        >
          <ChevronRight className="h-5 w-5" aria-hidden />
        </button>
      </div>

      <p className="text-sm text-[var(--muted-fg)]">
        Elegí un movimiento de Fiwind y cambiale la categoría. Si hay otros del mismo comercio, el número aparece antes de confirmar.
      </p>

      {loading && !loadingMore ? (
        <ListSkeleton label="Cargando movimientos de Fiwind…" rows={5} />
      ) : error && movements.length === 0 ? (
        <div className="lc-card space-y-3 p-4" role="alert">
          <p className="text-sm text-[var(--foreground)]">{error}</p>
          <button
            type="button"
            className="lc-btn lc-btn-secondary min-h-11 cursor-pointer disabled:cursor-not-allowed"
            onClick={() => {
              setLoading(true);
              setError(null);
              setTick((n) => n + 1);
            }}
          >
            Reintentar
          </button>
        </div>
      ) : movements.length === 0 ? (
        <EmptyState
          icon={<Wallet className="h-6 w-6" aria-hidden />}
          title="Sin movimientos"
          description={`No hay movimientos de Fiwind en ${formatPeriodLabel(period)}.`}
        />
      ) : (
        <div className="space-y-2">
          {error && (
            <p className="text-sm text-[var(--foreground)]" role="alert">
              {error}
            </p>
          )}
          <ul className="space-y-2">
            {movements.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => setSelected(row)}
                  className="flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-3 text-left transition hover:bg-[var(--surface-muted)]"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-medium text-[var(--foreground)]">
                      {row.description}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-1.5">
                      <span className="text-xs text-[var(--muted-fg)]">{formatDateAr(row.date)}</span>
                      <span className="inline-flex max-w-full truncate rounded-full border border-[var(--border)] bg-[var(--surface-muted)] px-2 py-0.5 text-[11px] font-medium text-[var(--muted-fg)]">
                        {row.category?.name ?? "Sin categoría"}
                      </span>
                    </span>
                  </span>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-[var(--foreground)]">
                    {amountLabel(row)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {hasMore && (
            <button
              type="button"
              className="lc-btn lc-btn-secondary min-h-11 w-full cursor-pointer disabled:cursor-not-allowed"
              disabled={loadingMore}
              onClick={() => void loadMore()}
            >
              {loadingMore ? "Cargando…" : "Cargar más"}
            </button>
          )}
        </div>
      )}

      {selected && (
        <ReclassifySheet
          movement={selected}
          categories={categories}
          onClose={() => setSelected(null)}
          onDone={(message) => {
            setSelected(null);
            onToast(message);
            setLoading(true);
            setTick((n) => n + 1);
          }}
        />
      )}
    </div>
  );
}

function ReclassifySheet({
  movement,
  categories,
  onClose,
  onDone,
}: {
  movement: Movement;
  categories: Category[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const titleId = useId();
  const selectRef = useRef<HTMLSelectElement>(null);
  const currentId = movement.category?.id ?? "";
  const [categoryId, setCategoryId] = useState(currentId);
  const [similar, setSimilar] = useState<Similar | null>(null);
  const [similarError, setSimilarError] = useState<string | null>(null);
  const [similarLoading, setSimilarLoading] = useState(!movement.isBusiness);
  const [applySimilar, setApplySimilar] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);

  useEffect(() => {
    selectRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !saving) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  useEffect(() => {
    if (movement.isBusiness) return;
    const ac = new AbortController();
    void (async () => {
      try {
        const res = await fetch(`/api/fiwind/similar?id=${encodeURIComponent(movement.id)}`, {
          credentials: "include",
          signal: ac.signal,
        });
        const data = (await res.json().catch(() => null)) as (Partial<Similar> & { error?: string }) | null;
        if (ac.signal.aborted) return;
        if (!res.ok) throw new Error(data?.error || "No se pudieron contar los similares");
        setSimilar({
          key: data?.key ?? "",
          variants: data?.variants ?? [],
          count: data?.count ?? 0,
          capped: Boolean(data?.capped),
          skippedBusiness: data?.skippedBusiness ?? 0,
        });
      } catch (err) {
        if (ac.signal.aborted) return;
        setSimilarError(err instanceof Error ? err.message : "Error de red");
      } finally {
        if (!ac.signal.aborted) setSimilarLoading(false);
      }
    })();
    return () => ac.abort();
  }, [movement.id, movement.isBusiness]);

  const showToggle = !movement.isBusiness && similar != null && similar.count > 0;
  const sameCategory = categoryId !== "" && categoryId === currentId;
  const confirmDisabled =
    saving ||
    movement.isBusiness ||
    categoryId === "" ||
    similarLoading ||
    (sameCategory && !applySimilar);

  async function confirm() {
    if (confirmDisabled) return;
    setSaving(true);
    setSheetError(null);
    const applying = applySimilar && showToggle;
    try {
      const res = await fetch("/api/fiwind/reclassify", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: movement.id,
          categoryId,
          applyToSimilar: applying,
          ...(applying ? { expectedCount: similar?.count ?? 0 } : {}),
        }),
      });
      const data = (await res.json().catch(() => null)) as {
        error?: string;
        code?: string;
        count?: number;
        capped?: boolean;
        skippedBusiness?: number;
        similarUpdated?: number;
      } | null;
      if (res.status === 409 && data?.code !== "business" && typeof data?.count === "number") {
        setSimilar((prev) =>
          prev
            ? {
                ...prev,
                count: data.count ?? prev.count,
                capped: Boolean(data.capped),
                skippedBusiness: data.skippedBusiness ?? prev.skippedBusiness,
              }
            : prev,
        );
        setApplySimilar(true);
        setSheetError(data.error || "La cantidad de similares cambió. Confirmá de nuevo.");
        return;
      }
      if (!res.ok) throw new Error(data?.error || "No se pudo reclasificar");
      const n = data?.similarUpdated ?? 0;
      onDone(n > 0 ? `Reclasificado (+${n} similares)` : "Reclasificado");
    } catch (err) {
      setSheetError(err instanceof Error ? err.message : "Error de red");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <button
        type="button"
        className="absolute inset-0 cursor-pointer bg-[#121110]/60 disabled:cursor-not-allowed"
        aria-label="Cerrar"
        disabled={saving}
        onClick={() => {
          if (!saving) onClose();
        }}
      />
      <div className="relative z-10 flex max-h-[min(92dvh,640px)] w-full max-w-md flex-col overflow-hidden rounded-t-3xl border border-[var(--border)] bg-[var(--surface)] shadow-[0_24px_64px_-20px_rgba(0,0,0,0.45)] sm:rounded-3xl">
        <div className="flex justify-center pt-2 sm:hidden" aria-hidden>
          <span className="h-1 w-10 rounded-full bg-[var(--border-strong)]" />
        </div>
        <div className="flex items-center justify-between gap-3 px-5 pb-2 pt-3 sm:pt-5">
          <h2 id={titleId} className="text-base font-semibold tracking-tight text-[var(--foreground)]">
            Reclasificar
          </h2>
          <button
            type="button"
            className="inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-full text-[var(--muted-fg)] hover:bg-[var(--surface-muted)] disabled:cursor-not-allowed"
            aria-label="Cerrar"
            disabled={saving}
            onClick={onClose}
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
        <form
          className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-5"
          onSubmit={(event) => {
            event.preventDefault();
            void confirm();
          }}
        >
          <div>
            <p className="text-[15px] font-medium text-[var(--foreground)]">{movement.description}</p>
            <p className="mt-1 text-sm text-[var(--muted-fg)]">
              {formatDateAr(movement.date)} · {amountLabel(movement)}
            </p>
          </div>

          {movement.isBusiness ? (
            <p className="text-sm text-[var(--muted-fg)]" role="status">
              Este movimiento es de negocio. Cambiá la categoría desde el gasto para avisar a Serpix.
            </p>
          ) : (
            <>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-[var(--muted-fg)]">Categoría</span>
                <select
                  ref={selectRef}
                  value={categoryId}
                  disabled={saving}
                  onChange={(event) => setCategoryId(event.target.value)}
                  className="lc-input min-h-11 w-full cursor-pointer disabled:cursor-not-allowed"
                >
                  <option value="">Elegí una categoría</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </label>

              <div aria-live="polite">
                {similarLoading && (
                  <p className="flex items-center gap-2 text-sm text-[var(--muted-fg)]">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    Buscando similares…
                  </p>
                )}
                {similarError && (
                  <p className="text-sm text-[var(--muted-fg)]" role="status">
                    No pude contar similares. Se va a cambiar solo este movimiento.
                  </p>
                )}
                {showToggle && similar && (
                  <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-3">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-5 w-5 cursor-pointer accent-[var(--brand)] disabled:cursor-not-allowed"
                      checked={applySimilar}
                      disabled={saving}
                      onChange={(event) => setApplySimilar(event.target.checked)}
                    />
                    <span className="text-sm font-medium leading-snug text-[var(--foreground)]">
                      {similarLabel(similar)}
                    </span>
                  </label>
                )}
                {similar != null && similar.skippedBusiness > 0 && (
                  <p className="mt-2 text-xs text-[var(--muted-fg)]">
                    {similar.skippedBusiness > 500
                      ? "Hay más de 500 movimientos de negocio que no se tocan. Cambialos desde el gasto."
                      : `Hay ${similar.skippedBusiness} de negocio que no se tocan. Cambialos desde el gasto.`}
                  </p>
                )}
              </div>
            </>
          )}

          {sheetError && (
            <p className="text-sm text-[var(--foreground)]" role="alert">
              {sheetError}
            </p>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              className="lc-btn lc-btn-secondary min-h-11 flex-1 cursor-pointer disabled:cursor-not-allowed"
              disabled={saving}
              onClick={onClose}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className={cn(
                "lc-btn lc-btn-primary min-h-11 flex-1 cursor-pointer disabled:cursor-not-allowed",
              )}
              disabled={confirmDisabled}
            >
              {saving ? "Guardando…" : "Confirmar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
