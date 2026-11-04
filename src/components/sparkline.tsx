"use client";

import { useId } from "react";

/**
 * Línea simple con relleno suave. Sin ejes ni números: solo la tendencia.
 * El color sale de la paleta (`--chart-1` por defecto) y en oscuro lleva un brillo leve.
 */
export function Sparkline({
  values,
  height = 72,
  color = "var(--chart-1)",
  label,
  className,
}: {
  values: number[];
  height?: number;
  color?: string;
  label: string;
  className?: string;
}) {
  const gid = useId().replace(/:/g, "");
  const width = 320;
  const pad = 6;
  if (values.length < 2) return null;
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const span = max - min;
  const x = (i: number) => pad + (i / (values.length - 1)) * (width - pad * 2);
  const y = (v: number) => pad + (1 - (v - min) / span) * (height - pad * 2);
  const line = values
    .map((v, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`)
    .join(" ");
  const area = `${line} L ${x(values.length - 1).toFixed(1)} ${height} L ${x(0).toFixed(1)} ${height} Z`;
  const last = values.length - 1;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={className ?? "block h-auto w-full"}
      role="img"
      aria-label={label}
    >
      <defs>
        <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        className="lc-spark-line"
      />
      <circle cx={x(last)} cy={y(values[last]!)} r="4" fill={color} className="lc-spark-dot" />
    </svg>
  );
}
