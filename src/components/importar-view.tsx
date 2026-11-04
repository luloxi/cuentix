"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { FileSpreadsheet } from "lucide-react";
import { EmptyState, LoadingBlock, Surface } from "@/components/ui";
import { formatDateAr } from "@/lib/utils";

type CargaItem = {
  id: string;
  kind: string;
  typeLabel: string;
  date: string;
  fileName: string | null;
  count: number;
  status: string;
};

export function ImportarView() {
  const [items, setItems] = useState<CargaItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/cargas", { credentials: "include" });
      const data = (await res.json().catch(() => null)) as { items?: CargaItem[]; error?: string } | null;
      if (!res.ok) throw new Error(data?.error || "No se pudieron leer las cargas");
      setItems((data?.items ?? []).filter((item) => item.kind === "statement"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error de red");
    }
  }, []);

  useEffect(() => {
    void load();
    window.addEventListener("lc:household-switched", load);
    return () => window.removeEventListener("lc:household-switched", load);
  }, [load]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!items) return <LoadingBlock label="Cargando resúmenes…" />;
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<FileSpreadsheet className="h-7 w-7" />}
        title="Todavía no hay resúmenes"
        description="Cuando un archivo ya entró al hogar, aparece acá. El historial completo está en Cargas."
        action={
          <Link href="/cargas" className="lc-btn lc-btn-primary">
            Ver cargas
          </Link>
        }
      />
    );
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.id}>
            <Surface className="flex items-center gap-3 !p-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand-fg)]">
                <FileSpreadsheet className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {item.fileName || item.typeLabel}
                </span>
                <span className="block text-xs text-[var(--muted-fg)]">
                  {item.typeLabel} · {formatWhen(item.date)} · {item.count}{" "}
                  {item.count === 1 ? "movimiento" : "movimientos"}
                </span>
              </span>
              <span className="text-xs text-[var(--muted-fg)]">{item.status}</span>
            </Surface>
          </li>
        ))}
      </ul>
      <Link href="/cargas" className="lc-btn lc-btn-secondary">
        Ver cargas
      </Link>
    </div>
  );
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return formatDateAr(iso.slice(0, 10));
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(d);
}
