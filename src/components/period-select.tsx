"use client";

import { formatPeriodLabel } from "@/lib/period-label";

/**
 * Period dropdown: "Todos los meses" always first, then YYYY-MM options.
 * value "" or "all" = all months (caller convention).
 */
export function PeriodSelect({
  value,
  periods,
  onChange,
  allValue = "",
  className = "lc-input",
}: {
  value: string;
  periods: string[];
  onChange: (value: string) => void;
  /** Value used for "all months" — "" in Gastos, "all" in Análisis/Hogar */
  allValue?: string;
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={className}
    >
      <option value={allValue}>Todos los meses</option>
      {periods.map((p) => (
        <option key={p} value={p}>
          {formatPeriodLabel(p)}
        </option>
      ))}
    </select>
  );
}
