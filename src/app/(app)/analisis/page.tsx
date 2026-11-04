import { RedirectTo } from "@/components/redirect-to";

/** Análisis ahora es Movimientos > Gráficos. */
export default function Page() {
  return <RedirectTo href="/consumos?tab=charts" />;
}
