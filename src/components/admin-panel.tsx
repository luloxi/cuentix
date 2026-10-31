"use client";

import { useCallback, useEffect, useState } from "react";
import { FiwindReclassifyAction } from "@/components/fiwind-reclassify-action";

type AllowedRow = {
  email: string;
  createdAt: string | null;
  source: "admin" | "db" | "env";
};

export function AdminPanel() {
  const [emails, setEmails] = useState<AllowedRow[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/admin/allowed-emails", {
        credentials: "include",
      });
      const data = (await res.json().catch(() => null)) as {
        emails?: AllowedRow[];
        error?: string;
      } | null;
      if (!res.ok) {
        setError(data?.error || `Error ${res.status}`);
        return;
      }
      setEmails(data?.emails ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function addEmail(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/allowed-emails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: input.trim() }),
      });
      const data = (await res.json().catch(() => null)) as {
        emails?: AllowedRow[];
        error?: string;
      } | null;
      if (!res.ok) {
        setError(data?.error || `Error ${res.status}`);
        return;
      }
      setEmails(data?.emails ?? []);
      setInput("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error de red");
    } finally {
      setSaving(false);
    }
  }

  async function removeEmail(email: string) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/allowed-emails", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email }),
      });
      const data = (await res.json().catch(() => null)) as {
        emails?: AllowedRow[];
        error?: string;
      } | null;
      if (!res.ok) {
        setError(data?.error || `Error ${res.status}`);
        return;
      }
      setEmails(data?.emails ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error de red");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-zinc-500">Cargando…</p>;
  }

  return (
    <div className="space-y-6">
      <form
        onSubmit={(e) => void addEmail(e)}
        className="flex flex-col gap-2 sm:flex-row"
      >
        <input
          type="email"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="persona@gmail.com"
          className="flex-1 rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          disabled={saving}
          required
        />
        <button
          type="submit"
          disabled={saving || !input.trim()}
          className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          {saving ? "Guardando…" : "Habilitar acceso"}
        </button>
      </form>

      {error && (
        <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </p>
      )}

      <div className="overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-zinc-50 text-xs uppercase text-zinc-500 dark:bg-zinc-900">
            <tr>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Origen</th>
              <th className="px-4 py-3 font-medium" />
            </tr>
          </thead>
          <tbody>
            {emails.map((row) => (
              <tr
                key={row.email}
                className="border-t border-zinc-100 dark:border-zinc-800"
              >
                <td className="px-4 py-3 font-medium">{row.email}</td>
                <td className="px-4 py-3 text-zinc-500">
                  {row.source === "admin"
                    ? "Admin (fijo)"
                    : row.source === "env"
                      ? "Env"
                      : "Lista"}
                </td>
                <td className="px-4 py-3 text-right">
                  {row.source === "db" ? (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void removeEmail(row.email)}
                      className="text-xs text-red-600 hover:underline disabled:opacity-50"
                    >
                      Quitar
                    </button>
                  ) : (
                    <span className="text-xs text-zinc-400">—</span>
                  )}
                </td>
              </tr>
            ))}
            {emails.length === 0 && (
              <tr>
                <td
                  colSpan={3}
                  className="px-4 py-6 text-center text-zinc-500"
                >
                  Nadie más habilitado todavía.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-zinc-500">
        Solo las cuentas en esta lista pueden iniciar sesión con Google. El
        administrador siempre tiene acceso.
      </p>

      <div className="rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
        <h2 className="font-semibold">Ruido Fiwind</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Aplica al hogar de esta sesión. No aparece en el menú.
        </p>
        <div className="mt-3">
          <FiwindReclassifyAction />
        </div>
      </div>
    </div>
  );
}
