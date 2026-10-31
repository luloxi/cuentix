"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  ArrowDownRight,
  ChevronRight,
  Eye,
  EyeOff,
  LayoutGrid,
  Minus,
  Moon,
  Sun,
  X,
} from "lucide-react";
import { formatArs, formatUsd, cn } from "@/lib/utils";
import { formatPeriodLabel, formatPeriodShort, isCurrentCalendarMonth } from "@/lib/period-label";
import { CategoryIcon } from "@/lib/category-icons";
import { colorForCategory } from "@/lib/category-colors";
import { useTheme } from "@/components/theme-provider";
import { DEUDA_ENABLED } from "@/lib/features";
import { homeNextAction } from "@/lib/nav";

type CategorySummary = {
  id: string;
  slug: string;
  name: string;
  total: number;
  pct: number;
};

type HouseholdService = {
  slug: string;
  name: string;
  paid: boolean;
};

type LiveRate = {
  id: string;
  label: string;
  value: number | null;
  buy?: number | null;
  sell?: number | null;
  spread?: number | null;
  hint?: string;
};

type HomeSectionId =
  | "gastos"
  | "categorias"
  | "ahorros"
  | "hogar"
  | "deuda"
  | "cotizaciones";

const SKIPPED_SERVICES_KEY = "lc:hogar-skipped-services";
const HOME_ORDER_KEY = "lc:home-order";
const HOME_HIDDEN_KEY = "lc:home-hidden";

const DEFAULT_ORDER: HomeSectionId[] = DEUDA_ENABLED
  ? ["gastos", "categorias", "ahorros", "hogar", "deuda", "cotizaciones"]
  : ["gastos", "categorias", "ahorros", "hogar", "cotizaciones"];

const SECTION_LABELS: Record<HomeSectionId, string> = {
  gastos: "Neta del mes",
  categorias: "Por categoría",
  ahorros: "Ahorros",
  hogar: "Hogar",
  deuda: "Deuda",
  cotizaciones: "Cotizaciones",
};

/** Full-width on desktop grid */
const WIDE_SECTIONS = new Set<HomeSectionId>(["gastos", "cotizaciones"]);

