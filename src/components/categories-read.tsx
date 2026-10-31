"use client";

import { useApi } from "@/lib/api/use-api";

type Category = {
  id: string;
  slug: string;
  name: string;
  kind: string;
  hidden?: boolean;
};

export function CategoriesRead() {
  const { result, loading } = useApi<{ categories?: Category[]; error?: string }>("/api/categories");
  if (loading && !result) {
    return <p className="text-sm text-[var(--muted-fg)]">Cargando categorías…</p>;
  }
  if (!result?.ok) {
    return (
      <p className="text-sm text-red-600">
        {result?.data?.error || "No se pudieron leer las categorías"}
      </p>
    );
  }
  const categories = (result.data?.categories ?? []).filter((cat) => !cat.hidden);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Categorías</h1>
        <p className="mt-1 text-sm text-[var(--muted-fg)]">
          Lectura del hogar activo. Crear y ocultar vuelve en la próxima etapa.
        </p>
      </div>
      <ul className="divide-y divide-[var(--border)] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
        {categories.map((cat) => (
          <li key={cat.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <span className="font-medium">{cat.name}</span>
            <span className="text-xs uppercase tracking-wide text-[var(--muted-fg)]">{cat.kind}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
