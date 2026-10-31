/**
 * Canonical 5-item app nav. Deuda is never in the bar:
 * it is reached from Inicio and the swipe path.
 */
export const NAV_LINKS = [
  { href: "/dashboard", label: "Inicio" },
  { href: "/consumos", label: "Consumos" },
  { href: "/cargas", label: "Cargas" },
  { href: "/ingresos", label: "Ingresos" },
  { href: "/compartido", label: "Hogar" },
] as const;

export type NavHref = (typeof NAV_LINKS)[number]["href"];

export const NAV_HREFS: readonly NavHref[] = NAV_LINKS.map((l) => l.href);

export function navIncludesDeuda(
  hrefs: readonly string[] = NAV_HREFS,
): boolean {
  return hrefs.some((h) => h === "/deuda" || h.startsWith("/deuda/"));
}

/** Home hero: one next action. Empty month → cargar; otherwise ver consumos. */
export function homeNextAction(monthTxCount: number): {
  href: "/cargas" | "/consumos";
  label: string;
} {
  if (monthTxCount <= 0) {
    return { href: "/cargas", label: "Cargá el resumen" };
  }
  return { href: "/consumos", label: "Ver consumos" };
}
