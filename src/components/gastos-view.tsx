"use client";

import { useState } from "react";
import { useApi } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import type { Currency } from "@/lib/sql";
import { CurrencyPicker, LoadError, Loading, TotalLine } from "./bits";
import { Legend, PieChart, chartColor } from "./charts";

interface SpendingResponse {
  currency: Currency;
  total: number;
  rows: { category: string; count: number; total: number }[];
}

export function GastosView() {
  const [currency, setCurrency] = useState<Currency>("ARS");
  const { data, error, loading, reload } = useApi<SpendingResponse>(`/api/spending-by-category?days=90&currency=${currency}`);

  return (
    <section>
      <header className="page-head">
        <div>
          <h1>Gastos</h1>
          <p className="lede">Últimos 90 días, solo gastos. El día 90 entra y el 91 no. Los reintegros restan. Las transferencias internas no se suman.</p>
        </div>
        <CurrencyPicker value={currency} onChange={setCurrency} />
      </header>
      {loading ? <Loading /> : null}
      {error ? <LoadError onRetry={reload} /> : null}
      {data ? (
        <>
          <TotalLine label="Total" value={formatMoney(data.total, data.currency)} />
          <div className="split">
            <PieChart slices={data.rows.map((row) => ({ label: row.category, value: row.total }))} />
            <Legend items={data.rows.filter((row) => row.total > 0).map((row) => ({ name: row.category }))} />
          </div>
          <div className="table-wrap">
            <table>
              <caption>Gasto por categoría</caption>
              <thead>
                <tr>
                  <th>Categoría</th>
                  <th className="num">Cantidad</th>
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.length === 0 ? (
                  <tr>
                    <td colSpan={3}>No hay gastos en {data.currency} en esta ventana.</td>
                  </tr>
                ) : (
                  data.rows.map((row, index) => (
                    <tr key={row.category}>
                      <td>
                        <span className="swatch" style={{ background: chartColor(index) }} />
                        {row.category}
                      </td>
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
