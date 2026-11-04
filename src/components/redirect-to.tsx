"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Rutas viejas que ahora viven dentro de otra pantalla (sin perder el enlace).
 * Static export no tiene redirects de servidor, así que se hace en el cliente.
 */
export function RedirectTo({ href }: { href: string }) {
  const router = useRouter();
  useEffect(() => {
    router.replace(href);
  }, [router, href]);
  return (
    <>
      <meta httpEquiv="refresh" content={`0;url=${href}`} />
      <p className="text-[15px] text-[var(--muted-fg)]">Cargando…</p>
    </>
  );
}
