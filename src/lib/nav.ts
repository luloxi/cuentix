/**
 * App nav. Every working read-only section is listed.
 * Suscripción, Importar, Cargas and Compartir stay off the bar
 * (those routes redirect or are the share target). Deuda stays off too.
 * Administración is added only for admins.
 */
export const NAV_LINKS = [
  { href: "/dashboard", label: "Inicio" },
  { href: "/consumos", label: "Consumos" },
  { href: "/ingresos", label: "Ingresos" },
  { href: "/compartido", label: "Hogar" },
  { href: "/analisis", label: "Análisis" },
  { href: "/mes-a-mes", label: "Mes a mes" },
  { href: "/grupo", label: "Grupo" },
  { href: "/supermercado", label: "Supermercado" },
  { href: "/mcp", label: "MCP" },
] as const;

export const ADMIN_NAV_LINK = {
  href: "/admin",
  label: "Administración",
} as const;

/** Mobile bar slots before the overflow control. The rest go under Más. */
export const MOBILE_NAV_BAR_COUNT = 4;

export type PublicNavHref = (typeof NAV_LINKS)[number]["href"];
export type NavHref = PublicNavHref | typeof ADMIN_NAV_LINK.href;

export type NavLink = { href: NavHref; label: string };

export const NAV_HREFS: readonly PublicNavHref[] = NAV_LINKS.map((l) => l.href);

const UNLISTED_HREFS = new Set([
  "/cargas",
  "/importar",
  "/suscripcion",
  "/share-target",
  "/deuda",
]);

export function navLinksFor(isAdmin: boolean): readonly NavLink[] {
  const links: NavLink[] = NAV_LINKS.map((l) => ({
    href: l.href,
    label: l.label,
  }));
  if (isAdmin) {
    links.push({ href: ADMIN_NAV_LINK.href, label: ADMIN_NAV_LINK.label });
  }
  return links;
}

/** True when the href is a section that must not appear in the nav. */
export function isUnlistedNavHref(href: string): boolean {
  return UNLISTED_HREFS.has(href) || href.startsWith("/deuda/");
}

/**
 * Mobile bottom bar. When there are more sections than fit, the first
 * `MOBILE_NAV_BAR_COUNT` stay in the bar and the rest go in Más.
 */
export function splitMobileNav<T>(links: readonly T[]): {
  bar: T[];
  more: T[];
} {
  if (links.length <= MOBILE_NAV_BAR_COUNT) {
    return { bar: [...links], more: [] };
  }
  return {
    bar: [...links.slice(0, MOBILE_NAV_BAR_COUNT)],
    more: [...links.slice(MOBILE_NAV_BAR_COUNT)],
  };
}

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
