"use client";

import { Toast } from "@/components/ui";

export type GastoCubiertoPrompt = {
  txId: string;
  /** Total matching utility bills (including the edited one). */
  count: number;
  /**
   * true = not marked yet.
   * false = already marked as cubierto; toast only offers bulk apply.
   */
  pending?: boolean;
};

/**
 * Low-friction confirm when marking utility bills as already covered/paid
 * so they stay visible with Tipo Cubierto but drop out of neta.
 */
export function GastoCubiertoToast({
  prompt,
  busy,
  onApply,
  onSoloEste,
  onDismiss,
}: {
  prompt: GastoCubiertoPrompt;
  busy?: boolean;
  onApply: () => void;
  onSoloEste: () => void;
  onDismiss?: () => void;
}) {
  const n = prompt.count;
  return (
    <Toast tone="ok">
      <div className="space-y-2.5">
        <p className="leading-snug">
          ¿Ya está cubierto / pagado este gasto de hogar?
          {n > 1 ? (
            <>
              {" "}
              Aplicar a los {n} gastos iguales de esta cuenta.
            </>
          ) : null}
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onApply}
            className="rounded-lg bg-[var(--brand)] px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-60"
          >
            {busy
              ? "Aplicando…"
              : n > 1
                ? `Sí, a los ${n}`
                : "Sí, cubierto"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onSoloEste}
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-xs font-medium text-[var(--foreground)] disabled:opacity-60"
          >
            {n > 1 ? "Solo este" : "Sí, solo este"}
          </button>
          {onDismiss ? (
            <button
              type="button"
              disabled={busy}
              onClick={onDismiss}
              className="rounded-lg px-2.5 py-1 text-xs font-medium text-[var(--muted)] disabled:opacity-60"
            >
              No
            </button>
          ) : null}
        </div>
      </div>
    </Toast>
  );
}
