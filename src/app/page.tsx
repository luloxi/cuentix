import type { Metadata } from "next";
import { GastosView } from "@/components/gastos-view";

export const metadata: Metadata = { title: { absolute: "Gastos · Cuentix" } };

export default function HomePage() {
  return <GastosView />;
}
