import { Suspense } from "react";
import { MesAMesView } from "@/components/mes-a-mes";
import { LoadingBlock, PageHeader, PageStack } from "@/components/ui";

export default function Page() {
  return (
    <Suspense fallback={<LoadingBlock label="Cargando análisis…" />}>
      <PageStack>
        <PageHeader
          eyebrow="Gastos"
          title="Análisis"
          description="Cómo viene el gasto mes a mes, en pesos."
        />
        <MesAMesView mode="charts" />
      </PageStack>
    </Suspense>
  );
}
