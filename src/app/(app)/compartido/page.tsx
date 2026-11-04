import { Suspense } from "react";
import { CompartidoView } from "@/components/compartido-view";
import { HogarSkeleton } from "@/components/ui";

export default function Page() {
  return (
    <Suspense fallback={<HogarSkeleton />}>
      <CompartidoView />
    </Suspense>
  );
}
