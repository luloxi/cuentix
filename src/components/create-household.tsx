"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Home, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  className?: string;
  /** Compact pill matching Invitar on Hogar. */
  variant?: "pill" | "menu";
};

export function CreateHouseholdButton({ className, variant = "pill" }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    const trimmed = name.trim();
    if (!trimmed || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/household", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          action: "create",
          name: trimmed,
          additional: true,
        }),
      });
      const data = (await res.json().catch(() => null)) as {
        error?: string;
        household?: { household?: { id?: string; name?: string } };
      } | null;
      if (!res.ok) {
        setError(data?.error || `Error ${res.status}`);
        return;
      }
      setOpen(false);
      setName("");
      router.refresh();
      window.dispatchEvent(new Event("lc:household-switched"));
      window.dispatchEvent(new Event("lc:household-created"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className={cn(
          variant === "pill"
            ? "inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-xs font-semibold text-[var(--muted-fg)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]"
            : "inline-flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-[var(--muted-fg)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]",
          className,
        )}
      >
        <Plus className="h-3.5 w-3.5" />
        Nuevo hogar
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-hogar-title"
        >
          <button
            type="button"
            className="absolute inset-0 bg-[#121110]/55 backdrop-blur-[2px]"
            aria-label="Cerrar"
            onClick={() => !loading && setOpen(false)}
          />
          <div className="relative z-10 w-full max-w-sm overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand-fg)]">
                  <Home className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--muted-fg)]">
                    Hogar
                  </p>
                  <h2
                    id="create-hogar-title"
                    className="mt-0.5 text-lg font-semibold tracking-tight"
                  >
                    Nuevo hogar
                  </h2>
                </div>
              </div>
              <button
                type="button"
                disabled={loading}
                onClick={() => setOpen(false)}
                className="rounded-full p-1.5 text-[var(--muted-fg)] hover:bg-[var(--surface-muted)] disabled:opacity-60"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <p className="mt-3 text-sm leading-relaxed text-[var(--muted-fg)]">
              Creá otro espacio con su propio nombre (trabajo, unipersonal,
              etc.). Los datos quedan aislados. Invitar es opcional después.
            </p>

            <label className="mt-4 block space-y-1.5">
              <span className="text-xs font-medium text-[var(--muted-fg)]">
                Nombre
              </span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="lc-input w-full"
                placeholder="Ej. Trabajo, Solo, Oficina"
                maxLength={80}
                disabled={loading}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void create();
                  }
                }}
              />
            </label>

            {error && (
              <p className="mt-3 rounded-xl border border-red-200 bg-red-50 p-2.5 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
                {error}
              </p>
            )}

            <button
              type="button"
              disabled={loading || name.trim().length === 0}
              onClick={() => void create()}
              className="lc-btn lc-btn-primary mt-4 w-full"
            >
              {loading ? "Creando…" : "Crear hogar"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
