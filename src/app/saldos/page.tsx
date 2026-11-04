import type { Metadata } from "next";
import { SaldosView } from "@/components/saldos-view";

export const metadata: Metadata = { title: "Saldos" };

export default function SaldosPage() {
  return <SaldosView />;
}
