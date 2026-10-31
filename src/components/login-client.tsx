"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { BrandLogo } from "@/components/brand-logo";

function GoogleMark() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

const FEATURES = [
  {
    title: "Importá tu tarjeta",
    desc: "Subí el Excel de movimientos y se categoriza solo.",
  },
  {
    title: "Tickets con foto",
    desc: "Sacá una foto al ticket y lo vinculamos al gasto del día.",
  },
  {
    title: "Gastos compartidos",
    desc: "Marcá lo personal o compartido y mirá el balance del grupo.",
  },
];

export function LoginClient() {
  const params = useSearchParams();
  const error = params.get("error") ?? undefined;
  const [loading, setLoading] = useState(false);

  function signInGoogle() {
    setLoading(true);
    window.location.assign("/api/auth/google");
  }

  return (
    <div className="relative flex h-dvh w-full flex-col overflow-hidden">
      {/* Ambient background */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_#ecfdf5_0%,_transparent_55%),radial-gradient(ellipse_at_bottom_right,_#d1fae5_0%,_transparent_45%)] dark:bg-[radial-gradient(ellipse_at_top,_#064e3b33_0%,_transparent_55%),radial-gradient(ellipse_at_bottom_right,_#065f4633_0%,_transparent_45%)]" />
        <div className="absolute -left-24 top-16 h-72 w-72 rounded-full bg-emerald-400/20 blur-3xl dark:bg-emerald-500/10" />
        <div className="absolute -right-16 bottom-10 h-80 w-80 rounded-full bg-teal-300/25 blur-3xl dark:bg-teal-600/10" />
        <div
          className="absolute inset-0 opacity-[0.35] dark:opacity-[0.12]"
          style={{
            backgroundImage:
              "linear-gradient(to right, rgb(16 185 129 / 0.07) 1px, transparent 1px), linear-gradient(to bottom, rgb(16 185 129 / 0.07) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
            maskImage:
              "radial-gradient(ellipse at center, black 20%, transparent 75%)",
          }}
        />
      </div>

      <div className="mx-auto flex h-full w-full max-w-6xl flex-1 flex-col px-5 py-6 sm:px-8 sm:py-8 lg:flex-row lg:items-center lg:gap-12 lg:py-10">
        {/* Pitch */}
        <section className="flex min-h-0 flex-1 flex-col justify-center lg:max-w-xl">
          <div className="mb-5 flex items-center gap-3 sm:mb-7">
            <BrandLogo size={44} />
            <span className="text-lg font-semibold tracking-tight sm:text-xl">
              Cuentix
            </span>
          </div>

          <h1 className="text-balance text-3xl font-bold leading-[1.1] tracking-tight sm:text-4xl lg:text-5xl">
            Tus gastos, claros.
            <span className="mt-1 block bg-gradient-to-r from-emerald-600 to-teal-500 bg-clip-text text-transparent dark:from-emerald-400 dark:to-teal-300">
              Sin planillas eternas.
            </span>
          </h1>

          <p className="mt-3 max-w-md text-pretty text-sm leading-relaxed text-zinc-600 sm:mt-4 sm:text-base dark:text-zinc-400">
            Importá movimientos de tarjeta, fotografiá tickets y compartí el
            espacio con quien quieras. Todo en un solo lugar.
          </p>

          {/* Feature row — compact, no scroll */}
          <ul className="mt-5 hidden gap-3 sm:mt-7 sm:grid sm:grid-cols-3 lg:mt-8">
            {FEATURES.map((f) => (
              <li
                key={f.title}
                className="rounded-2xl border border-emerald-900/8 bg-white/70 p-3.5 shadow-sm backdrop-blur dark:border-white/10 dark:bg-zinc-950/50"
              >
                <p className="text-sm font-semibold tracking-tight">{f.title}</p>
                <p className="mt-1 text-xs leading-snug text-zinc-500 dark:text-zinc-400">
                  {f.desc}
                </p>
              </li>
            ))}
          </ul>

          {/* Mobile feature chips */}
          <div className="mt-4 flex flex-wrap gap-2 sm:hidden">
            {FEATURES.map((f) => (
              <span
                key={f.title}
                className="rounded-full border border-emerald-900/10 bg-white/80 px-3 py-1 text-xs font-medium text-emerald-900 dark:border-white/10 dark:bg-zinc-900/70 dark:text-emerald-100"
              >
                {f.title}
              </span>
            ))}
          </div>
        </section>

        {/* Auth card + preview */}
        <section className="mt-6 flex w-full shrink-0 flex-col justify-center lg:mt-0 lg:w-[380px]">
          {/* Mini product preview */}
          <div className="mb-4 hidden overflow-hidden rounded-3xl border border-emerald-900/10 bg-white/80 p-4 shadow-xl shadow-emerald-900/5 backdrop-blur sm:block dark:border-white/10 dark:bg-zinc-950/60 dark:shadow-black/30">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-500">Este mes</span>
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                en vivo
              </span>
            </div>
            <p className="text-2xl font-semibold tracking-tight tabular-nums">
              $ 482.340
            </p>
            <p className="mt-0.5 text-xs text-zinc-500">42 movimientos · 3 compartidos</p>
            <div className="mt-4 grid grid-cols-3 gap-2">
              {[
                { l: "Súper", v: "38%" },
                { l: "Delivery", v: "14%" },
                { l: "Transporte", v: "11%" },
              ].map((c) => (
                <div
                  key={c.l}
                  className="rounded-xl bg-emerald-50/80 px-2 py-2 dark:bg-emerald-950/40"
                >
                  <div className="text-[10px] text-zinc-500">{c.l}</div>
                  <div className="text-sm font-semibold tabular-nums">{c.v}</div>
                </div>
              ))}
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
              <div className="h-full w-[62%] rounded-full bg-gradient-to-r from-emerald-500 to-teal-400" />
            </div>
          </div>

          <div className="rounded-3xl border border-emerald-900/10 bg-white/85 p-5 shadow-xl shadow-emerald-900/5 backdrop-blur dark:border-white/10 dark:bg-zinc-950/70 dark:shadow-black/40 sm:p-6">
            <p className="text-center text-sm font-medium text-zinc-700 dark:text-zinc-200">
              Entrá para empezar
            </p>

            <div className="mt-4 space-y-3">
              {error === "forbidden" && (
                <p className="rounded-xl bg-amber-50 p-3 text-center text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
                  Tu cuenta todavía no tiene acceso. Pedile al admin que te
                  habilite.
                </p>
              )}
              {error === "domain" && (
                <p className="rounded-xl bg-amber-50 p-3 text-center text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
                  El dominio de la app no está configurado en Auth. Revisá la
                  config del proyecto.
                </p>
              )}
              {error === "oauth" && (
                <p className="rounded-xl bg-red-50 p-3 text-center text-sm text-red-700 dark:bg-red-950/40 dark:text-red-200">
                  No se pudo completar el login. Reintentá.
                </p>
              )}
              {error === "auth_not_configured" && (
                <p className="rounded-xl bg-amber-50 p-3 text-center text-sm text-amber-900">
                  Auth no está listo en este entorno.
                </p>
              )}
              {error === "unverified" && (
                <p className="rounded-xl bg-amber-50 p-3 text-center text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
                  Google no confirmó el email. Entrá con una cuenta verificada.
                </p>
              )}
              <button
                type="button"
                disabled={loading}
                onClick={signInGoogle}
                className="flex w-full cursor-pointer items-center justify-center gap-2.5 rounded-2xl bg-zinc-900 px-4 py-3.5 text-sm font-medium text-white shadow-lg shadow-zinc-900/20 transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-100"
              >
                <GoogleMark />
                {loading ? "Redirigiendo…" : "Continuar con Google"}
              </button>
            </div>

            <p className="mt-4 text-center text-[11px] leading-relaxed text-zinc-400">
              Acceso por invitación · Tus datos quedan en tu espacio
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
