"use client";

import { useState } from "react";
import { useApi } from "@/lib/api";
import { formatMoney, formatMonth } from "@/lib/format";
import type { Currency } from "@/lib/sql";
import { CurrencyPicker, LoadError, Loading, TotalLine } from "./bits";
import { BarChart } from "./charts";

interface IncomeResponse {
  currency: Currency;
  total: number;
  rows: { month: string; count: number; total: number }[];
}

export function IngresosView() {
  const [currency, setCurrency] = useState<Currency>("ARS");
  const { data, error, loading, reload } = useApi<IncomeResponse>(`/api/income-by-month?currency=${currency}`);

  return (
    <section>
      <header className="page-head">
        <div>
          <h1>Ingresos</h1>
          <p className="lede">Por mes, solo ingresos. Las transferencias internas no entran en este total.</p>
        </div>
        <CurrencyPicker value={currency} onChange={setCurrency} />
      </header>
      {loading ? <Loading /> : null}
      {error ? <LoadError onRetry={reload} /> : null}
      {data ? (
        <>
          <TotalLine label="Total" value={formatMoney(data.total, data.currency)} />
          <BarChart rows={data.rows.map((row) => ({ label: formatMonth(row.month), value: row.total }))} />
          <div className="table-wrap">
            <table>
              <caption>Ingresos por mes</caption>
              <thead>
                <tr>
                  <th>Mes</th>
                  <th className="num">Cantidad</th>
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.length === 0 ? (
                  <tr>
                    <td colSpan={3}>No hay ingresos en {data.currency}.</td>
                  </tr>
                ) : (
                  data.rows.map((row) => (
                    <tr key={row.month}>
                      <td>{formatMonth(row.month)}</td>
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
