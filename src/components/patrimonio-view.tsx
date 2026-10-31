"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { formatArs, formatDateAr } from "@/lib/utils";
import {
  filterPatrimonioSeries,
  usableFxRate,
  type PatrimonioPoint,
  type SeriesRange,
} from "@/lib/patrimonio";

type Current = Omit<PatrimonioPoint, "netWorthArs"> & {
  netWorthArs: number | null;
  cardStatus?: string;
  fxAvailable?: boolean;
};

type FlowPoint = {
  month: string;
  incomeArs: number;
  expenseArs: number;
  flowArs: number;
};

type Payload = {
  current: Current;
  series: PatrimonioPoint[];
  note: string;
  trustedMonths: string[];
  flujo?: FlowPoint[];
};

const RANGES: Array<{ id: SeriesRange; label: string }> = [
  { id: "6m", label: "6 meses" },
  { id: "1y", label: "1 año" },
  { id: "all", label: "Todo" },
];

export function PatrimonioView({ compact = false }: { compact?: boolean }) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<SeriesRange>("all");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/patrimonio", { credentials: "include" });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || "Error");
        if (!cancelled) setData(body);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Error de red");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const shown = useMemo(
    () => (data ? filterPatrimonioSeries(data.series, range, data.current.date) : []),
    [data, range],
  );

  if (error) {
    return <p className="text-sm text-red-700">{error}</p>;
  }
  if (!data) {
    return <p className="text-sm text-[var(--muted-fg)]">Cargando patrimonio…</p>;
  }

  const current = data.current;
  const fxMissing = usableFxRate(current.fxRate) == null;

  return (
    <div className="space-y-3">
    <section className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">Patrimonio</h2>
          <p className="text-[11px] text-[var(--muted-fg)]">
            Ahorros menos deuda en pesos y dólares, al blue.
          </p>
        </div>
        {compact && (
          <Link href="/patrimonio" className="text-xs font-medium text-[var(--brand-fg)]">
            Ver evolución
          </Link>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Metric label="Ahorros" value={assetsText(current)} />
        <Metric label="Deuda" value={debtText(current)} />
        <Metric
          label="Neto"
          value={current.netWorthArs == null ? "Sin cotización" : formatArs(current.netWorthArs)}
        />
      </div>
      {fxMissing && (
        <p className="text-[11px] text-[var(--muted-fg)]">
          Sin cotización blue. No valuamos los dólares en 0.
        </p>
      )}
      {current.cardStatus === "sin_tarjeta_activa" && (
        <p className="text-[11px] text-[var(--muted-fg)]">Sin tarjeta activa</p>
      )}

      {!compact && (
        <div className="flex gap-1.5">
          {RANGES.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setRange(item.id)}
              className={
                range === item.id
                  ? "inline-flex min-h-10 min-w-10 cursor-pointer items-center justify-center rounded-full bg-[var(--foreground)] px-3 text-xs font-medium text-[var(--surface)]"
                  : "inline-flex min-h-10 min-w-10 cursor-pointer items-center justify-center rounded-full border border-[var(--border)] px-3 text-xs font-medium"
              }
            >
              {item.label}
            </button>
          ))}
        </div>
      )}

      {shown.length >= 2 ? (
        <PatrimonioChart points={shown} />
      ) : (
        <p className="rounded-xl border border-dashed border-[var(--border)] px-3 py-4 text-sm text-[var(--muted-fg)]">
          {data.note} Con un solo punto no hay línea todavía.
        </p>
      )}

      {shown.length >= 2 && (
        <p className="text-[11px] text-[var(--muted-fg)]">{data.note}</p>
      )}
      {data.trustedMonths.length === 0 && !compact && (
        <p className="text-[11px] text-[var(--muted-fg)]">
          No hay meses anteriores confiables. El extracto de la tarjeta está incompleto, así que no estimamos deuda vieja.
        </p>
      )}
    </section>
    {!compact && <FlujoSection points={data.flujo ?? []} />}
    </div>
  );
}

function assetsText(current: Current): string {
  if (current.assetsUsd > 0 && usableFxRate(current.fxRate) == null) return "Sin cotización";
  return formatArs(current.assetsArs);
}

