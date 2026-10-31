"use client";

import { useEffect } from "react";

export default function HomePage() {
  useEffect(() => {
    void fetch("/api/me", { credentials: "include" })
      .then((res) => {
        window.location.replace(res.ok ? "/dashboard" : "/login");
      })
      .catch(() => {
        window.location.replace("/login");
      });
  }, []);

  return (
    <main className="flex min-h-dvh items-center justify-center text-sm text-[var(--muted-fg)]">
      Cargando…
    </main>
  );
}
