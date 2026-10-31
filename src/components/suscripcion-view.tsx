"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CreditCard } from "lucide-react";
import { PageHeader, PageStack, Surface } from "@/components/ui";
import { formatArs, formatDateAr } from "@/lib/utils";

type SubRow = {
  polarSubscriptionId: string;
  status: string;
  currentPeriodEnd: string | null;
};

type Payload = {
  configured: boolean;
  plan: { name: string; amountArs: number; interval: string };
  subscription: SubRow | null;
};

function statusLabel(status: string): string {
  switch (status) {
    case "active":
      return "Activa";
    case "trialing":
      return "En prueba";
    case "past_due":
      return "Pago pendiente";
    case "canceled":
      return "Cancelada";
    case "unpaid":
      return "Impaga";
    case "incomplete":
      return "Incompleta";
    case "incomplete_expired":
      return "Venció el alta";
    default:
      return status;
  }
}

function isLive(status: string): boolean {
  return status === "active" || status === "trialing";
}

export function SuscripcionView() {
  const search = useSearchParams();
  const checkoutOk = search.get("checkout") === "ok";
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/billing/subscription", { credentials: "include" })
      .then(async (res) => {
        const json = (await res.json().catch(() => null)) as
          | (Payload & { error?: string })
          | null;
        if (cancelled) return;
        if (!res.ok) {
          setError(json?.error || `Error ${res.status}`);
          return;
        }
        if (json) setData(json);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Error de red");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function subscribe() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        credentials: "include",
      });
      const json = (await res.json().catch(() => null)) as {
        url?: string;
        error?: string;
        code?: string;
      } | null;
      if (!res.ok || !json?.url) {
        setError(json?.error || "Falta configurar Polar");
        return;
      }
      window.location.href = json.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
    } finally {
      setBusy(false);
    }
  }

  const configured = data?.configured ?? false;
  const sub = data?.subscription;
  const amount = data?.plan.amountArs ?? 9990;
  const live = sub ? isLive(sub.status) : false;

  return (
    <PageStack>
      <PageHeader
        eyebrow="Plan"
        title="Suscripción"
        description="Pro sin publicidades. El cupo de IA lo vemos más adelante."
      />

      {checkoutOk && (
        <p className="rounded-xl border border-[var(--brand)]/30 bg-[var(--brand-soft)] px-4 py-3 text-sm text-[var(--brand-fg)]">
          Listo, Polar confirmó el pago. En un toque se actualiza el estado de
          tu plan.
        </p>
      )}

      {error && (
        <p className="rounded-xl border border-red-300/50 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </p>
      )}

      <Surface elevated>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--brand-fg)]">
              Pro
            </p>
            <p className="mt-1 text-3xl font-semibold tabular-nums tracking-tight">
              {formatArs(amount)}
              <span className="ml-1 text-base font-medium text-[var(--muted-fg)]">
                / mes
              </span>
            </p>
            <p className="mt-2 max-w-sm text-sm text-[var(--muted-fg)]">
              9.990 ARS/mes. Polar cobra en pesos si el producto está en ARS.
            </p>
          </div>
          <CreditCard
            className="h-8 w-8 text-[var(--brand-fg)]"
            strokeWidth={1.5}
            aria-hidden
          />
        </div>

        <div className="mt-5 border-t border-[var(--border)] pt-4">
          {loading ? (
            <p className="text-sm text-[var(--muted-fg)]">Cargando plan…</p>
          ) : !configured ? (
            <p className="rounded-xl bg-[var(--surface-muted)] px-3 py-2.5 text-sm text-[var(--muted-fg)]">
              Falta configurar Polar
            </p>
          ) : live ? (
            <div className="space-y-1">
              <p className="text-sm font-medium text-[var(--brand-fg)]">
                {statusLabel(sub!.status)}
              </p>
              {sub?.currentPeriodEnd && (
                <p className="text-sm text-[var(--muted-fg)]">
                  Período actual hasta el {formatDateAr(sub.currentPeriodEnd)}
                </p>
              )}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void subscribe()}
                disabled={busy}
                className="lc-btn lc-btn-primary"
              >
                {busy ? "Abriendo Polar…" : "Suscribirse"}
              </button>
              {sub && (
                <p className="text-sm text-[var(--muted-fg)]">
                  Último estado: {statusLabel(sub.status)}
                  {sub.currentPeriodEnd
                    ? ` · hasta el ${formatDateAr(sub.currentPeriodEnd)}`
                    : ""}
                </p>
              )}
            </div>
          )}
        </div>
      </Surface>
    </PageStack>
  );
}
