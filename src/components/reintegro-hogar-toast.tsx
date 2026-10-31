"use client";

import { Toast } from "@/components/ui";

export type ReintegroHogarPrompt = {
  txId: string;
  /** Total matching outbound payments (including the edited one). */
  count: number;
  /**
   * true = not marked yet (intercepted Hogar assign / edit).
   * false = already marked as reintegro; toast only offers bulk apply.
   */
  pending?: boolean;
  /** If user says No, continue as shared Hogar gasto. */
  declineToShared?: boolean;
};

/**
 * Option C: low-friction confirm when editing roommate reimbursements
 * for rent/utilities already paid — apply as reintegro (not personal gasto,
 * not a second Hogar bill).
 */
export function ReintegroHogarToast({
  prompt,
  busy,
  onApply,
  onSoloEste,
  onDismiss,
}: {
  prompt: ReintegroHogarPrompt;
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
          ¿Es reintegro de servicios del hogar?
          {n > 1 ? (
            <>
              {" "}
              Aplicar a los {n} pagos iguales de esta cuenta.
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
                : "Sí, es reintegro"}
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
