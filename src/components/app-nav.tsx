"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Home,
  List,
  Users,
  LogOut,
  Plus,
  Banknote,
  Upload,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { invalidateApi } from "@/lib/api/client";
import { BrandLogo } from "@/components/brand-logo";
import { HouseholdSwitcher } from "@/components/household-switcher";
import { NAV_LINKS, type NavHref } from "@/lib/nav";

const NAV_ICONS: Record<NavHref, typeof Home> = {
  "/dashboard": Home,
  "/consumos": List,
  "/cargas": Upload,
  "/ingresos": Banknote,
  "/compartido": Users,
};

const links = NAV_LINKS.map((l) => ({
  ...l,
  icon: NAV_ICONS[l.href],
}));

function openAddExpense() {
  window.dispatchEvent(new Event("lc:open-add-expense"));
}

export function AppNav() {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    } catch {
      // ignore
    }
    invalidateApi();
    router.push("/login");
  }

  // Inicio · Consumos · Cargas | + | Ingresos · Hogar — Admin solo por URL /admin
  const left = links.slice(0, 3);
  const right = links.slice(3);

  return (
    <>
      <header className="sticky top-0 z-40 hidden border-b border-[var(--border)] bg-[var(--surface)]/90 backdrop-blur-md md:block">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-2.5 md:px-6">
          <Link
            href="/dashboard"
            className="group flex cursor-pointer items-center gap-2.5 font-semibold tracking-tight text-[var(--foreground)]"
          >
            <BrandLogo
              size={32}
              className="transition-transform duration-200 group-hover:scale-[1.03]"
            />
            <span className="text-[15px] tracking-tight">Cuentix</span>
          </Link>
          <nav className="flex items-center gap-1">
            <HouseholdSwitcher variant="header" className="mr-1" />
            {links.map(({ href, label, icon: Icon }) => {
              const active = pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "relative flex items-center gap-1.5 rounded-2xl px-3.5 py-2 text-sm font-medium transition-colors",
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
            <button
              type="button"
              onClick={openAddExpense}
              className="lc-btn lc-btn-primary ml-2 !rounded-2xl !px-3.5 !py-2"
            >
              <Plus className="h-4 w-4" strokeWidth={2.25} />
              Sumar
            </button>
            <button
              type="button"
              onClick={() => void logout()}
              className="ml-1 flex items-center gap-1.5 rounded-2xl px-3 py-2 text-sm text-[var(--muted-fg)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]"
            >
              <LogOut className="h-4 w-4" strokeWidth={1.75} />
              Salir
            </button>
          </nav>
        </div>
      </header>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--border)] bg-[var(--surface)]/95 backdrop-blur-md md:hidden">
        <div className="relative mx-auto grid max-w-lg grid-cols-6 items-end gap-0.5 px-1.5 pb-[max(0.4rem,env(safe-area-inset-bottom))] pt-1.5">
          {left.map(({ href, label, icon: Icon }) => {
            const active = pathname.startsWith(href);
            return (
              <NavSlot key={href} href={href} label={label} active={active}>
                <Icon className="h-5 w-5" strokeWidth={active ? 2.1 : 1.75} />
              </NavSlot>
            );
          })}

          <div className="relative flex flex-col items-center">
            <button
              type="button"
              onClick={openAddExpense}
              className="absolute -top-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--brand)] text-white shadow-md shadow-black/10 ring-[3px] ring-[var(--surface)] transition active:scale-95 dark:text-[#121110]"
              aria-label="Sumar un gasto"
            >
              <Plus className="h-6 w-6" strokeWidth={2.25} />
            </button>
            <span className="mt-9 text-[11px] font-medium text-[var(--muted-fg)]">
              Sumar
            </span>
          </div>

          {right.map(({ href, label, icon: Icon }) => {
            const active = pathname.startsWith(href);
            return (
              <NavSlot key={href} href={href} label={label} active={active}>
                <Icon className="h-5 w-5" strokeWidth={active ? 2.1 : 1.75} />
              </NavSlot>
            );
          })}
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
        "relative flex flex-col items-center gap-0.5 rounded-2xl px-0.5 py-1.5 text-[11px] font-medium transition-colors",
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
      {label}
    </Link>
  );
}
