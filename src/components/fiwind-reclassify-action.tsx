"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

type Result = {
  updated: number;
  alreadyOk: number;
  scanned: number;
  message: string;
};

export function FiwindReclassifyAction({
  compact = false,
}: {
  compact?: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/household/reclassify-fiwind", {
        method: "POST",
        credentials: "include",
      });
      const data = (await res.json().catch(() => null)) as
        | (Result & { error?: string })
        | null;
      if (!res.ok) {
        setError(data?.error || `Error ${res.status}`);
        return;
      }
      setResult({
        updated: data?.updated ?? 0,
        alreadyOk: data?.alreadyOk ?? 0,
        scanned: data?.scanned ?? 0,
        message: data?.message || "Listo.",
      });
      window.dispatchEvent(new Event("lc:card-imported"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={compact ? "space-y-1.5" : "space-y-2"}>
      <p
        className={
          compact
            ? "text-[13px] leading-relaxed text-[var(--muted-fg)]"
            : "text-sm text-zinc-500"
        }
      >
        Un Excel nuevo se clasifica al importar. Re-importar el mismo archivo no
        toca filas viejas. Si ya hay{" "}
        <span className="font-medium text-[var(--foreground)]">
          TRANSFERENCIA ARS
        </span>{" "}
        o montos sueltos (12800, 79.66) en Consumos, esto los saca de gastos.
        No borra nada.
      </p>
      <button
        type="button"
        onClick={() => void run()}
        disabled={loading}
        className={
          compact
            ? "lc-btn lc-btn-ghost !px-3 !py-1.5 text-xs disabled:opacity-60"
            : "rounded-xl border border-zinc-200 px-3 py-2 text-sm font-medium hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-900"
        }
      >
        {loading ? (
          <span className="inline-flex items-center gap-1.5">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Reclasificando…
          </span>
        ) : (
          "Reclasificar ruido Fiwind"
        )}
      </button>
      {error && (
        <p className="text-sm text-red-600 dark:text-red-300">{error}</p>
      )}
      {result && (
        <p
          className={
            compact
              ? "text-[13px] text-[var(--foreground)]"
              : "text-sm text-zinc-700 dark:text-zinc-200"
          }
        >
          {result.message}
        </p>
      )}
    </div>
  );
}
