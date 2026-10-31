import { Suspense } from "react";
import { ConsumosWorkspace } from "@/components/consumos-workspace";
import { ListSkeleton } from "@/components/ui";

export default function ConsumosPage() {
  return (
    <Suspense fallback={<ListSkeleton label="Cargando consumos…" />}>
      <ConsumosWorkspace />
    </Suspense>
  );
}
