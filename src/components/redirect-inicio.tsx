"use client";

import { useEffect } from "react";

/**
 * Static export has no server redirects. Hidden sections (billing, upload)
 * send the browser to Inicio.
 */
export function RedirectInicio() {
  useEffect(() => {
    window.location.replace("/");
  }, []);

  return (
    <>
      <meta httpEquiv="refresh" content="0;url=/" />
      <p className="text-sm text-[var(--muted-fg)]">Cargando…</p>
    </>
  );
}
