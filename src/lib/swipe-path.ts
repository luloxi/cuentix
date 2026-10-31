/**
 * Continuous mobile swipe order:
 * Inicio → Lista → Resumen → Gráficos → Vista hogar → Gráficos hogar → Ahorros
 * Deuda stays out until DEUDA_ENABLED.
 */

import { DEUDA_ENABLED } from "@/lib/features";

export type SwipeStep =
  | { href: "/dashboard" }
  | { href: "/consumos"; tab: "lista" | "resumen" | "charts" }
  | { href: "/compartido"; tab: "vista" | "charts" }
  | { href: "/ahorros" }
  | { href: "/deuda"; tab: "evolucion" | "pagos" };

const BASE_PATH: readonly SwipeStep[] = [
  { href: "/dashboard" },
  { href: "/consumos", tab: "lista" },
  { href: "/consumos", tab: "resumen" },
  { href: "/consumos", tab: "charts" },
  { href: "/compartido", tab: "vista" },
  { href: "/compartido", tab: "charts" },
  { href: "/ahorros" },
];

const DEUDA_PATH: readonly SwipeStep[] = [
  { href: "/deuda", tab: "evolucion" },
  { href: "/deuda", tab: "pagos" },
];

export function swipePathFor(deudaEnabled: boolean): readonly SwipeStep[] {
  return deudaEnabled ? [...BASE_PATH, ...DEUDA_PATH] : BASE_PATH;
}

export const SWIPE_PATH: readonly SwipeStep[] = swipePathFor(DEUDA_ENABLED);

export function swipeIncludesDeuda(
  path: readonly SwipeStep[] = SWIPE_PATH,
): boolean {
  return path.some((s) => s.href === "/deuda");
}

export function stepToHref(step: SwipeStep): string {
  if ("tab" in step) return `${step.href}?tab=${step.tab}`;
  return step.href;
}

/** Resolve current step from pathname + optional tab query. */
export function resolveSwipeIndex(
  pathname: string,
  tab: string | null,
): number {
  const path = pathname.replace(/\/$/, "") || "/";

  if (path === "/dashboard" || path === "/") return 0;

  if (path === "/consumos" || path.startsWith("/consumos/")) {
    const t =
      tab === "resumen" || tab === "charts" || tab === "lista" ? tab : "lista";
    const idx = SWIPE_PATH.findIndex(
      (s) => s.href === "/consumos" && "tab" in s && s.tab === t,
    );
    return idx >= 0 ? idx : 1;
  }

  if (path === "/compartido" || path.startsWith("/compartido/")) {
    const t = tab === "charts" ? "charts" : "vista";
    const idx = SWIPE_PATH.findIndex(
      (s) => s.href === "/compartido" && "tab" in s && s.tab === t,
    );
    return idx >= 0 ? idx : 4;
  }

  if (path === "/ahorros" || path.startsWith("/ahorros/")) {
    return SWIPE_PATH.findIndex((s) => s.href === "/ahorros");
  }

  if (DEUDA_ENABLED && (path === "/deuda" || path.startsWith("/deuda/"))) {
    const t = tab === "pagos" ? "pagos" : "evolucion";
    const idx = SWIPE_PATH.findIndex(
      (s) => s.href === "/deuda" && "tab" in s && s.tab === t,
    );
    return idx >= 0 ? idx : SWIPE_PATH.length - 2;
  }

  return -1;
}
