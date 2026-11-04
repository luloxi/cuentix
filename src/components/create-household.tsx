"use client";

import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { Home, Plus, X } from "lucide-react";
import { normalizeHouseholdName, validateHouseholdName } from "@/lib/household-name";
import { cn } from "@/lib/utils";

type Props = {
  className?: string;
  /** Compact pill matching Invitar on Hogar. */
  variant?: "pill" | "menu";
};

export function CreateHouseholdButton({ className, variant = "pill" }: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);

  const nameCheck = validateHouseholdName(name, { allowPersonal: false });
  const showClientError =
    !nameCheck.ok && (attempted || normalizeHouseholdName(name).length > 0);

  function openModal() {
    setError(null);
    setAttempted(false);
    setOpen(true);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }

  function closeModal() {
    if (loading) return;
    setOpen(false);
  }

  async function create() {
    const parsed = validateHouseholdName(name, { allowPersonal: false });
    if (!parsed.ok || loading) {
      setAttempted(true);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/household", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          action: "create",
          name: parsed.name,
          additional: true,
        }),
      });
      const data = (await res.json().catch(() => null)) as {
        error?: string;
        household?: { household?: { id?: string; name?: string; inviteCode?: string } };
      } | null;
      if (!res.ok) {
        setError(data?.error || `Error ${res.status}`);
        return;
      }
      setOpen(false);
      setName("");
      setAttempted(false);
      router.refresh();
      window.dispatchEvent(new Event("lc:household-switched"));
      window.dispatchEvent(
        new CustomEvent("lc:household-created", {
          detail: {
            id: data?.household?.household?.id,
            name: data?.household?.household?.name,
            inviteCode: data?.household?.household?.inviteCode,
          },
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
    } finally {
      setLoading(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void create();
  }

  function onDialogKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      closeModal();
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className={cn(
          "cursor-pointer",
          variant === "pill"
            ? "inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-xs font-semibold text-[var(--muted-fg)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]"
            : "inline-flex min-h-11 w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-[var(--muted-fg)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]",
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
          onKeyDown={onDialogKeyDown}
        >
          <button
            type="button"
            className="absolute inset-0 cursor-pointer bg-[#121110]/55 backdrop-blur-[2px] disabled:cursor-not-allowed"
            aria-label="Cerrar"
            disabled={loading}
            onClick={closeModal}
          />
          <div className="relative z-10 max-h-[90dvh] w-full max-w-sm overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-2xl">
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
                onClick={closeModal}
                aria-label="Cerrar"
                className="min-h-11 min-w-11 cursor-pointer rounded-full p-1.5 text-[var(--muted-fg)] hover:bg-[var(--surface-muted)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <p className="mt-3 text-sm leading-relaxed text-[var(--muted-fg)]">
              Creá otro espacio con su propio nombre (trabajo, unipersonal,
              etc.). Los datos quedan aislados. Invitar es opcional después.
            </p>

            <form onSubmit={onSubmit}>
              <label htmlFor="create-hogar-name" className="mt-4 block space-y-1.5">
                <span className="text-xs font-medium text-[var(--muted-fg)]">
                  Nombre
                </span>
                <input
                  ref={inputRef}
                  id="create-hogar-name"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setError(null);
                  }}
                  className="lc-input min-h-11 w-full text-base"
                  placeholder="Ej. Trabajo, Solo, Oficina"
                  maxLength={60}
                  disabled={loading}
                  enterKeyHint="done"
                  autoComplete="off"
                  aria-invalid={showClientError || undefined}
                  aria-describedby={showClientError ? "create-hogar-error" : undefined}
                />
              </label>

              {showClientError && (
                <p id="create-hogar-error" className="mt-2 text-sm text-red-700 dark:text-red-200">
                  {nameCheck.error}
                </p>
              )}

              {error && (
                <p className="mt-3 rounded-xl border border-red-200 bg-red-50 p-2.5 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading || !nameCheck.ok}
                className="lc-btn lc-btn-primary mt-4 min-h-11 w-full cursor-pointer disabled:cursor-not-allowed"
              >
                {loading ? "Creando…" : "Crear hogar"}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
