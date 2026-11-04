"use client";

import { useEffect, useMemo, useState } from "react";
import { apiPost, useApi } from "@/lib/api";
import { buenosAiresToday } from "@/lib/dates";
import { formatDate, formatMoney, parseAmountInput, sourceLabel } from "@/lib/format";
import type { Currency } from "@/lib/sql";
import { CurrencyPicker, LoadError, Loading } from "./bits";
import { Legend, LineChart } from "./charts";

interface BalanceResponse {
  today: string;
  currency: Currency;
  latest: { account: string; currency: string; amount: number; date: string; source: string }[];
  totals: { currency: string; total: number }[];
  series: { account: string; date: string; amount: number }[];
  accounts: string[];
}

export function SaldosView() {
  const [currency, setCurrency] = useState<Currency>("ARS");
  const { data, error, loading, reload } = useApi<BalanceResponse>(`/api/balances?currency=${currency}`);

  const series = useMemo(() => {
    if (!data) return [];
    const names = [...new Set(data.series.map((point) => point.account))];
    return names.map((name) => ({
      name,
      points: data.series.filter((point) => point.account === name).map((point) => ({ x: point.date, y: point.amount })),
    }));
  }, [data]);

  return (
    <section>
      <header className="page-head">
        <div>
          <h1>Saldos</h1>
          <p className="lede">Último saldo de cada cuenta. ARS, USDT y USD se muestran aparte, sin conversión.</p>
        </div>
      </header>
      {loading ? <Loading /> : null}
      {error ? <LoadError onRetry={reload} /> : null}
      {data ? (
        <>
          <div className="totals">
            {(["ARS", "USDT", "USD"] as const).map((code) => {
              const found = data.totals.find((item) => item.currency === code);
              return (
                <article key={code} className="total-card">
                  <span>{code}</span>
                  <strong>{found ? formatMoney(found.total, code) : "Sin datos"}</strong>
                </article>
              );
            })}
          </div>
          <div className="table-wrap">
            <table>
              <caption>Último saldo por cuenta y moneda</caption>
              <thead>
                <tr>
                  <th>Cuenta</th>
                  <th>Moneda</th>
                  <th className="num">Saldo</th>
                  <th>Fecha</th>
                  <th>Origen</th>
                </tr>
              </thead>
              <tbody>
                {data.latest.length === 0 ? (
                  <tr>
                    <td colSpan={5}>Todavía no hay saldos cargados.</td>
                  </tr>
                ) : (
                  data.latest.map((row) => (
                    <tr key={`${row.account}-${row.currency}`}>
                      <td>{row.account}</td>
                      <td>{row.currency}</td>
                      <td className="num">{formatMoney(row.amount, row.currency)}</td>
                      <td>{formatDate(row.date)}</td>
                      <td>{sourceLabel(row.source)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <h2>Evolución del saldo</h2>
          <CurrencyPicker value={currency} onChange={setCurrency} />
          <LineChart series={series} ariaLabel="Saldo por cuenta" />
          <Legend items={series} />
          <BalanceForm accounts={data.accounts} onSaved={reload} />
        </>
      ) : null}
    </section>
  );
}

function BalanceForm({ accounts, onSaved }: { accounts: string[]; onSaved: () => void }) {
  const [choice, setChoice] = useState(accounts[0] ?? "__new__");
  const [custom, setCustom] = useState("");
  const [currency, setCurrency] = useState<Currency>("ARS");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  useEffect(() => {
    setDate(buenosAiresToday());
  }, []);

  useEffect(() => {
    if (choice !== "__new__" && accounts.length > 0 && !accounts.includes(choice)) {
      setChoice(accounts[0] ?? "__new__");
    }
  }, [accounts, choice]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const account = choice === "__new__" ? custom.trim() : choice;
    const parsed = parseAmountInput(amount);
    if (!account || account.length > 60) {
      setOk(false);
      setMessage("La cuenta tiene que tener entre 1 y 60 caracteres.");
      return;
    }
    if (parsed === null) {
      setOk(false);
      setMessage("El importe no es un número.");
      return;
    }
    setPending(true);
    setMessage(null);
    try {
      await apiPost("/api/balances/manual", { account, currency, amount: parsed, date: date || undefined });
      setOk(true);
      setMessage("Saldo guardado.");
      setAmount("");
      onSaved();
    } catch (error) {
      setOk(false);
      setMessage(error instanceof Error && error.message !== "401" ? "No se pudo guardar el saldo." : "Tenés que entrar de nuevo.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="card" onSubmit={(event) => void submit(event)}>
      <h2>Cargar saldo</h2>
      <p className="lede">Único dato que se escribe desde acá. Se guarda como origen manual.</p>
      <label>
        Cuenta
        <select value={choice} onChange={(event) => setChoice(event.target.value)}>
          {accounts.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
          <option value="__new__">Nueva cuenta…</option>
        </select>
      </label>
      {choice === "__new__" ? (
        <label>
          Nombre
          <input value={custom} onChange={(event) => setCustom(event.target.value)} maxLength={60} required />
        </label>
      ) : null}
      <label>
        Moneda
        <select value={currency} onChange={(event) => setCurrency(event.target.value as Currency)}>
          <option value="ARS">ARS</option>
          <option value="USDT">USDT</option>
          <option value="USD">USD</option>
        </select>
      </label>
      <label>
        Importe
        <input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} required placeholder="0,00" />
      </label>
      <label>
        Fecha
        <input type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
      </label>
      <button type="submit" disabled={pending}>
        {pending ? "Guardando…" : "Guardar saldo"}
      </button>
      {message ? <p className={ok ? "note ok" : "note bad"}>{message}</p> : null}
    </form>
  );
}
