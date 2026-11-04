/**
 * App nav. Cargas, Importar and Suscripción are not listed:
 * those routes redirect to Inicio. Deuda stays off the bar.
 */
export const NAV_LINKS = [
  { href: "/dashboard", label: "Inicio" },
  { href: "/consumos", label: "Consumos" },
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

/** Home hero: read-only. Never an upload, billing, or add-expense link. */
export function homeNextAction(_monthTxCount: number): {
  href: "/consumos";
  label: string;
} {
  return { href: "/consumos", label: "Ver consumos" };
}
