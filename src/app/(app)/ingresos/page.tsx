import { Suspense } from "react";
import { IngresosView } from "@/components/ingresos-view";
import { ListSkeleton } from "@/components/ui";

export default function Page() {
  return (
    <Suspense fallback={<ListSkeleton label="Cargando ingresos…" rows={4} />}>
      <IngresosView />
    </Suspense>
  );
}
