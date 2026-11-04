import type { Metadata } from "next";
import { GastosView } from "@/components/gastos-view";

export const metadata: Metadata = { title: "Gastos" };

export default function GastosPage() {
  return <GastosView />;
}
