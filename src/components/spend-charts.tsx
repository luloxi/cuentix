"use client";

import { useMemo, useState } from "react";
import { formatArs } from "@/lib/utils";
import { formatPeriodShort } from "@/lib/period-label";
import { colorForCategory } from "@/lib/category-colors";

type TotalPoint = { period: string; amountArs: number };
type CatSeries = {
  slug: string;
  name: string;
  series: Array<{ period: string; amountArs: number }>;
  totalArs: number;
};

const W = 720;
const H = 260;
const PAD = { top: 20, right: 16, bottom: 36, left: 56 };

/** Chart ceiling: 10% above the tallest data point (not a large "nice" round). */
function chartMax(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 1;
  return v * 1.1;
}

function scaleX(i: number, n: number, width: number) {
  if (n <= 1) return PAD.left + width / 2;
  return PAD.left + (i / (n - 1)) * width;
}

function scaleY(v: number, max: number, height: number) {
  return PAD.top + height - (v / max) * height;
}

function linePath(
  points: Array<{ x: number; y: number }>,
): string {
  if (points.length === 0) return "";
  return points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");
}

export function TotalSpendChart({
  totals,
  ariaLabel = "Evolución del gasto total por mes",
  gradientPrefix = "total",
}: {
  totals: TotalPoint[];
  ariaLabel?: string;
  /** Unique SVG gradient id prefix when multiple charts share a page. */
  gradientPrefix?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;
  const fillId = `${gradientPrefix}Fill`;
  const strokeId = `${gradientPrefix}Stroke`;

  const max = useMemo(
    () => chartMax(Math.max(...totals.map((t) => t.amountArs), 0)),
    [totals],
  );

  if (totals.length === 0) {
    return (
      <p className="text-sm text-zinc-500">Sin datos para graficar.</p>
    );
  }

  const points = totals.map((t, i) => ({
    ...t,
    x: scaleX(i, totals.length, chartW),
    y: scaleY(t.amountArs, max, chartH),
  }));

  const gridYs = [0, 0.25, 0.5, 0.75, 1].map((f) => ({
    y: PAD.top + chartH * (1 - f),
    label: max * f,
  }));

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label={ariaLabel}
      >
        {gridYs.map((g) => (
          <g key={g.y}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={g.y}
              y2={g.y}
              stroke="currentColor"
              className="text-zinc-200 dark:text-zinc-800"
              strokeWidth={1}
            />
            <text
              x={PAD.left - 8}
              y={g.y + 4}
              textAnchor="end"
              className="fill-zinc-400 text-[10px]"
            >
              {g.label >= 1_000_000
                ? `${(g.label / 1_000_000).toFixed(1)}M`
                : g.label >= 1000
                  ? `${Math.round(g.label / 1000)}k`
                  : Math.round(g.label)}
            </text>
          </g>
        ))}

        <defs>
          <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10b981" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={strokeId} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#059669" />
            <stop offset="100%" stopColor="#14b8a6" />
          </linearGradient>
        </defs>
        <path
          d={`${linePath(points)} L ${points[points.length - 1]!.x} ${PAD.top + chartH} L ${points[0]!.x} ${PAD.top + chartH} Z`}
          fill={`url(#${fillId})`}
        />
        <path
          d={linePath(points)}
          fill="none"
          stroke={`url(#${strokeId})`}
          strokeWidth={2.75}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {points.map((p, i) => (
          <g key={p.period}>
            <circle
              cx={p.x}
              cy={p.y}
              r={hover === i ? 5.5 : 3.5}
              fill="#059669"
              stroke="white"
              strokeWidth={1.5}
              className="cursor-pointer"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            />
            {/* wider hit area */}
            <circle
              cx={p.x}
              cy={p.y}
              r={14}
              fill="transparent"
              className="cursor-pointer"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            />
            <text
              x={p.x}
              y={H - 12}
              textAnchor="middle"
              className="fill-zinc-500 text-[10px]"
            >
              {formatPeriodShort(p.period)}
            </text>
          </g>
        ))}

        {hover != null && points[hover] && (
          <g>
            <line
              x1={points[hover].x}
              x2={points[hover].x}
              y1={PAD.top}
              y2={PAD.top + chartH}
              stroke="#059669"
              strokeDasharray="4 3"
              opacity={0.4}
            />
            <rect
              x={Math.min(points[hover].x + 8, W - 150)}
              y={Math.max(points[hover].y - 36, 4)}
              width={140}
              height={32}
              rx={6}
              className="fill-zinc-900 dark:fill-zinc-100"
              opacity={0.92}
            />
            <text
              x={Math.min(points[hover].x + 16, W - 142)}
              y={Math.max(points[hover].y - 16, 24)}
              className="fill-white text-[11px] dark:fill-zinc-900"
            >
              {formatPeriodShort(points[hover].period)} ·{" "}
              {formatArs(points[hover].amountArs)}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}

export function CategoryLinesChart({
  periods,
  byCategory,
}: {
  periods: string[];
  byCategory: CatSeries[];
}) {
  // Show top categories by default; rest off until toggled
  const topSlugs = useMemo(
    () => byCategory.slice(0, 6).map((c) => c.slug),
    [byCategory],
  );
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const c of byCategory) {
      init[c.slug] = topSlugs.includes(c.slug);
    }
    return init;
  });
  const [hover, setHover] = useState<{
    i: number;
    items: Array<{ slug: string; name: string; amount: number; color: string }>;
  } | null>(null);

  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;

  const active = byCategory.filter((c) => enabled[c.slug]);
  const max = useMemo(() => {
    let m = 0;
    for (const c of active) {
      for (const p of c.series) m = Math.max(m, p.amountArs);
    }
    return chartMax(m);
  }, [active]);

  if (periods.length === 0 || byCategory.length === 0) {
    return (
      <p className="text-sm text-zinc-500">Sin categorías para graficar.</p>
    );
  }

  const gridYs = [0, 0.25, 0.5, 0.75, 1].map((f) => ({
    y: PAD.top + chartH * (1 - f),
    label: max * f,
  }));

  function toggle(slug: string) {
    setEnabled((prev) => ({ ...prev, [slug]: !prev[slug] }));
  }

  function onHoverIndex(i: number | null) {
    if (i == null) {
      setHover(null);
      return;
    }
    const items = active
      .map((c) => {
        const amount = c.series[i]?.amountArs ?? 0;
        return {
          slug: c.slug,
          name: c.name,
          amount,
          color: colorForCategory(c.slug),
        };
      })
      .filter((x) => x.amount > 0)
      .sort((a, b) => b.amount - a.amount);
    setHover({ i, items });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {byCategory.map((c) => {
          const on = enabled[c.slug];
          const color = colorForCategory(c.slug);
          return (
            <button
              key={c.slug}
              type="button"
              onClick={() => toggle(c.slug)}
              className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition"
              style={{
                borderColor: on ? color : undefined,
                backgroundColor: on ? `${color}18` : undefined,
                opacity: on ? 1 : 0.45,
              }}
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: color }}
              />
              {c.name}
            </button>
          );
        })}
      </div>

      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full"
          role="img"
          aria-label="Gasto por categoría a lo largo de los meses"
          onMouseLeave={() => onHoverIndex(null)}
        >
          {gridYs.map((g) => (
            <g key={g.y}>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={g.y}
                y2={g.y}
                stroke="currentColor"
                className="text-zinc-200 dark:text-zinc-800"
                strokeWidth={1}
              />
              <text
                x={PAD.left - 8}
                y={g.y + 4}
                textAnchor="end"
                className="fill-zinc-400 text-[10px]"
              >
                {g.label >= 1_000_000
                  ? `${(g.label / 1_000_000).toFixed(1)}M`
                  : g.label >= 1000
                    ? `${Math.round(g.label / 1000)}k`
                    : Math.round(g.label)}
              </text>
            </g>
          ))}

          {active.map((c) => {
            const color = colorForCategory(c.slug);
            const pts = c.series.map((s, i) => ({
              x: scaleX(i, periods.length, chartW),
              y: scaleY(s.amountArs, max, chartH),
            }));
            return (
              <path
                key={c.slug}
                d={linePath(pts)}
                fill="none"
                stroke={color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            );
          })}

          {/* vertical hover strips */}
          {periods.map((p, i) => {
            const x = scaleX(i, periods.length, chartW);
            const half =
              periods.length <= 1
                ? chartW / 2
                : chartW / (periods.length - 1) / 2;
            return (
              <g key={p}>
                <rect
                  x={x - half}
                  y={PAD.top}
                  width={half * 2}
                  height={chartH}
                  fill="transparent"
                  onMouseEnter={() => onHoverIndex(i)}
                />
                <text
                  x={x}
                  y={H - 12}
                  textAnchor="middle"
                  className="fill-zinc-500 text-[10px]"
                >
                  {formatPeriodShort(p)}
                </text>
              </g>
            );
          })}

          {hover && periods[hover.i] && (
            <g>
              <line
                x1={scaleX(hover.i, periods.length, chartW)}
                x2={scaleX(hover.i, periods.length, chartW)}
                y1={PAD.top}
                y2={PAD.top + chartH}
                stroke="#71717a"
                strokeDasharray="4 3"
                opacity={0.5}
              />
            </g>
          )}
        </svg>

        {hover && periods[hover.i] && (
          <div
            className="pointer-events-none absolute z-10 min-w-[160px] rounded-lg border border-zinc-200 bg-white/95 p-2 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-900/95"
            style={{
              left: `min(${(scaleX(hover.i, periods.length, chartW) / W) * 100}%, calc(100% - 180px))`,
              top: 8,
            }}
          >
            <p className="mb-1 font-semibold capitalize">
              {formatPeriodShort(periods[hover.i]!)}
            </p>
            {hover.items.length === 0 ? (
              <p className="text-zinc-500">Sin gasto</p>
            ) : (
              <ul className="space-y-0.5">
                {hover.items.slice(0, 8).map((it) => (
                  <li
                    key={it.slug}
                    className="flex items-center justify-between gap-3"
                  >
                    <span className="flex items-center gap-1.5">
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: it.color }}
                      />
                      {it.name}
                    </span>
                    <span className="tabular-nums font-medium">
                      {formatArs(it.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
