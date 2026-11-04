"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const LINKS = [
  { href: "/gastos/", label: "Gastos", icon: "pie" },
  { href: "/ingresos/", label: "Ingresos", icon: "bar" },
  { href: "/evolucion/", label: "Evolución", icon: "line" },
  { href: "/movimientos/", label: "Movimientos", icon: "list" },
  { href: "/saldos/", label: "Saldos", icon: "wallet" },
] as const;

function Icon({ name }: { name: string }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      {name === "pie" ? <path {...common} d="M12 3a9 9 0 1 0 9 9h-9V3z" /> : null}
      {name === "bar" ? <path {...common} d="M5 19V10M12 19V5M19 19v-7" /> : null}
      {name === "line" ? <path {...common} d="M4 16l5-5 4 3 7-8" /> : null}
      {name === "list" ? <path {...common} d="M8 7h12M8 12h12M8 17h12M4 7h.01M4 12h.01M4 17h.01" /> : null}
      {name === "wallet" ? <path {...common} d="M4 8h16v10H4zM4 8V6h12M16 13h2" /> : null}
    </svg>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "/";
  const bare = pathname === "/login" || pathname === "/login/";
  const [theme, setTheme] = useState<"dark" | "light" | null>(null);

  useEffect(() => {
    const current = document.documentElement.dataset.theme === "light" ? "light" : "dark";
    setTheme(current);
  }, []);

  function toggleTheme() {
    const next = theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("cuentix-theme", next);
    } catch {
      /* private mode */
    }
    setTheme(next);
  }

  async function logout() {
    await fetch("/api/logout", { method: "POST", credentials: "same-origin" }).catch(() => null);
    window.location.assign("/login/");
  }

  if (bare) {
    return <div className="bare">{children}</div>;
  }

  const themeLabel = theme === "light" ? "Oscuro" : theme === "dark" ? "Claro" : "Tema";

  return (
    <div className="app">
      <header className="top">
        <Link href="/gastos/" className="wordmark">
          Cuentix
        </Link>
        <nav className="desk-nav" aria-label="Secciones">
          {LINKS.map((link) => {
            const active = pathname === link.href || (link.href === "/gastos/" && (pathname === "/" || pathname === ""));
            return (
              <Link key={link.href} href={link.href} aria-current={active ? "page" : undefined}>
                {link.label}
              </Link>
            );
          })}
        </nav>
        <div className="top-actions">
          <button type="button" className="ghost" onClick={toggleTheme}>
            {themeLabel}
          </button>
          <button type="button" className="ghost" onClick={() => void logout()}>
            Salir
          </button>
        </div>
      </header>
      <main className="main">{children}</main>
      <nav className="tabbar" aria-label="Secciones">
        {LINKS.map((link) => {
          const active = pathname === link.href || (link.href === "/gastos/" && pathname === "/");
          return (
            <Link key={link.href} href={link.href} aria-current={active ? "page" : undefined}>
              <Icon name={link.icon} />
              <span>{link.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
