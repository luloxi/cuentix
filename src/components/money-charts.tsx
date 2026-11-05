"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Currency } from "@/lib/stats/currency";
import { cn, formatCurrencyAmount } from "@/lib/utils";

const FILLS = [
  "var(--cat-1)",
  "var(--cat-2)",
  "var(--cat-3)",
  "var(--cat-4)",
  "var(--cat-5)",
  "var(--cat-6)",
  "var(--cat-7)",
  "var(--cat-8)",
  "var(--cat-9)",
  "var(--cat-10)",
  "var(--cat-11)",
  "var(--cat-12)",
];

export function chartFill(index: number): string {
  return FILLS[index % FILLS.length]!;
}

export function ChoiceRow<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ id: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label={label}>
      {options.map((opt) => {
        const on = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(opt.id)}
            className={cn(
              "min-h-11 cursor-pointer rounded-full border px-3 text-sm font-medium",
              on
                ? "border-[color-mix(in_srgb,var(--accent)_55%,var(--border))] bg-[color-mix(in_srgb,var(--accent)_24%,var(--surface))] text-[var(--text)]"
                : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted-fg)]",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export const CURRENCY_OPTIONS: Array<{ id: Currency; label: string }> = [
  { id: "ARS", label: "ARS" },
  { id: "USDT", label: "USDT" },
  { id: "USD", label: "USD" },
];

export function PieChart({ slices }: { slices: { label: string; value: number }[] }) {
  const parts = slices.filter((slice) => slice.value > 0);
  const sum = parts.reduce((total, slice) => total + slice.value, 0);
  if (sum <= 0) {
    return <p className="text-[15px] text-[var(--muted-fg)]">Sin datos para el gráfico.</p>;
  }
  if (parts.length === 1) {
    return (
      <svg viewBox="0 0 200 200" className="mx-auto block h-auto w-full max-w-[220px]" role="img" aria-label={parts[0]!.label}>
        <circle cx="100" cy="100" r="78" fill={chartFill(0)} />
      </svg>
    );
  }
  const radius = 78;
  const paths = parts.reduce<Array<{ key: string; d: string; fill: string; label: string; end: number }>>(
    (acc, slice, index) => {
      const prev = acc.length === 0 ? -Math.PI / 2 : acc[acc.length - 1]!.end;
      const sweep = (slice.value / sum) * Math.PI * 2;
      const end = prev + sweep;
      const x1 = 100 + radius * Math.cos(prev);
      const y1 = 100 + radius * Math.sin(prev);
      const x2 = 100 + radius * Math.cos(end);
      const y2 = 100 + radius * Math.sin(end);
      const large = sweep > Math.PI ? 1 : 0;
      acc.push({
        key: slice.label,
        label: slice.label,
        fill: chartFill(index),
        end,
        d: `M 100 100 L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${radius} ${radius} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`,
      });
      return acc;
    },
    [],
  );
  return (
    <svg viewBox="0 0 200 200" className="mx-auto block h-auto w-full max-w-[220px]" role="img" aria-label="Distribución por categoría">
      {paths.map((slice) => (
        <path key={slice.key} d={slice.d} fill={slice.fill}>
          <title>{slice.label}</title>
        </path>
      ))}
    </svg>
  );
}

export function Legend({ items }: { items: { name: string }[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1.5 text-[13px]">
      {items.map((item, index) => (
        <li key={item.name} className="inline-flex min-w-0 items-center gap-1.5">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: chartFill(index) }} />
          <span className="truncate">{item.name}</span>
        </li>
      ))}
    </ul>
  );
}

function useChartWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(Math.max(280, el.clientWidth || 640));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, width };
}

