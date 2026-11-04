import { Suspense } from "react";
import { MesAMesView } from "@/components/mes-a-mes";
import { LoadingBlock, PageHeader, PageStack } from "@/components/ui";

export default function Page() {
  return (
    <Suspense fallback={<LoadingBlock label="Cargando mes a mes…" />}>
      <PageStack>
        <PageHeader
          eyebrow="Gastos"
          title="Mes a mes"
          description="Totales del mes, por categoría."
        />
        <MesAMesView mode="resumen" />
      </PageStack>
    </Suspense>
  );
}
