import { Suspense } from "react";
import { GrupoView } from "@/components/grupo-view";
import { LoadingBlock, PageHeader, PageStack } from "@/components/ui";

export default function Page() {
  return (
    <Suspense fallback={<LoadingBlock label="Cargando grupo…" />}>
      <PageStack>
        <PageHeader
          eyebrow="Hogar"
          title="Grupo"
          description="Código de invitación, miembros y balance compartido."
        />
        <GrupoView />
      </PageStack>
    </Suspense>
  );
}
