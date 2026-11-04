import { Suspense } from "react";
import { GrupoView } from "@/components/grupo-view";
import { LoadingBlock, PageHeader, PageStack } from "@/components/ui";

/** Legacy name. The shared balance lives in Grupo. */
export default function Page() {
  return (
    <Suspense fallback={<LoadingBlock label="Cargando grupo…" />}>
      <PageStack>
        <PageHeader
          eyebrow="Hogar"
          title="Pareja"
          description="El balance compartido del grupo."
        />
        <GrupoView />
      </PageStack>
    </Suspense>
  );
}
