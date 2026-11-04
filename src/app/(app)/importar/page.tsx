import { Suspense } from "react";
import { ImportarView } from "@/components/importar-view";
import { LoadingBlock, PageHeader, PageStack } from "@/components/ui";

export default function Page() {
  return (
    <Suspense fallback={<LoadingBlock label="Cargando resúmenes…" />}>
      <PageStack>
        <PageHeader
          eyebrow="Archivos"
          title="Importar"
          description="Resúmenes que ya entraron a este hogar."
        />
        <ImportarView />
      </PageStack>
    </Suspense>
  );
}
