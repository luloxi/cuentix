import type { Metadata } from "next";
import { EvolucionView } from "@/components/evolucion-view";

export const metadata: Metadata = { title: "Evolución" };

export default function EvolucionPage() {
  return <EvolucionView />;
}
