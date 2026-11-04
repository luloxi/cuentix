import { Suspense } from "react";
import { GrupoView } from "@/components/grupo-view";
import { SectionNav } from "@/components/section-nav";
import { LoadingBlock, PageHeader, PageStack } from "@/components/ui";

export default function Page() {
  return (
    <Suspense fallback={<LoadingBlock label="Cargando grupo…" />}>
      <PageStack>
        <PageHeader
          title="Grupo"
          description="Código para invitar gente, quiénes están y el balance compartido."
        />
        <SectionNav section="hogar" />
        <GrupoView />
      </PageStack>
    </Suspense>
  );
}
