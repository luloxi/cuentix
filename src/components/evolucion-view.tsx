"use client";

import { useState } from "react";
import { useApi } from "@/lib/api";
import { formatMoney, formatMonth } from "@/lib/format";
import type { Currency } from "@/lib/sql";
import { CurrencyPicker, LoadError, Loading } from "./bits";
import { LineChart } from "./charts";

type Granularity = "day" | "week" | "month" | "all";

const OPTIONS: { id: Granularity; label: string; note: string }[] = [
  { id: "day", label: "Día", note: "Últimos 90 días, un punto por día con gasto." },
  { id: "week", label: "Semana", note: "Últimas 26 semanas. Cada semana empieza el lunes." },
  { id: "month", label: "Mes", note: "Últimos 24 meses, un punto por mes." },
  {
    id: "all",
    label: "Todo el historial",
    note: "Un punto por mes desde el primer gasto. No es un acumulado: cada punto es el gasto de ese mes.",
  },
];

interface SeriesResponse {
  currency: Currency;
  granularity: Granularity;
  rows: { bucket: string; count: number; total: number }[];
}

export function EvolucionView() {
  const [currency, setCurrency] = useState<Currency>("ARS");
  const [granularity, setGranularity] = useState<Granularity>("month");
  const { data, error, loading, reload } = useApi<SeriesResponse>(
    `/api/spending-series?granularity=${granularity}&currency=${currency}`,
  );
  const option = OPTIONS.find((item) => item.id === granularity)!;

  return (
    <section>
      <header className="page-head">
        <div>
          <h1>Evolución</h1>
          <p className="lede">Gasto en el tiempo. Solo gastos, una moneda por vez. {option.note}</p>
        </div>
        <CurrencyPicker value={currency} onChange={setCurrency} />
      </header>
      <div className="segmented wrap" role="group" aria-label="Granularidad">
        {OPTIONS.map((item) => (
          <button key={item.id} type="button" className={granularity === item.id ? "on" : ""} aria-pressed={granularity === item.id} onClick={() => setGranularity(item.id)}>
            {item.label}
          </button>
        ))}
      </div>
      {loading ? <p className="status">Cargando…</p> : null}
      {error ? <LoadError onRetry={reload} /> : null}
      {data ? (
        <>
          <LineChart
            ariaLabel="Evolución del gasto"
            series={[
              {
                name: data.currency,
                points: data.rows.map((row) => ({ x: row.bucket, y: row.total })),
              },
            ]}
          />
          <div className="table-wrap">
            <table>
              <caption>Serie de gasto</caption>
              <thead>
                <tr>
                  <th>Período</th>
                  <th className="num">Cantidad</th>
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.length === 0 ? (
                  <tr>
                    <td colSpan={3}>No hay gastos en {data.currency} para esta vista.</td>
                  </tr>
                ) : (
                  data.rows.map((row) => (
                    <tr key={row.bucket}>
                      <td>{granularity === "month" || granularity === "all" ? formatMonth(row.bucket) : row.bucket}</td>
                      <td className="num">{row.count}</td>
                      <td className="num">{formatMoney(row.total, data.currency)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </section>
  );
}
