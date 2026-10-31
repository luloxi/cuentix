"use client";

import { useEffect, useState } from "react";
import { apiGet } from "@/lib/api/client";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void apiGet("/api/me", 5000).then((res) => {
      if (cancelled) return;
      if (!res.ok) {
        const next = res.status === 403 ? "/login?error=forbidden" : "/login";
        window.location.replace(next);
        return;
      }
      setReady(true);
    }).catch(() => {
      if (!cancelled) window.location.replace("/login");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready) {
    return (
      <div className="flex flex-1 items-center justify-center py-24 text-sm text-[var(--muted-fg)]">
        Cargando…
      </div>
    );
  }
  return children;
}
