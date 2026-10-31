"use client";

import { useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";

const KEYS = {
  debt: "lc:home-show-debt",
  hogar: "lc:home-show-hogar",
} as const;

export type HomeVisibilitySection = keyof typeof KEYS;

function loadShow(key: string): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return true;
    return raw !== "0" && raw !== "false";
  } catch {
    return true;
  }
}

function saveShow(key: string, show: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, show ? "1" : "0");
}

export function HomeVisibilityToggle({
  section,
  className,
}: {
  section: HomeVisibilitySection;
  className?: string;
}) {
  const key = KEYS[section];
  const [showOnHome, setShowOnHome] = useState(true);

  useEffect(() => {
    setShowOnHome(loadShow(key));
  }, [key]);

  function toggle() {
    const next = !showOnHome;
    setShowOnHome(next);
    saveShow(key, next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-medium transition",
        showOnHome
          ? "border-[var(--border)] bg-[var(--surface)] text-[var(--muted-fg)] hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]"
          : "border-zinc-300 bg-zinc-100 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400",
        className,
      )}
      title={
        showOnHome
          ? "Ocultar esta tarjeta del inicio"
          : "Mostrar esta tarjeta en el inicio"
      }
    >
      {showOnHome ? (
        <>
          <EyeOff className="h-3.5 w-3.5" strokeWidth={1.75} />
          Ocultar del inicio
        </>
      ) : (
        <>
          <Eye className="h-3.5 w-3.5" strokeWidth={1.75} />
          Mostrar en inicio
        </>
      )}
    </button>
  );
}
