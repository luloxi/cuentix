"use client";

import { Toast } from "@/components/ui";

export type ApplyCriterionPrompt = {
  txId: string;
  categoryId: string;
  /** Total matching gastos on this account (including the edited one). */
  count: number;
};

export function ApplyCriterionToast({
  prompt,
  busy,
  onApply,
  onSoloEste,
}: {
  prompt: ApplyCriterionPrompt;
  busy?: boolean;
  onApply: () => void;
  onSoloEste: () => void;
}) {
  const n = prompt.count;
  return (
    <Toast tone="ok">
      <div className="space-y-2.5">
        <p className="leading-snug">
          ¿Aplicar a los {n} gasto{n === 1 ? "" : "s"} de esta cuenta?
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onApply}
            className="rounded-lg bg-[var(--brand)] px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-60"
          >
            {busy ? "Aplicando…" : "Aplicar"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onSoloEste}
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-xs font-medium text-[var(--foreground)] disabled:opacity-60"
          >
            Solo este
          </button>
        </div>
      </div>
    </Toast>
  );
}
