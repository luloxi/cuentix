import type { Metadata } from "next";
import { MovimientosView } from "@/components/movimientos-view";

export const metadata: Metadata = { title: "Movimientos" };

export default function MovimientosPage() {
  return <MovimientosView />;
}