export function MoneyLineChart({
  series,
  ariaLabel,
  currency,
}: {
  series: { name: string; points: { x: string; y: number }[] }[];
  ariaLabel: string;
  currency?: Currency;
}) {
  const { ref, width } = useChartWidth();
  const height = width < 520 ? 220 : 250;
  const pad = { l: width < 520 ? 44 : 56, r: 12, t: 16, b: 32 };
  const xs = useMemo(
    () => [...new Set(series.flatMap((item) => item.points.map((point) => point.x)))].sort(),
    [series],
  );
  if (xs.length === 0) {
    return (
      <div ref={ref}>
        <p className="text-[15px] text-[var(--muted-fg)]">Sin datos para el gráfico.</p>
      </div>
    );
  }
  const ys = series.flatMap((item) => item.points.map((point) => point.y));
  const minY = Math.min(0, ...ys);
  const maxY = Math.max(...ys, 0);
  const span = maxY - minY || 1;
  const xAt = (value: string) => {
    const index = xs.indexOf(value);
    if (xs.length === 1) return (pad.l + width - pad.r) / 2;
    return pad.l + (index / (xs.length - 1)) * (width - pad.l - pad.r);
  };
  const yAt = (value: number) => pad.t + (1 - (value - minY) / span) * (height - pad.t - pad.b);
  const ticks = [minY, minY + span / 2, maxY];
  const labelStep = Math.max(1, Math.ceil(xs.length / 6));
  return (
    <div ref={ref}>
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="block h-auto w-full" role="img" aria-label={ariaLabel}>
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={pad.l} x2={width - pad.r} y1={yAt(tick)} y2={yAt(tick)} stroke="var(--chart-grid)" />
            <text x={pad.l - 6} y={yAt(tick) + 4} textAnchor="end" fill="var(--chart-axis)" fontSize={11}>
              {axisLabel(tick)}
            </text>
          </g>
        ))}
        {series.map((item, index) => {
          const ordered = [...item.points].sort((a, b) => a.x.localeCompare(b.x));
          if (ordered.length === 0) return null;
          const d = ordered
            .map((point, pointIndex) => `${pointIndex === 0 ? "M" : "L"} ${xAt(point.x).toFixed(1)} ${yAt(point.y).toFixed(1)}`)
            .join(" ");
          const color = chartFill(index);
          return (
            <g key={item.name}>
              <path d={d} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
              {ordered.map((point) => (
                <circle key={`${item.name}-${point.x}`} cx={xAt(point.x)} cy={yAt(point.y)} r={3.2} fill={color}>
                  <title>
                    {item.name} {point.x}: {currency ? formatCurrencyAmount(currency, point.y) : point.y}
                  </title>
                </circle>
              ))}
            </g>
          );
        })}
        {xs.map((value, index) =>
          index % labelStep === 0 ? (
            <text key={value} x={xAt(value)} y={height - 8} textAnchor="middle" fill="var(--chart-axis)" fontSize={11}>
              {shortBucket(value)}
            </text>
          ) : null,
        )}
      </svg>
    </div>
  );
}

export function MoneyBarChart({
  rows,
  currency,
}: {
  rows: { label: string; value: number }[];
  currency: Currency;
}) {
  const drawn = rows.filter((row) => row.value !== 0);
  if (drawn.length === 0) {
    return <p className="text-[15px] text-[var(--muted-fg)]">Sin datos para el gráfico.</p>;
  }
  const max = Math.max(...drawn.map((row) => Math.abs(row.value)), 1);
  const slot = 46;
  const width = Math.max(280, drawn.length * slot + 24);
  const height = 200;
  const pad = { l: 8, r: 8, t: 12, b: 36 };
  const inner = height - pad.t - pad.b;
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="block h-auto max-w-none" role="img" aria-label="Ingresos por mes">
        {drawn.map((row, index) => {
          const barHeight = (Math.abs(row.value) / max) * (inner - 8);
          const x = pad.l + index * slot + 8;
          const y = pad.t + inner - barHeight;
          return (
            <g key={row.label}>
              <rect x={x} y={y} width={28} height={Math.max(barHeight, 1)} rx={6} fill={chartFill(index % 3)}>
                <title>
                  {row.label}: {formatCurrencyAmount(currency, row.value)}
                </title>
              </rect>
              <text x={x + 14} y={height - 12} textAnchor="middle" fill="var(--chart-axis)" fontSize={11}>
                {row.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function axisLabel(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1000) return `${Math.round(value / 1000)}k`;
  return String(Math.round(value));
}

function shortBucket(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value.slice(8, 10)}/${value.slice(5, 7)}`;
  if (/^\d{4}-\d{2}$/.test(value)) return `${value.slice(5, 7)}/${value.slice(2, 4)}`;
  return value;
}

export function formatBucket(value: string, granularity: "day" | "week" | "month" | "all"): string {
  if (granularity === "month" || granularity === "all") return formatMonth(value);
  if (granularity === "week") return `Semana del ${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}`;
  return value;
}

export function formatMonth(ym: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!match) return ym;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const name = new Intl.DateTimeFormat("es-AR", { month: "short" }).format(new Date(year, month - 1, 1));
  return `${name} ${String(year).slice(2)}`;
}
