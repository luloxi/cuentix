"use client";

import { CURRENCY_LIST } from "@/lib/format";
import type { Currency } from "@/lib/sql";

export function CurrencyPicker({ value, onChange }: { value: Currency; onChange: (currency: Currency) => void }) {
  return (
    <div className="segmented" role="group" aria-label="Moneda">
      {CURRENCY_LIST.map((currency) => (
        <button key={currency} type="button" aria-pressed={value === currency} className={value === currency ? "on" : ""} onClick={() => onChange(currency)}>
          {currency}
        </button>
      ))}
    </div>
  );
}

export function Loading() {
  return <p className="status">Cargando…</p>;
}

export function LoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="status">
      <p>No pudimos cargar los datos.</p>
      <button type="button" onClick={onRetry}>
        Reintentar
      </button>
    </div>
  );
}

export function TotalLine({ label, value }: { label: string; value: string }) {
  return (
    <p className="total">
      <span>{label}</span>
      <strong>{value}</strong>
    </p>
  );
}
