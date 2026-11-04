"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { SECTION_TABS, activeSectionTab, type SectionId } from "@/lib/nav";

/**
 * Chips de segundo nivel dentro de una pestaña (Movimientos, Patrimonio, Hogar).
 * Son enlaces comunes: cada chip es una ruta de siempre, así que nada se perdió.
 */
export function SectionNav({ section }: { section: SectionId }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const active = activeSectionTab(section, pathname, searchParams.get("tab"));
  return (
    <nav className="lc-chips" aria-label="Ver" data-no-swipe>
      {SECTION_TABS[section].map((t) => (
        <Link
          key={t.id}
          href={t.href}
          scroll={false}
          replace
          className="lc-chip"
          data-active={active === t.id}
          aria-current={active === t.id ? "page" : undefined}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
