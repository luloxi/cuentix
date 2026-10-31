"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Home, Receipt, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

type HouseholdOption = {
  id: string;
  name: string;
  role?: "owner" | "member";
  canDelete?: boolean;
};

type Props = {
  /** Compact pill for the desktop header; default is the Hogar page control. */
  variant?: "page" | "header";
  className?: string;
};

function iconFor(name: string) {
  if (/invoice\s*iog/i.test(name)) return Receipt;
  return Home;
}

export function HouseholdSwitcher({ variant = "page", className }: Props) {
  const router = useRouter();
  const [households, setHouseholds] = useState<HouseholdOption[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/household/active", {
        credentials: "include",
      });
      const data = (await res.json().catch(() => null)) as {
        households?: HouseholdOption[];
        activeHouseholdId?: string | null;
        error?: string;
      } | null;
      if (!res.ok) {
        setError(data?.error || `Error ${res.status}`);
        return;
      }
      setHouseholds(data?.households ?? []);
      setActiveId(data?.activeHouseholdId ?? null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    function onHouseholdChange() {
      void load();
    }
    window.addEventListener("lc:household-switched", onHouseholdChange);
    window.addEventListener("lc:household-created", onHouseholdChange);
    return () => {
      window.removeEventListener("lc:household-switched", onHouseholdChange);
      window.removeEventListener("lc:household-created", onHouseholdChange);
    };
  }, [load]);

  async function switchTo(householdId: string) {
    if (!householdId || householdId === activeId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/household/active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ householdId }),
      });
      const data = (await res.json().catch(() => null)) as {
        error?: string;
        activeHouseholdId?: string;
      } | null;
      if (!res.ok) {
        setError(data?.error || `Error ${res.status}`);
        return;
      }
      setActiveId(data?.activeHouseholdId ?? householdId);
      router.refresh();
      // Reload client data that depends on the active hogar cookie.
      window.dispatchEvent(new Event("lc:household-switched"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
    } finally {
      setBusy(false);
    }
  }

  async function deleteHousehold(householdId: string, name: string) {
    if (!householdId || busy) return;
    const ok = window.confirm(
      `¿Eliminar “${name}”? Se borran sus gastos y no se puede deshacer.`,
    );
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/household/active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ householdId, action: "delete" }),
      });
      const data = (await res.json().catch(() => null)) as {
        error?: string;
        households?: HouseholdOption[];
        activeHouseholdId?: string | null;
      } | null;
      if (!res.ok) {
        setError(data?.error || `Error ${res.status}`);
        return;
      }
      setHouseholds(data?.households ?? []);
      setActiveId(data?.activeHouseholdId ?? null);
      router.refresh();
      window.dispatchEvent(new Event("lc:household-switched"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
    } finally {
      setBusy(false);
    }
  }

  // Still show switcher with 1 hogar if any is deletable (e.g. leftover test).
  if (households.length < 1) return null;
  if (households.length < 2 && !households.some((h) => h.canDelete)) return null;

  const active = households.find((h) => h.id === activeId) ?? households[0];

  if (variant === "header") {
    return (
      <label
        className={cn(
          "flex items-center gap-1.5 rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] px-2 py-1 text-xs font-medium text-[var(--muted-fg)]",
          className,
        )}
      >
        <span className="sr-only">Hogar activo</span>
        <select
          value={activeId ?? ""}
          disabled={busy}
          onChange={(e) => void switchTo(e.target.value)}
          className="max-w-[9.5rem] cursor-pointer bg-transparent text-[13px] font-semibold text-[var(--foreground)] outline-none"
          aria-label="Cambiar de hogar"
        >
          {households.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name}
            </option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <div className={cn("space-y-1.5", className)}>
      <div
        className="inline-flex flex-wrap items-center gap-1 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-1"
        role="group"
        aria-label="Cambiar de hogar"
      >
        {households.map((h) => {
          const Icon = iconFor(h.name);
          const selected = h.id === (activeId ?? active?.id);
          return (
            <span key={h.id} className="inline-flex items-center">
              <button
                type="button"
                disabled={busy}
                onClick={() => void switchTo(h.id)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-semibold transition",
                  selected
                    ? "bg-[var(--brand-soft)] text-[var(--brand-fg)]"
                    : "text-[var(--muted-fg)] hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]",
                  busy && "opacity-70",
                )}
              >
                <Icon className="h-3.5 w-3.5" strokeWidth={selected ? 2.25 : 1.75} />
                {h.name}
              </button>
              {h.canDelete && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void deleteHousehold(h.id, h.name)}
                  className="ml-0.5 rounded-lg p-1.5 text-zinc-400 transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                  aria-label={`Eliminar ${h.name}`}
                  title="Eliminar hogar"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </span>
          );
        })}
      </div>
      {error && (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}
