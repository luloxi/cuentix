"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Home,
  List,
  Users,
  UsersRound,
  LogOut,
  Banknote,
  BarChart3,
  CalendarRange,
  ShoppingCart,
  Plug,
  Shield,
  MoreHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiGet, invalidateApi } from "@/lib/api/client";
import { BrandLogo } from "@/components/brand-logo";
import { HouseholdSwitcher } from "@/components/household-switcher";
import { navLinksFor, splitMobileNav, type NavHref, type NavLink } from "@/lib/nav";

const NAV_ICONS: Record<NavHref, typeof Home> = {
  "/dashboard": Home,
  "/consumos": List,
  "/ingresos": Banknote,
  "/compartido": Users,
  "/analisis": BarChart3,
  "/mes-a-mes": CalendarRange,
  "/grupo": UsersRound,
  "/supermercado": ShoppingCart,
  "/mcp": Plug,
  "/admin": Shield,
};

type IconLink = NavLink & { icon: (typeof NAV_ICONS)[NavHref] };

function withIcons(links: readonly NavLink[]): IconLink[] {
  return links.map((l) => ({ ...l, icon: NAV_ICONS[l.href] }));
}

export function AppNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [isAdmin, setIsAdmin] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void apiGet<{ flags?: { isAdmin?: boolean } }>("/api/me", 5000).then((res) => {
      if (cancelled || !res.ok) return;
      setIsAdmin(res.data?.flags?.isAdmin === true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!moreOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMoreOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moreOpen]);

  async function logout() {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    } catch {
      // ignore
    }
    invalidateApi();
    router.push("/login");
  }

  const links = withIcons(navLinksFor(isAdmin));
  const { bar, more } = splitMobileNav(links);
  const moreActive = more.some((l) => pathname.startsWith(l.href));

  return (
    <>
      <header className="sticky top-0 z-40 hidden border-b border-[var(--border)] bg-[var(--surface)]/90 backdrop-blur-md md:block">
        <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-2.5 md:px-6">
          <div className="flex items-center justify-between gap-4">
            <Link
              href="/dashboard"
              className="group flex min-h-10 cursor-pointer items-center gap-2.5 font-semibold tracking-tight text-[var(--foreground)]"
            >
              <BrandLogo
                size={32}
                className="transition-transform duration-200 group-hover:scale-[1.03]"
              />
              <span className="text-[15px] tracking-tight">Cuentix</span>
            </Link>
            <div className="flex items-center gap-1">
              <HouseholdSwitcher variant="header" />
              <button
                type="button"
                onClick={() => void logout()}
                className="ml-1 flex min-h-10 min-w-10 cursor-pointer items-center gap-1.5 rounded-2xl px-3 py-2 text-sm text-[var(--muted-fg)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]"
              >
                <LogOut className="h-4 w-4" strokeWidth={1.75} />
                Salir
              </button>
            </div>
          </div>
          <nav className="flex flex-wrap items-center gap-1" aria-label="Secciones">
            {links.map(({ href, label, icon: Icon }) => {
              const active = pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "relative flex min-h-10 cursor-pointer items-center gap-1.5 rounded-2xl px-3 py-2 text-sm font-medium transition-colors",
                    active
                      ? "bg-[var(--brand-soft)] text-[var(--brand-fg)]"
                      : "text-[var(--muted-fg)] hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]",
                  )}
                >
                  <Icon className="h-4 w-4" strokeWidth={active ? 2.25 : 1.75} />
                  {label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>

      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--border)] bg-[var(--surface)]/95 backdrop-blur-md md:hidden"
        aria-label="Secciones"
      >
        {moreOpen && more.length > 0 && (
          <button
            type="button"
            aria-label="Cerrar menú"
            className="fixed inset-0 z-0 cursor-pointer bg-black/25"
            onClick={() => setMoreOpen(false)}
          />
        )}
        {moreOpen && more.length > 0 && (
          <div
            id="app-nav-more"
            role="menu"
            aria-label="Más secciones"
            className="absolute inset-x-2 bottom-full z-10 mb-2 max-h-[70dvh] overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-1.5 shadow-lg"
          >
            {more.map(({ href, label, icon: Icon }) => {
              const active = pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  role="menuitem"
                  onClick={() => setMoreOpen(false)}
                  className={cn(
                    "flex min-h-10 w-full cursor-pointer items-center gap-2.5 rounded-xl px-3 text-sm font-medium",
                    active
                      ? "bg-[var(--brand-soft)] text-[var(--brand-fg)]"
                      : "text-[var(--foreground)]",
                  )}
                >
                  <Icon className="h-4 w-4" strokeWidth={active ? 2.25 : 1.75} />
                  {label}
                </Link>
              );
            })}
          </div>
        )}
        <div
          className="relative z-10 mx-auto grid max-w-lg items-end gap-0.5 px-1.5 pb-[max(0.4rem,env(safe-area-inset-bottom))] pt-1.5"
          style={{
            gridTemplateColumns: `repeat(${bar.length + (more.length > 0 ? 1 : 0)}, minmax(0, 1fr))`,
          }}
        >
          {bar.map(({ href, label, icon: Icon }) => {
            const active = pathname.startsWith(href);
            return (
              <NavSlot key={href} href={href} label={label} active={active}>
                <Icon className="h-5 w-5" strokeWidth={active ? 2.1 : 1.75} />
              </NavSlot>
            );
          })}
          {more.length > 0 && (
            <button
              type="button"
              aria-expanded={moreOpen}
              aria-haspopup="menu"
              aria-controls={moreOpen ? "app-nav-more" : undefined}
              onClick={() => setMoreOpen((open) => !open)}
              className={cn(
                "relative flex min-h-10 min-w-10 cursor-pointer flex-col items-center gap-0.5 rounded-2xl px-0.5 py-1.5 text-[11px] font-medium transition-colors",
                moreOpen || moreActive
                  ? "text-[var(--brand-fg)]"
                  : "text-[var(--muted-fg)]",
              )}
            >
              <span
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-2xl transition-colors",
                  moreOpen || moreActive ? "bg-[var(--brand-soft)]" : "",
                )}
              >
                <MoreHorizontal className="h-5 w-5" strokeWidth={moreOpen || moreActive ? 2.1 : 1.75} />
              </span>
              Más
            </button>
          )}
        </div>
      </nav>
    </>
  );
}

function NavSlot({
  href,
  label,
  active,
  children,
}: {
  href: string;
  label: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "relative flex min-h-10 min-w-10 cursor-pointer flex-col items-center gap-0.5 rounded-2xl px-0.5 py-1.5 text-[11px] font-medium transition-colors",
        active ? "text-[var(--brand-fg)]" : "text-[var(--muted-fg)]",
      )}
    >
      <span
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-2xl transition-colors",
          active ? "bg-[var(--brand-soft)]" : "",
        )}
      >
        {children}
      </span>
      <span className="max-w-full truncate text-center leading-tight">{label}</span>
    </Link>
  );
}
