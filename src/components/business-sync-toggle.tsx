"use client";

import { Briefcase } from "lucide-react";
import { cn } from "@/lib/utils";

export type SyncStatus = "sent" | "pending" | "error";

const STATUS_LABEL: Record<SyncStatus, string> = {
  sent: "Enviado a Serpix",
  pending: "Pendiente de envío",
  error: "Error de envío",
};

/**
 * "Del negocio" toggle. Personal movements that are not card payments.
 * The chip reads the latest outbox row (sent / pending / error).
 */
export function BusinessSyncToggle({
  isBusiness,
  syncStatus,
  canMark,
  disabled,
  onToggle,
}: {
  isBusiness: boolean;
  syncStatus: SyncStatus | null;
  canMark: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  const showToggle = canMark || isBusiness;
  if (!showToggle && !syncStatus) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {showToggle ? (
        <button
          type="button"
          aria-pressed={isBusiness}
          aria-label={isBusiness ? "Sacar del negocio" : "Marcar como del negocio"}
          disabled={disabled}
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          className={cn(
            "inline-flex cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition",
            isBusiness
              ? "border-amber-400 bg-amber-50 text-amber-950 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-100"
              : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800",
            disabled && "cursor-not-allowed opacity-60",
          )}
        >
          <Briefcase className="h-3.5 w-3.5" aria-hidden />
          Del negocio
        </button>
      ) : null}
      {syncStatus ? (
        <span
          className={cn(
            "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium",
            syncStatus === "sent" &&
              "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-100",
            syncStatus === "pending" &&
              "bg-amber-100 text-amber-950 dark:bg-amber-950/50 dark:text-amber-100",
            syncStatus === "error" &&
              "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-200",
          )}
        >
          {STATUS_LABEL[syncStatus]}
        </span>
      ) : null}
    </div>
  );
}