function loadSkippedServices(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(SKIPPED_SERVICES_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function loadOrder(): HomeSectionId[] {
  if (typeof window === "undefined") return DEFAULT_ORDER;
  try {
    const raw = window.localStorage.getItem(HOME_ORDER_KEY);
    if (!raw) return DEFAULT_ORDER;
    const arr = JSON.parse(raw) as string[];
    if (!Array.isArray(arr)) return DEFAULT_ORDER;
    const valid = arr.filter((id): id is HomeSectionId =>
      DEFAULT_ORDER.includes(id as HomeSectionId),
    );
    for (const id of DEFAULT_ORDER) {
      if (!valid.includes(id)) valid.push(id);
    }
    return DEUDA_ENABLED ? valid : valid.filter((id) => id !== "deuda");
  } catch {
    return DEFAULT_ORDER;
  }
}

function loadHidden(): Set<HomeSectionId> {
  if (typeof window === "undefined") return new Set();
  try {
    const legacyDebt = window.localStorage.getItem("lc:home-show-debt");
    const legacyHogar = window.localStorage.getItem("lc:home-show-hogar");
    const raw = window.localStorage.getItem(HOME_HIDDEN_KEY);
    let hidden = new Set<HomeSectionId>();
    if (raw) {
      const arr = JSON.parse(raw) as string[];
      if (Array.isArray(arr)) {
        for (const id of arr) {
          if (DEFAULT_ORDER.includes(id as HomeSectionId)) {
            hidden.add(id as HomeSectionId);
          }
        }
      }
    } else {
      if (legacyDebt === "0" || legacyDebt === "false") hidden.add("deuda");
      if (legacyHogar === "0" || legacyHogar === "false") hidden.add("hogar");
    }
    return hidden;
  } catch {
    return new Set();
  }
}

function saveOrder(order: HomeSectionId[]) {
  window.localStorage.setItem(HOME_ORDER_KEY, JSON.stringify(order));
}

function saveHidden(hidden: Set<HomeSectionId>) {
  window.localStorage.setItem(HOME_HIDDEN_KEY, JSON.stringify([...hidden]));
}

function formatRate(n: number) {
  return new Intl.NumberFormat("es-AR", {
    maximumFractionDigits: 0,
  }).format(Math.round(n));
}

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

function useCountUp(target: number, durationMs = 700) {
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const from = fromRef.current;
    if (from === target) {
      setValue(target);
      return;
    }
    const start = performance.now();
    const delta = target - from;

    function tick(now: number) {
      const t = Math.min(1, (now - start) / durationMs);
      setValue(from + delta * easeOutCubic(t));
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = target;
        setValue(target);
      }
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [target, durationMs]);

  useEffect(() => {
    fromRef.current = value;
  }, [value]);

  return value;
}

const BURST_COLORS = [
  "#5a9a88",
  "#7eb8a8",
  "#c4a574",
  "#8a9bb5",
  "#a88bb0",
];

function SpendBurst({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <div
      className="pointer-events-none absolute inset-0 z-10 overflow-visible"
      aria-hidden
    >
      {Array.from({ length: 12 }).map((_, i) => {
        const angle = (i / 12) * Math.PI * 2 + (i % 3) * 0.15;
        const dist = 40 + (i % 4) * 14;
        const x = Math.cos(angle) * dist;
        const y = Math.sin(angle) * dist - 8;
        const size = 4 + (i % 3);
        const color = BURST_COLORS[i % BURST_COLORS.length]!;
        const delay = (i % 4) * 30;
        return (
          <span
            key={i}
            className="lc-burst-particle absolute left-1/2 top-1/2 rounded-full"
            style={{
              width: size,
              height: size,
              marginLeft: -size / 2,
              marginTop: -size / 2,
              background: color,
              ["--bx" as string]: `${x}px`,
              ["--by" as string]: `${y}px`,
              animationDelay: `${delay}ms`,
            }}
          />
        );
      })}
      <span className="lc-burst-ring absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" />
      <span className="lc-burst-flash absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" />
    </div>
  );
}

function VsPrevMeter({
  total,
  prevTotal,
  prevPeriod,
  inProgressMonth,
}: {
  total: number;
  prevTotal: number;
  prevPeriod: string;
  inProgressMonth: boolean;
}) {
  if (prevTotal <= 0 && total <= 0) return null;

  const diff = total - prevTotal;
  const pct =
    prevTotal > 0 ? (total / prevTotal) * 100 : total > 0 ? 100 : 0;
  const barPct = Math.min(100, pct);
  const over = pct > 100;

  const DiffIcon =
    Math.abs(diff) < 1 ? Minus : diff > 0 ? ArrowUpRight : ArrowDownRight;
  const diffColor =
    Math.abs(diff) < 1
      ? "text-[var(--muted-fg)]"
      : diff > 0
        ? "text-amber-700 dark:text-amber-400"
        : "text-[var(--brand-fg)]";

  return (
    <div className="mt-2.5 space-y-1.5">
      {!inProgressMonth && (
        <div className="relative h-1 overflow-hidden rounded-full bg-[var(--surface-muted)]">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-700 ease-out",
              over ? "bg-amber-500/90" : "bg-[var(--brand)]",
            )}
            style={{ width: `${barPct}%` }}
          />
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-[11px]">
        <span className="text-[var(--muted-fg)]">
          {inProgressMonth ? "mes en curso · " : ""}
          vs {formatPeriodShort(prevPeriod)}{" "}
          <span className="tabular-nums font-medium text-[var(--foreground)]/70">
            {formatArs(prevTotal)}
          </span>
        </span>
        {prevTotal > 0 && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 font-medium tabular-nums",
              diffColor,
            )}
          >
            <DiffIcon className="h-3 w-3" />
            {diff > 0 ? "+" : ""}
            {formatArs(diff)}
            {!inProgressMonth && (
              <span className="ml-0.5 opacity-70">
                ({Math.abs(pct - 100).toFixed(0)}%
                {diff > 0 ? " más" : diff < 0 ? " menos" : ""})
              </span>
            )}
          </span>
        )}
      </div>
    </div>
  );
}

