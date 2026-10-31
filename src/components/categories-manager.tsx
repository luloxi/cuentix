"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Eye,
  EyeOff,
  Loader2,
  Plus,
  Trash2,
  Tags,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { CategoryIcon } from "@/lib/category-icons";
import { colorForCategory } from "@/lib/category-colors";
import { EmptyState, LoadingBlock, Surface, Toast } from "@/components/ui";

type CatRow = {
  id: string;
  slug: string;
  name: string;
  kind: string;
  isSystem: boolean;
  hidden: boolean;
  canDelete: boolean;
};

function displayName(name: string) {
  return name.toLowerCase() === "uncategorized" ? "Sin categoría" : name;
}

export function CategoriesManager() {
  const [cats, setCats] = useState<CatRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/categories", { credentials: "include" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al cargar");
      setCats(data.categories ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(t);
  }, [toast]);

  const visible = useMemo(
    () => (showHidden ? cats : cats.filter((c) => !c.hidden)),
    [cats, showHidden],
  );
  const hiddenCount = cats.filter((c) => c.hidden).length;

  async function addCategory(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo crear");
      setNewName("");
      setToast(`«${name}» agregada`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setSaving(false);
    }
  }

  async function toggleHidden(cat: CatRow) {
    if (cat.slug === "uncategorized") return;
    setBusyId(cat.id);
    setError(null);
    const nextHidden = !cat.hidden;
    setCats((list) =>
      list.map((c) => (c.id === cat.id ? { ...c, hidden: nextHidden } : c)),
    );
    try {
      const res = await fetch("/api/categories", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ id: cat.id, hidden: nextHidden }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setCats((list) =>
          list.map((c) =>
            c.id === cat.id ? { ...c, hidden: cat.hidden } : c,
          ),
        );
        throw new Error(data?.error || "No se pudo actualizar");
      }
      setToast(nextHidden ? `«${displayName(cat.name)}» oculta` : `«${displayName(cat.name)}» visible`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setBusyId(null);
    }
  }

  async function removeCategory(cat: CatRow) {
    if (!cat.canDelete) return;
    if (
      !window.confirm(
        `¿Borrar «${cat.name}»? Los gastos de esta categoría pasan a Sin categoría.`,
      )
    ) {
      return;
    }
    setBusyId(cat.id);
    setError(null);
    try {
      const res = await fetch("/api/categories", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ id: cat.id }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "No se pudo borrar");
      setCats((list) => list.filter((c) => c.id !== cat.id));
      setToast(`«${cat.name}» eliminada`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setBusyId(null);
    }
  }

  if (loading && cats.length === 0) {
    return <LoadingBlock label="Cargando categorías…" />;
  }

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Categorías</h1>
        <p className="mt-1 text-sm text-[var(--muted-fg)]">
          Mostrá solo las que usás. Ocultar no borra gastos ya cargados.
        </p>
      </div>

      <form
        onSubmit={(e) => void addCategory(e)}
        className="flex gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3"
      >
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Nueva categoría…"
          maxLength={48}
          className="lc-input min-w-0 flex-1"
        />
        <button
          type="submit"
          disabled={saving || newName.trim().length < 2}
          className="lc-btn lc-btn-primary shrink-0 !px-3 disabled:opacity-50"
        >
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          Agregar
        </button>
      </form>

      {toast && <Toast>{toast}</Toast>}
      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </p>
      )}

      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setShowHidden((v) => !v)}
          className="self-start text-xs font-medium text-[var(--muted-fg)] hover:text-[var(--foreground)]"
        >
          {showHidden
            ? `Ocultar las ${hiddenCount} desactivadas`
            : `Ver ${hiddenCount} desactivadas`}
        </button>
      )}

      {visible.length === 0 ? (
        <EmptyState
          icon={<Tags className="h-7 w-7" />}
          title="Sin categorías visibles"
          description="Activá alguna o creá una nueva arriba."
        />
      ) : (
        <Surface className="!p-0 overflow-hidden">
          <ul className="divide-y divide-[var(--border)]">
            {visible.map((cat) => {
              const color = colorForCategory(cat.slug);
              const busy = busyId === cat.id;
              return (
                <li
                  key={cat.id}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 transition",
                    cat.hidden && "opacity-50",
                  )}
                >
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
                    style={{ backgroundColor: `${color}18`, color }}
                  >
                    <CategoryIcon slug={cat.slug} size={16} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {displayName(cat.name)}
                    </p>
                    <p className="text-[11px] text-[var(--muted-fg)]">
                      {cat.canDelete
                        ? "Tu categoría"
                        : cat.slug === "uncategorized"
                          ? "Siempre visible"
                          : "Del sistema"}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {cat.canDelete && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void removeCategory(cat)}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-[var(--muted-fg)] transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                        aria-label={`Borrar ${cat.name}`}
                        title="Borrar"
                      >
                        {busy ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </button>
                    )}
                    {cat.slug !== "uncategorized" && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void toggleHidden(cat)}
                        className={cn(
                          "inline-flex h-9 w-9 items-center justify-center rounded-xl transition",
                          cat.hidden
                            ? "bg-[var(--surface-muted)] text-[var(--muted-fg)]"
                            : "bg-[var(--brand-soft)] text-[var(--brand-fg)]",
                        )}
                        aria-label={
                          cat.hidden
                            ? `Mostrar ${displayName(cat.name)}`
                            : `Ocultar ${displayName(cat.name)}`
                        }
                        title={cat.hidden ? "Mostrar" : "Ocultar"}
                      >
                        {busy ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : cat.hidden ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </Surface>
      )}

      <p className="text-center text-[11px] leading-relaxed text-[var(--muted-fg)]">
        Las ocultas no aparecen al cargar un gasto. Los gastos viejos siguen con
        su categoría.
      </p>
    </div>
  );
}
