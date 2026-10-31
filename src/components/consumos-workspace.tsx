"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LayoutList, LineChart, List } from "lucide-react";
import { TransactionsTable } from "@/components/transactions-table";
import { SoonPage } from "@/components/soon-page";
import { PageStack, SegmentedControl, Toast } from "@/components/ui";

const TABS = ["lista", "resumen", "charts"] as const;
type Tab = (typeof TABS)[number];

function tabFromParam(raw: string | null): Tab {
  if (raw === "resumen" || raw === "charts" || raw === "lista") return raw;
  return "lista";
}

export function ConsumosWorkspace() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(() =>
    tabFromParam(searchParams.get("tab")),
  );
  const [tableKey, setTableKey] = useState(0);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    setTab(tabFromParam(searchParams.get("tab")));
  }, [searchParams]);

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

  const onTab = useCallback(
    (v: Tab) => {
      setTab(v);
      router.replace(`/consumos?tab=${v}`, { scroll: false });
    },
    [router],
  );

  return (
    <PageStack className="!space-y-4">
      <SegmentedControl
        value={tab}
        onChange={onTab}
        className="w-full"
        options={[
          {
            id: "lista",
            label: "Lista",
            icon: <List className="h-3.5 w-3.5" />,
          },
          {
            id: "resumen",
            label: "Resumen",
            icon: <LayoutList className="h-3.5 w-3.5" />,
          },
          {
            id: "charts",
            label: "Gráficos",
            icon: <LineChart className="h-3.5 w-3.5" />,
          },
        ]}
      />

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
        ) : (
          <SoonPage title={tab === "charts" ? "Gráficos" : "Resumen"} />
        )}
      </div>
    </PageStack>
  );
}