function debtText(current: Current): string {
  if (current.debtUsd > 0 && usableFxRate(current.fxRate) == null) return "Sin cotización";
  const rate = usableFxRate(current.fxRate) ?? 0;
  const total = current.debtArs + current.debtUsd * rate;
  if (total === 0 && current.debtUsd === 0) return "Sin deuda";
  return formatArs(total);
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-fg)]">{label}</p>
      <p className="mt-0.5 truncate text-sm font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function PatrimonioChart({ points }: { points: PatrimonioPoint[] }) {
  const width = 360;
  const height = 180;
  const pad = { top: 12, right: 8, bottom: 22, left: 8 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const values = points.flatMap((point) => [point.assetsArs, debtLine(point), point.netWorthArs]);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const span = max - min;
  min -= span * 0.08;
  max += span * 0.08;
  const x = (index: number) =>
    pad.left + (points.length === 1 ? innerW / 2 : (index / (points.length - 1)) * innerW);
  const y = (value: number) => pad.top + innerH - ((value - min) / (max - min)) * innerH;
  const path = (pick: (point: PatrimonioPoint) => number, dashed: boolean) => {
    const d = points
      .map((point, index) => `${index === 0 ? "M" : "L"} ${x(index).toFixed(1)} ${y(pick(point)).toFixed(1)}`)
      .join(" ");
    return (
      <path
        d={d}
        fill="none"
        strokeWidth="2"
        strokeDasharray={dashed ? "4 3" : undefined}
      />
    );
  };
  const anyDerived = points.some((point) => point.source === "derived");

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label="Evolución de ahorros, deuda y patrimonio">
        <g className="text-emerald-600" stroke="currentColor">
          {path((point) => point.assetsArs, anyDerived)}
        </g>
        <g className="text-red-600" stroke="currentColor">
          {path((point) => debtLine(point), anyDerived)}
        </g>
        <g className="text-sky-700" stroke="currentColor">
          {path((point) => point.netWorthArs, false)}
        </g>
        <text x={pad.left} y={height - 4} className="fill-zinc-500 text-[10px]">
          {formatDateAr(points[0].date)}
        </text>
        <text x={width - pad.right} y={height - 4} textAnchor="end" className="fill-zinc-500 text-[10px]">
          {formatDateAr(points[points.length - 1].date)}
        </text>
      </svg>
      <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-[var(--muted-fg)]">
        <span className="text-emerald-700">Ahorros</span>
        <span className="text-red-700">Deuda</span>
        <span className="text-sky-800">Patrimonio</span>
        {anyDerived && <span>Línea punteada: estimado</span>}
      </div>
    </div>
  );
}

function debtLine(point: PatrimonioPoint): number {
  const rate = usableFxRate(point.fxRate) ?? 0;
  return point.debtArs + point.debtUsd * rate;
}

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function monthLabel(period: string): string {
  const [year, month] = period.split("-");
  const name = MONTHS[Number(month) - 1] ?? month;
  return `${name} ${year?.slice(2) ?? ""}`;
}

function FlujoSection({ points }: { points: FlowPoint[] }) {
  return (
    <section className="space-y-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div>
        <h3 className="text-sm font-semibold tracking-tight">Flujo mensual: ingresos − gastos</h3>
        <p className="text-[11px] text-[var(--muted-fg)]">
          Flujo de caja mensual (ingresos − gastos). No es patrimonio.
        </p>
      </div>
      {points.length === 0 ? (
        <p className="text-sm text-[var(--muted-fg)]">Todavía no hay un espacio activo para el flujo.</p>
      ) : (
        <FlowChart points={points} />
      )}
    </section>
  );
}

function FlowChart({ points }: { points: FlowPoint[] }) {
  const width = 360;
  const height = 140;
  const pad = { top: 8, right: 4, bottom: 22, left: 4 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  let min = Math.min(0, ...points.map((point) => point.flowArs));
  let max = Math.max(0, ...points.map((point) => point.flowArs));
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const span = max - min;
  const y = (value: number) => pad.top + innerH - ((value - min) / span) * innerH;
  const zero = y(0);
  const slot = innerW / points.length;
  const barW = Math.max(2, slot * 0.62);

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label="Flujo mensual: ingresos menos gastos">
        <line x1={pad.left} x2={width - pad.right} y1={zero} y2={zero} className="stroke-zinc-300" strokeWidth="1" />
        {points.map((point, index) => {
          const x = pad.left + index * slot + (slot - barW) / 2;
          const top = y(Math.max(point.flowArs, 0));
          const bottom = y(Math.min(point.flowArs, 0));
          return (
            <rect
              key={point.month}
              x={x}
              y={top}
              width={barW}
              height={Math.max(1, bottom - top)}
              className={point.flowArs >= 0 ? "fill-emerald-600" : "fill-red-600"}
            >
              <title>{`${monthLabel(point.month)}: ${formatArs(point.flowArs)}`}</title>
            </rect>
          );
        })}
        <text x={pad.left} y={height - 4} className="fill-zinc-500 text-[10px]">
          {monthLabel(points[0].month)}
        </text>
        <text x={width - pad.right} y={height - 4} textAnchor="end" className="fill-zinc-500 text-[10px]">
          {monthLabel(points[points.length - 1].month)}
        </text>
      </svg>
    </div>
  );
}
