import type { Metadata } from "next";
import { IngresosView } from "@/components/ingresos-view";

export const metadata: Metadata = { title: "Ingresos" };

export default function IngresosPage() {
  return <IngresosView />;
}
