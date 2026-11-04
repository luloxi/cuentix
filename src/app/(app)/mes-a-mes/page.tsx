import { RedirectTo } from "@/components/redirect-to";

/** Mes a mes ahora es Movimientos > Por mes. */
export default function Page() {
  return <RedirectTo href="/consumos?tab=resumen" />;
}
