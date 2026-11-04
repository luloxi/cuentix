"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";

type Me = {
  household: { id: string; name: string; role: string } | null;
  error?: string;
};

export function OnboardingView() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/me", { credentials: "include" })
      .then(async (res) => {
        if (res.status === 401) {
          window.location.replace("/login");
          return;
        }
        const body = (await res.json().catch(() => null)) as Me | null;
        if (cancelled) return;
        if (!res.ok) {
          setError(body?.error || `Error ${res.status}`);
          return;
        }
        setMe(body);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Error de red");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const household = me?.household ?? null;

  return (
    <div className="app-shell mx-auto w-full max-w-md space-y-5 px-1">
      <div className="text-center">
        <div className="mb-4 flex justify-center">
          <BrandLogo size={48} />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Tu espacio</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-[var(--muted-fg)]">
          {household
            ? "Este hogar ya está en la cuenta."
            : "Acá se ve si la cuenta ya tiene un hogar."}
        </p>
      </div>

      {error && <p className="text-center text-sm text-red-600">{error}</p>}

      {!me && !error && (
        <p className="text-center text-sm text-[var(--muted-fg)]">Cargando…</p>
      )}

      {household && (
        <div className="lc-card space-y-4 p-5 text-center">
          <p className="text-lg font-semibold">{household.name}</p>
          <p className="text-sm text-[var(--muted-fg)]">
            Rol: {household.role === "owner" ? "dueño" : "miembro"}
          </p>
          <Link href="/dashboard" className="lc-btn lc-btn-primary w-full">
            Ir al inicio
          </Link>
        </div>
      )}

      {me && !household && (
        <div className="lc-card space-y-4 p-5">
          <p className="text-sm leading-relaxed text-[var(--muted-fg)]">
            Esta cuenta no tiene un hogar todavía. Crear uno o entrar con un
            código escribe filas nuevas, y esta versión del worker solo lee.
          </p>
          <Link href="/login" className="lc-btn lc-btn-secondary w-full">
            Volver a entrar
          </Link>
        </div>
      )}
    </div>
  );
}
