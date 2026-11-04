"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { FiwindReclassifyPanel } from "@/components/fiwind-reclassify-panel";
import { MesAMesView } from "@/components/mes-a-mes";
import { TransactionsTable } from "@/components/transactions-table";
import { SectionNav } from "@/components/section-nav";
import { PageStack, Toast } from "@/components/ui";

type Tab = "lista" | "resumen" | "charts" | "fiwind";

function tabFromParam(raw: string | null): Tab {
  if (raw === "resumen" || raw === "charts" || raw === "lista" || raw === "fiwind") return raw;
  return "lista";
}

export function ConsumosWorkspace() {
  const searchParams = useSearchParams();
  const urlTab = tabFromParam(searchParams.get("tab"));
  const tab = urlTab;
  const [tableKey, setTableKey] = useState(0);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    function onCreated() {
      setToast("Gasto agregado.");
      setTableKey((k) => k + 1);
    }
    function onImported() {
      setToast("Importación lista.");
      setTableKey((k) => k + 1);
    }
    function onHouseholdSwitched() {
      setTableKey((k) => k + 1);
    }
    window.addEventListener("lc:expense-created", onCreated);
    window.addEventListener("lc:card-imported", onImported);
    window.addEventListener("lc:household-switched", onHouseholdSwitched);
    return () => {
      window.removeEventListener("lc:expense-created", onCreated);
      window.removeEventListener("lc:card-imported", onImported);
      window.removeEventListener("lc:household-switched", onHouseholdSwitched);
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(t);
  }, [toast]);

  return (
    <PageStack className="!space-y-4">
      <header>
        <h1 className="text-[1.6rem] font-semibold leading-tight tracking-tight">Movimientos</h1>
        <p className="mt-1 text-[15px] text-[var(--muted-fg)]">
          {tab === "lista"
            ? "Todo lo que gastaste. Tocá un movimiento para corregirlo."
            : tab === "resumen"
              ? "Cuánto gastaste en cada categoría, mes por mes."
              : tab === "charts"
                ? "Cómo viene tu gasto, en gráficos."
                : "Movimientos de Fiwind para revisar."}
        </p>
      </header>
      <SectionNav section="movimientos" />

      {toast && (
        <Toast>
          {toast === "Importación lista."
            ? "El resumen ya está. Acá abajo están los movimientos."
            : toast === "Gasto agregado."
              ? "Sumado."
              : toast}
        </Toast>
      )}

      <div className="min-h-[40vh]">
        {tab === "lista" ? (
          <TransactionsTable key={tableKey} />
        ) : tab === "fiwind" ? (
          <FiwindReclassifyPanel key={tableKey} onToast={setToast} />
        ) : (
          <MesAMesView mode={tab === "charts" ? "charts" : "resumen"} />
        )}
      </div>
    </PageStack>
  );
}
