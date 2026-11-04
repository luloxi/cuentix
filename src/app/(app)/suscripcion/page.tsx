import { Suspense } from "react";
import { SuscripcionView } from "@/components/suscripcion-view";
import { LoadingBlock } from "@/components/ui";

export default function Page() {
  return (
    <Suspense fallback={<LoadingBlock label="Cargando suscripción…" />}>
      <SuscripcionView />
    </Suspense>
  );
}
