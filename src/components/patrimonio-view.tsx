"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { formatArs, formatDateAr } from "@/lib/utils";
import {
  filterPatrimonioSeries,
  type PatrimonioPoint,
  type SeriesRange,
} from "@/lib/patrimonio";

type Payload = {
  current: PatrimonioPoint & { cardStatus?: string };
  series: PatrimonioPoint[];
  note: string;
  trustedMonths: string[];
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
  const noDebt = current.debtArs === 0;

  return (
    <section className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">Patrimonio</h2>
          <p className="text-[11px] text-[var(--muted-fg)]">Ahorros menos deuda, en pesos</p>
        </div>
        {compact && (
          <Link href="/patrimonio" className="text-xs font-medium text-[var(--brand-fg)]">
            Ver evolución
          </Link>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Metric label="Ahorros" value={formatArs(current.assetsArs)} />
        <Metric label="Deuda" value={noDebt ? "Sin deuda" : formatArs(current.debtArs)} />
        <Metric label="Neto" value={formatArs(current.netWorthArs)} />
      </div>
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
                  ? "rounded-full bg-[var(--foreground)] px-3 py-1.5 text-xs font-medium text-[var(--surface)]"
                  : "rounded-full border border-[var(--border)] px-3 py-1.5 text-xs font-medium"
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
  );
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
  const values = points.flatMap((point) => [point.assetsArs, point.debtArs, point.netWorthArs]);
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
          {path((point) => point.debtArs, anyDerived)}
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