function TapHint() {
  return (
    <ChevronRight
      className="h-4 w-4 shrink-0 text-[var(--border-strong)] transition group-hover:text-[var(--muted-fg)]"
      aria-hidden
    />
  );
}

function ThemeToggle() {
  const { resolved, toggle } = useTheme();
  return (
    <button
      type="button"
      onClick={toggle}
      className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-[var(--muted-fg)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]"
      aria-label={
        resolved === "dark" ? "Cambiar a tema claro" : "Cambiar a tema oscuro"
      }
      title={resolved === "dark" ? "Tema claro" : "Tema oscuro"}
    >
      {resolved === "dark" ? (
        <Sun className="h-3.5 w-3.5" strokeWidth={1.75} />
      ) : (
        <Moon className="h-3.5 w-3.5" strokeWidth={1.75} />
      )}
    </button>
  );
}

function RatesStrip({ rates }: { rates: LiveRate[] }) {
  const blue = rates.find((r) => r.id === "blue");
  const others = rates.filter(
    (r) => r.id !== "blue" && r.value != null && r.value > 0,
  );
  const hasBlue =
    blue &&
    ((blue.buy != null && blue.buy > 0) ||
      (blue.sell != null && blue.sell > 0) ||
      (blue.value != null && blue.value > 0));

  if (!hasBlue && others.length === 0) return null;

  const compra = blue?.buy ?? null;
  const venta = blue?.sell ?? blue?.value ?? null;
  const spread =
    blue?.spread != null
      ? blue.spread
      : compra != null && venta != null
        ? venta - compra
        : null;

  return (
    <div className="space-y-px overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--border)]" aria-label="Cotizaciones del dólar">
      {hasBlue && (
        <div className="bg-[var(--surface)] px-3 py-3 md:px-4 md:py-3.5">
          <p className="mb-2 text-center text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted-fg)]">
            Blue
          </p>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="text-[9px] font-medium uppercase tracking-wide text-[var(--muted-fg)]/80">
                Compra
              </p>
              <p className="mt-0.5 text-base font-semibold tabular-nums tracking-tight text-[var(--foreground)] md:text-lg">
                {compra != null ? `$${formatRate(compra)}` : "—"}
              </p>
            </div>
            <div>
              <p className="text-[9px] font-medium uppercase tracking-wide text-[var(--muted-fg)]/80">
                Venta
              </p>
              <p className="mt-0.5 text-base font-semibold tabular-nums tracking-tight text-[var(--foreground)] md:text-lg">
                {venta != null ? `$${formatRate(venta)}` : "—"}
              </p>
            </div>
            <div>
              <p className="text-[9px] font-medium uppercase tracking-wide text-[var(--muted-fg)]/80">
                Spread
              </p>
              <p className="mt-0.5 text-base font-semibold tabular-nums tracking-tight text-[var(--brand-fg)] md:text-lg">
                {spread != null ? `$${formatRate(spread)}` : "—"}
              </p>
            </div>
          </div>
        </div>
      )}
      {others.length > 0 && (
        <div
          className={cn(
            "grid gap-px",
            others.length === 1 ? "grid-cols-1" : "grid-cols-2",
          )}
        >
          {others.map((r) => (
            <div
              key={r.id}
              className="flex flex-col items-center gap-0.5 bg-[var(--surface)] px-2 py-2.5 text-center md:py-3"
            >
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted-fg)]">
                {r.label}
              </span>
              <span className="text-base font-semibold tabular-nums tracking-tight text-[var(--foreground)] md:text-lg">
                ${formatRate(r.value!)}
              </span>
              {r.hint && (
                <span className="text-[9px] font-medium text-[var(--muted-fg)]/80">
                  {r.hint}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function HomeLayoutEditor({
  open,
  onClose,
  order,
  hidden,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  order: HomeSectionId[];
  hidden: Set<HomeSectionId>;
  onChange: (order: HomeSectionId[], hidden: Set<HomeSectionId>) => void;
}) {
  if (!open) return null;

  function move(id: HomeSectionId, dir: -1 | 1) {
    const i = order.indexOf(id);
    if (i < 0) return;
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    const tmp = next[i]!;
    next[i] = next[j]!;
    next[j] = tmp;
    onChange(next, hidden);
  }

  function toggle(id: HomeSectionId) {
    const next = new Set(hidden);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(order, next);
  }

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 shadow-sm md:col-span-2">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm font-semibold tracking-tight">Inicio</p>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[var(--muted-fg)] hover:bg-[var(--surface-muted)]"
          aria-label="Cerrar"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <p className="mb-2 text-[11px] text-[var(--muted-fg)]">
        Ordená y mostrá u ocultá las tarjetas. Lo demás queda en la barra de abajo.
      </p>
      <ul className="space-y-1.5 md:grid md:grid-cols-2 md:gap-2 md:space-y-0">
        {order.map((id, i) => {
          const isHidden = hidden.has(id);
          return (
            <li
              key={id}
              className={cn(
                "flex items-center gap-1.5 rounded-xl border px-2 py-1.5",
                isHidden
                  ? "border-dashed border-[var(--border)] opacity-60"
                  : "border-[var(--border)] bg-[var(--surface-muted)]/40",
              )}
            >
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {SECTION_LABELS[id]}
              </span>
              <button
                type="button"
                disabled={i === 0}
                onClick={() => move(id, -1)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[var(--muted-fg)] hover:bg-[var(--surface)] disabled:opacity-30"
                aria-label="Subir"
              >
                <ArrowUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                disabled={i === order.length - 1}
                onClick={() => move(id, 1)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[var(--muted-fg)] hover:bg-[var(--surface)] disabled:opacity-30"
                aria-label="Bajar"
              >
                <ArrowDown className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => toggle(id)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[var(--muted-fg)] hover:bg-[var(--surface)]"
                aria-label={isHidden ? "Mostrar" : "Ocultar"}
                title={isHidden ? "Mostrar" : "Ocultar"}
              >
                {isHidden ? (
                  <EyeOff className="h-3.5 w-3.5" />
                ) : (
                  <Eye className="h-3.5 w-3.5" />
                )}
              </button>
            </li>
          );
        })}
      </ul>
      <Link
        href="/suscripcion"
        className="mt-3 inline-flex text-[11px] font-medium text-[var(--muted-fg)] underline-offset-2 hover:text-[var(--foreground)] hover:underline"
      >
        Plan y suscripción
      </Link>
    </div>
  );
}

export function DashboardHome({
  firstName,
  period,
  prevPeriod,
  totalArs,
  prevTotalArs,
  sharedTotalArs,
  sharedPrevTotalArs,
  debtBalanceArs,
  debtSettled,
  monthTxCount,
  categorySummary,
  householdServices = [],
  liveRates = [],
  savingsArs = 0,
  savingsUsd = 0,
  savingsUsdc = 0,
  savingsNetArs = 0,
  incomeArs = 0,
}: {
  firstName: string;
  period: string;
  prevPeriod: string;
  totalArs: number;
  prevTotalArs: number;
  sharedTotalArs: number;
  sharedPrevTotalArs: number;
  debtBalanceArs: number;
  debtSettled: boolean;
  monthTxCount: number;
  categorySummary: CategorySummary[];
  householdServices?: HouseholdService[];
  liveRates?: LiveRate[];
  savingsArs?: number;
  savingsUsd?: number;
  savingsUsdc?: number;
  savingsNetArs?: number;
  /** Ingresos del mes en ARS (USD ya convertidos). 0 = sin ingresos cargados. */
  incomeArs?: number;
  householdName?: string;
  initialCategories?: unknown;
  initialMembers?: unknown;
}) {
  const router = useRouter();
  const [liveTotal, setLiveTotal] = useState(totalArs);
  const [liveCats, setLiveCats] = useState(categorySummary);
  const [burst, setBurst] = useState(false);
  const [pop, setPop] = useState(false);
  const [skipped, setSkipped] = useState<Set<string>>(() => new Set());
  const [order, setOrder] = useState<HomeSectionId[]>(DEFAULT_ORDER);
  const [hidden, setHidden] = useState<Set<HomeSectionId>>(() => new Set());
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    setSkipped(loadSkippedServices());
    setOrder(loadOrder());
    setHidden(loadHidden());
  }, []);

  useEffect(() => {
    setLiveTotal(totalArs);
    setLiveCats(categorySummary);
  }, [totalArs, categorySummary]);

  const displayTotal = useCountUp(liveTotal, 750);
  const hasIncomes = incomeArs > 0;
  const heroTarget = hasIncomes ? incomeArs - liveTotal : liveTotal;
  const heroAmount = useCountUp(heroTarget, 750);

  const triggerCelebrate = useCallback(() => {
    setBurst(true);
    setPop(true);
    window.setTimeout(() => setBurst(false), 900);
    window.setTimeout(() => setPop(false), 500);
  }, []);

  useEffect(() => {
    function onCreated() {
      triggerCelebrate();
      router.refresh();
    }
    window.addEventListener("lc:expense-created", onCreated);
    return () => window.removeEventListener("lc:expense-created", onCreated);
  }, [router, triggerCelebrate]);

  const visibleServices = householdServices.filter((s) => !skipped.has(s.slug));
  const hasSavings =
    savingsArs > 0 || savingsUsd > 0 || savingsUsdc > 0 || savingsNetArs > 0;

  function onLayoutChange(
    nextOrder: HomeSectionId[],
    nextHidden: Set<HomeSectionId>,
  ) {
    setOrder(nextOrder);
    setHidden(nextHidden);
    saveOrder(nextOrder);
    saveHidden(nextHidden);
  }

  const next = homeNextAction(monthTxCount);
  const emptyMonth = monthTxCount <= 0 && !hasIncomes;

  const sections = useMemo(() => {
    const map: Record<HomeSectionId, React.ReactNode> = {
      gastos: (
        <div className="relative overflow-hidden rounded-[1.25rem] border border-[var(--border)] bg-[var(--surface)] px-5 py-7 md:px-8 md:py-10">
          <SpendBurst active={burst} />
          <p className="text-[13px] font-medium tracking-wide text-[var(--brand-fg)]">
            Neta
          </p>
          <p
            className={cn(
              "mt-3 font-semibold leading-[0.92] tabular-nums tracking-[-0.04em] text-[var(--foreground)]",
              "text-[2.85rem] sm:text-6xl md:text-8xl",
              pop && "lc-amount-pop",
              hasIncomes && heroAmount < 0 && "text-red-800 dark:text-red-300",
            )}
            aria-label={
              hasIncomes
                ? `Neta del mes, ${formatArs(Math.round(heroAmount))}`
                : `Gastos del mes, ${formatArs(Math.round(displayTotal))}`
            }
          >
            {formatArs(Math.round(heroAmount))}
          </p>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-[var(--muted-fg)]">
            {emptyMonth
              ? "Este mes todavía está en blanco."
              : hasIncomes
                ? "Ingresos menos gastos, pesos y dólares al tipo de cambio del mes."
                : "Lo que salió este mes. Cargá ingresos si querés ver la neta."}
          </p>
          {hasIncomes && (
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-[var(--muted-fg)]">
              <span>
                Ingresos{" "}
                <span className="tabular-nums font-medium text-[var(--brand-fg)]">
                  {formatArs(Math.round(incomeArs))}
                </span>
              </span>
              <span>
                Gastos{" "}
                <span className="tabular-nums font-medium text-[var(--foreground)]/80">
                  {formatArs(Math.round(liveTotal))}
                </span>
              </span>
            </div>
          )}
          {!emptyMonth && (
            <VsPrevMeter
              total={liveTotal}
              prevTotal={prevTotalArs}
              prevPeriod={prevPeriod}
              inProgressMonth={isCurrentCalendarMonth(period)}
            />
          )}
          <Link
            href={next.href}
            className="lc-btn lc-btn-primary mt-6 !rounded-2xl !px-5 !py-2.5 text-[15px]"
          >
            {next.label}
          </Link>
        </div>
      ),
      categorias:
        liveCats.length > 0 ? (
          <Link
            href="/consumos?tab=resumen"
            className="group block h-full rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-3 transition active:scale-[0.99] md:px-5 md:py-4"
            aria-label="Gastos por categoría"
          >
            <div className="mb-2.5 flex items-center justify-between gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--muted-fg)]">
                Por categoría
              </p>
              <TapHint />
            </div>
            <ul className="space-y-2 md:space-y-2.5">
              {liveCats.map((c) => {
                const color = colorForCategory(c.slug);
                return (
                  <li key={c.id} className="flex items-center gap-2.5">
                    <span
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                      style={{ backgroundColor: `${color}14`, color }}
                    >
                      <CategoryIcon slug={c.slug} size={13} />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs text-[var(--foreground)]/80 md:text-sm">
                      {c.name}
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-[var(--muted-fg)] md:text-sm">
                      {formatArs(c.total)}
                    </span>
                    <div className="h-1 w-10 shrink-0 overflow-hidden rounded-full bg-[var(--surface-muted)] md:w-16">
                      <div
                        className="h-full rounded-full opacity-80"
                        style={{
                          width: `${Math.min(100, c.pct)}%`,
                          backgroundColor: color,
                        }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </Link>
        ) : null,
      ahorros: hasSavings ? (
        <Link
          href="/ahorros"
          className="group block h-full rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-3.5 transition active:scale-[0.99] md:px-5 md:py-4"
          aria-label="Ahorros"
        >
          <div className="mb-1 flex items-center justify-between gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--muted-fg)]">
              Ahorros
            </p>
            <TapHint />
          </div>
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <p className="text-2xl font-semibold tabular-nums tracking-tight text-[var(--foreground)] md:text-3xl">
              {formatArs(Math.round(savingsNetArs))}
            </p>
            <p className="text-[11px] text-[var(--muted-fg)]">
              en pesos
            </p>
          </div>
          <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[var(--muted-fg)]">
            <span>
              Pesos{" "}
              <span className="tabular-nums font-medium text-[var(--foreground)]/80">
                {formatArs(savingsArs)}
              </span>
            </span>
            <span>
              USD{" "}
              <span className="tabular-nums font-medium text-[var(--foreground)]/80">
                {formatUsd(savingsUsd)}
              </span>
            </span>
            <span>
              USDC{" "}
              <span className="tabular-nums font-medium text-[var(--brand-fg)]">
                {formatUsd(savingsUsdc)}
              </span>
            </span>
          </div>
        </Link>
      ) : null,
      hogar: sharedTotalArs > 0 || visibleServices.some((s) => s.paid) ? (
        <Link
          href="/compartido"
          className="group block h-full rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-3 transition active:scale-[0.99] md:px-5 md:py-4"
          aria-label={`Hogar ${formatArs(sharedTotalArs)}`}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--muted-fg)]">
                Hogar
              </p>
              <p className="mt-0.5 text-lg font-semibold tabular-nums tracking-tight text-[var(--foreground)] md:text-xl">
                {formatArs(sharedTotalArs)}
              </p>
              {visibleServices.length > 0 && (
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                  {visibleServices.map((svc) => (
                    <span
                      key={svc.slug}
                      title={`${svc.name}: ${svc.paid ? "Pagado" : "Pendiente"}`}
                      className={cn(
                        "flex h-7 w-7 items-center justify-center rounded-lg",
                        svc.paid
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/55 dark:text-emerald-300"
                          : "bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500",
                      )}
                    >
                      <CategoryIcon slug={svc.slug} size={13} />
                    </span>
                  ))}
                </div>
              )}
              <VsPrevMeter
                total={sharedTotalArs}
                prevTotal={sharedPrevTotalArs}
                prevPeriod={prevPeriod}
                inProgressMonth={isCurrentCalendarMonth(period)}
              />
            </div>
            <TapHint />
          </div>
        </Link>
      ) : null,
      deuda: DEUDA_ENABLED ? (
        <Link
          href="/deuda"
          className="group flex h-full items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-3 transition active:scale-[0.99] md:px-5 md:py-4"
          aria-label={
            debtSettled
              ? "Deuda saldada"
              : `Deuda ${formatArs(debtBalanceArs)}`
          }
        >
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--muted-fg)]">
              Deuda
            </p>
            <p
              className={cn(
                "mt-0.5 text-lg font-semibold tabular-nums tracking-tight md:text-xl",
                debtSettled
                  ? "text-[var(--brand-fg)]"
                  : "text-red-800 dark:text-red-200",
              )}
            >
              {debtSettled ? "Saldada" : formatArs(debtBalanceArs)}
            </p>
          </div>
          <TapHint />
        </Link>
      ) : null,
      cotizaciones: <RatesStrip rates={liveRates} />,
    };

    return order
      .filter((id) => !hidden.has(id))
      .map((id) => {
        const node = map[id];
        if (!node) return null;
        return (
          <div
            key={id}
            className={cn(
              "min-w-0",
              WIDE_SECTIONS.has(id) && "md:col-span-2",
            )}
          >
            {node}
          </div>
        );
      })
      .filter(Boolean);
  }, [
    order,
    hidden,
    displayTotal,
    heroAmount,
    hasIncomes,
    incomeArs,
    burst,
    pop,
    liveTotal,
    prevTotalArs,
    prevPeriod,
    liveCats,
    hasSavings,
    savingsNetArs,
    savingsArs,
    savingsUsd,
    savingsUsdc,
    sharedTotalArs,
    sharedPrevTotalArs,
    visibleServices,
    debtSettled,
    debtBalanceArs,
    liveRates,
    period,
    monthTxCount,
    next,
    emptyMonth,
  ]);

  return (
    <div className="animate-fade-up mx-auto flex w-full max-w-lg flex-col gap-5 md:max-w-5xl md:gap-6">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[17px] font-medium tracking-tight text-[var(--foreground)] md:text-xl">
            Hola, {firstName}
          </p>
          <p className="mt-0.5 text-sm capitalize text-[var(--muted-fg)]">
            {formatPeriodLabel(period)}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className={cn(
              "inline-flex h-8 w-8 items-center justify-center rounded-full border transition",
              editing
                ? "border-[var(--brand)]/40 bg-[var(--brand)]/10 text-[var(--brand-fg)]"
                : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted-fg)] hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]",
            )}
            aria-label="Editar inicio"
            title="Orden y visibilidad"
          >
            <LayoutGrid className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
          <ThemeToggle />
        </div>
      </div>

      <HomeLayoutEditor
        open={editing}
        onClose={() => setEditing(false)}
        order={order}
        hidden={hidden}
        onChange={onLayoutChange}
      />

      <div className="flex flex-col gap-4 md:grid md:grid-cols-2 md:items-stretch md:gap-5">
        {sections}
      </div>
    </div>
  );
}
