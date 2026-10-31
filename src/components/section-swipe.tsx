"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  SWIPE_PATH,
  resolveSwipeIndex,
  stepToHref,
} from "@/lib/swipe-path";

const MIN_DX = 56;
const HORIZONTAL_RATIO = 1.15;

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const el = target.closest(
    "input, textarea, select, button, a, [role='button'], [contenteditable='true'], [data-no-swipe]",
  );
  return el != null;
}

/**
 * One continuous horizontal swipe across the whole app:
 * Inicio → Lista → Resumen → Gráficos → Evolución → Pagos → Hogar → Gráficos hogar
 *
 * Listens on the document so swipes work on page background and empty areas,
 * not only over content cards.
 */
export function SectionSwipe({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();

  const startX = useRef(0);
  const startY = useRef(0);
  const tracking = useRef(false);
  const pathnameRef = useRef(pathname);
  const tabRef = useRef(searchParams.get("tab"));
  const routerRef = useRef(router);

  useEffect(() => {
    pathnameRef.current = pathname;
    tabRef.current = searchParams.get("tab");
    routerRef.current = router;
  }, [pathname, searchParams, router]);

  useEffect(() => {
    function onTouchStart(e: TouchEvent) {
      const t = e.touches[0];
      if (!t) return;
      // Allow starting on background and content; skip pure form fields mid-edit
      if (isInteractiveTarget(e.target) && e.target instanceof HTMLInputElement) {
        // still allow swipe if started on non-focused empty space near inputs
      }
      startX.current = t.clientX;
      startY.current = t.clientY;
      tracking.current = true;
    }

    function onTouchEnd(e: TouchEvent) {
      if (!tracking.current) return;
      tracking.current = false;
      const t = e.changedTouches[0];
      if (!t) return;

      // Don't hijack intentional taps on buttons/links (tiny movement)
      const dx = t.clientX - startX.current;
      const dy = t.clientY - startY.current;
      if (Math.abs(dx) < MIN_DX) return;
      if (Math.abs(dx) < Math.abs(dy) * HORIZONTAL_RATIO) return;

      // Avoid fighting horizontal scroll containers (tables, carousels)
      if (e.target instanceof Element) {
        const scrollParent = e.target.closest(
          "[data-no-swipe], .lc-table-wrap, [style*='overflow-x']",
        );
        if (scrollParent) {
          const el = scrollParent as HTMLElement;
          if (el.scrollWidth > el.clientWidth + 8) return;
        }
      }

      const idx = resolveSwipeIndex(pathnameRef.current, tabRef.current);
      if (idx < 0) return;

      const nextIdx = dx < 0 ? idx + 1 : idx - 1;
      if (nextIdx < 0 || nextIdx >= SWIPE_PATH.length) return;

      const step = SWIPE_PATH[nextIdx]!;
      routerRef.current.push(stepToHref(step));
    }

    function onTouchCancel() {
      tracking.current = false;
    }

    // Capture phase so we still see events even if children stopPropagation
    document.addEventListener("touchstart", onTouchStart, {
      passive: true,
      capture: true,
    });
    document.addEventListener("touchend", onTouchEnd, {
      passive: true,
      capture: true,
    });
    document.addEventListener("touchcancel", onTouchCancel, {
      passive: true,
      capture: true,
    });

    return () => {
      document.removeEventListener("touchstart", onTouchStart, true);
      document.removeEventListener("touchend", onTouchEnd, true);
      document.removeEventListener("touchcancel", onTouchCancel, true);
    };
  }, []);

  return <div className="min-h-full">{children}</div>;
}
