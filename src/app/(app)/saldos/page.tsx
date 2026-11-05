import { Suspense } from "react";
import { SaldosView } from "@/components/saldos-view";
import { ListSkeleton } from "@/components/ui";

export default function Page() {
  return (
    <Suspense fallback={<ListSkeleton label="Cargando saldos…" rows={4} />}>
      <SaldosView />
    </Suspense>
  );
}
