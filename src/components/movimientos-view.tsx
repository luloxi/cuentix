"use client";

import { useMemo, useState } from "react";
import { useApi } from "@/lib/api";
import { formatDate, formatMoney, kindLabel } from "@/lib/format";
import type { Currency } from "@/lib/sql";

interface Row {
  id: number;
  date: string;
  amount: number;
  currency: string;
  account: string;
  category: string;
  description: string;
  kind: string;
}

interface Page {
  rows: Row[];
  nextCursor: string | null;
}

const KINDS = [
  { id: "", label: "Todos" },
  { id: "expense", label: "Gasto" },
  { id: "income", label: "Ingreso" },
  { id: "internal_transfer", label: "Transferencia interna" },
] as const;

export function MovimientosView() {
  const [kind, setKind] = useState("");
  const [currency, setCurrency] = useState<"" | Currency>("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [stack, setStack] = useState<Array<string | null>>([]);

  const path = useMemo(() => {
    const params = new URLSearchParams();
    if (kind) params.set("kind", kind);
    if (currency) params.set("currency", currency);
    if (cursor) params.set("cursor", cursor);
    const query = params.toString();
    return query ? `/api/transactions?${query}` : "/api/transactions";
  }, [kind, currency, cursor]);

  const { data, error, loading, reload } = useApi<Page>(path);

  function changeFilters(nextKind: string, nextCurrency: "" | Currency) {
    setKind(nextKind);
    setCurrency(nextCurrency);
    setCursor(null);
    setStack([]);
  }

  return (
    <section>
      <header className="page-head">
        <div>
          <h1>Movimientos</h1>
          <p className="lede">Los más nuevos primero, de a 50. Las transferencias internas se ven aparte y no entran en ningún total.</p>
        </div>
      </header>
      <div className="filters">
        <div className="segmented wrap" role="group" aria-label="Tipo">
          {KINDS.map((item) => (
            <button key={item.id || "all"} type="button" className={kind === item.id ? "on" : ""} aria-pressed={kind === item.id} onClick={() => changeFilters(item.id, currency)}>
              {item.label}
            </button>
          ))}
        </div>
        <div className="segmented" role="group" aria-label="Moneda">
          {(["", "ARS", "USDT", "USD"] as const).map((item) => (
            <button key={item || "any"} type="button" className={currency === item ? "on" : ""} aria-pressed={currency === item} onClick={() => changeFilters(kind, item)}>
              {item || "Todas"}
            </button>
          ))}
        </div>
      </div>
      {loading ? <p className="status">Cargando…</p> : null}
      {error ? (
        <div className="status">
          <p>No pudimos cargar los movimientos.</p>
          <button type="button" onClick={reload}>
            Reintentar
          </button>
        </div>
      ) : null}
      {data ? (
        <>
          <div className="table-wrap">
            <table>
              <caption>Listado de movimientos</caption>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Detalle</th>
                  <th className="num">Importe</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.length === 0 ? (
                  <tr>
                    <td colSpan={3}>No hay movimientos con este filtro.</td>
                  </tr>
                ) : (
                  data.rows.map((row) => (
                    <tr key={row.id} className={row.kind === "internal_transfer" ? "row-transfer" : undefined}>
                      <td>{formatDate(row.date)}</td>
                      <td>
                        <span className={row.kind === "internal_transfer" ? "badge transfer" : "badge"}>{kindLabel(row.kind)}</span>
                        <span className="desc">{row.description}</span>
                        <span className="meta">
                          {row.account} · {row.category}
                        </span>
                      </td>
                      <td className="num">{formatMoney(row.amount, row.currency)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="pager">
            <button
              type="button"
              disabled={stack.length === 0}
              onClick={() => {
                const previous = stack[stack.length - 1] ?? null;
                setStack((value) => value.slice(0, -1));
                setCursor(previous);
              }}
            >
              Anteriores
            </button>
            <button
              type="button"
              disabled={!data.nextCursor}
              onClick={() => {
                if (!data.nextCursor) return;
                setStack((value) => [...value, cursor]);
                setCursor(data.nextCursor);
              }}
            >
              Siguientes
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}
