"use client";

import { useEffect, useState } from "react";
import { formatArs } from "@/lib/utils";

type Member = {
  userId: string;
  name: string | null;
  email: string | null;
  role: string;
};

export function GroupPanel({
  inviteCode,
  members,
}: {
  inviteCode: string;
  members: Member[];
}) {
  const [balance, setBalance] = useState<{
    period: string;
    byUser: Record<string, number>;
  } | null>(null);

  useEffect(() => {
    fetch("/api/stats/mes-a-mes", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        if (d.sharedBalance) setBalance(d.sharedBalance);
        else if (d.coupleBalance) setBalance(d.coupleBalance);
      })
      .catch(() => {});
  }, []);

  const totals = members.map((m) => ({
    ...m,
    paid: balance?.byUser[m.userId] ?? 0,
  }));
  const sum = totals.reduce((s, t) => s + t.paid, 0);
  const fair = members.length > 0 ? sum / members.length : 0;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
        <h2 className="font-semibold">Código de invitación</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Compartilo con quien quieras que sume gastos a este espacio.
        </p>
        <div className="mt-3 rounded-xl bg-zinc-100 px-4 py-3 text-center font-mono text-2xl tracking-[0.3em] dark:bg-zinc-900">
          {inviteCode}
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
        <h2 className="font-semibold">Miembros</h2>
        <ul className="mt-3 space-y-2">
          {members.map((m) => (
            <li
              key={m.userId}
              className="flex items-center justify-between rounded-lg bg-zinc-50 px-3 py-2 text-sm dark:bg-zinc-900"
            >
              <span>
                {m.name || m.email || m.userId}
                <span className="ml-2 text-xs text-zinc-500">{m.role}</span>
              </span>
            </li>
          ))}
          {members.length === 1 && (
            <li className="text-sm text-zinc-500">
              Todavía no hay otras personas en este espacio.
            </li>
          )}
        </ul>
      </div>

      {balance && members.length > 1 && (
        <div className="rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
          <h2 className="font-semibold">
            Balance compartido · {balance.period}
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            Gastos marcados como compartidos, divididos en partes iguales entre
            los miembros.
          </p>
          <ul className="mt-4 space-y-2 text-sm">
            {totals.map((t) => {
              const delta = t.paid - fair;
              return (
                <li
                  key={t.userId}
                  className="flex items-center justify-between border-b border-zinc-100 py-2 dark:border-zinc-800"
                >
                  <span>{t.name || t.email}</span>
                  <span className="text-right">
                    <div className="font-medium tabular-nums">
                      pagó {formatArs(t.paid)}
                    </div>
                    <div
                      className={`text-xs ${
                        Math.abs(delta) < 1
                          ? "text-zinc-500"
                          : delta > 0
                            ? "text-emerald-600"
                            : "text-amber-600"
                      }`}
                    >
                      {Math.abs(delta) < 1
                        ? "equilibrado"
                        : delta > 0
                          ? `le deben ${formatArs(delta)}`
                          : `debe ${formatArs(-delta)}`}
                    </div>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
