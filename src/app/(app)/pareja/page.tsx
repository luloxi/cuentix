import { Suspense } from "react";
import { GrupoView } from "@/components/grupo-view";
import { SectionNav } from "@/components/section-nav";
import { LoadingBlock, PageHeader, PageStack } from "@/components/ui";

/** Nombre viejo. El balance compartido vive en Grupo. */
export default function Page() {
  return (
    <Suspense fallback={<LoadingBlock label="Cargando grupo…" />}>
      <PageStack>
        <PageHeader title="Grupo" description="El balance compartido del grupo." />
        <SectionNav section="hogar" />
        <GrupoView />
      </PageStack>
    </Suspense>
  );
}
