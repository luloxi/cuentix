"use client";

/**
 * Address input inspired by Scaffold-ETH 2 AddressInput:
 * - accepts 0x address or ENS
 * - debounced resolution
 * - blockie / ENS avatar
 * - shows resolved address under the field
 * Styled with Cuentix tokens (lc-input).
 */

import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  isEvmAddress,
  looksLikeEns,
  resolveEvmInputClient,
  type EnsResolution,
} from "@/lib/ens";
import { AddressBlockie } from "@/components/address-display";

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function AddressInput({
  value,
  onChange,
  onResolved,
  placeholder = "0x… o nombre.eth",
  disabled,
  className,
}: {
  /** Controlled raw input (what the user types). */
  value: string;
  onChange: (raw: string) => void;
  /** Fired when resolution succeeds with canonical address (+ optional ENS). */
  onResolved?: (data: EnsResolution | null) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const debounced = useDebounced(value.trim(), 450);
  const [status, setStatus] = useState<
    "idle" | "loading" | "ok" | "error"
  >("idle");
  const [resolved, setResolved] = useState<EnsResolution | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!debounced) {
        setStatus("idle");
        setResolved(null);
        setError(null);
        onResolved?.(null);
        return;
      }

      const maybeAddress = isEvmAddress(debounced);
      const maybeEns = looksLikeEns(debounced);
      if (!maybeAddress && !maybeEns) {
        setStatus("error");
        setResolved(null);
        setError("Address 0x… o ENS (ej. vitalik.eth)");
        onResolved?.(null);
        return;
      }

      setStatus("loading");
      setError(null);
      const result = await resolveEvmInputClient(debounced);
      if (cancelled) return;

      if (!result.ok) {
        setStatus("error");
        setResolved(null);
        setError(result.error);
        onResolved?.(null);
        return;
      }

      setStatus("ok");
      setResolved(result.data);
      onResolved?.(result.data);
    }

    void run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onResolved is stable enough for UX
  }, [debounced]);

  const showAvatar = useMemo(() => {
    if (resolved?.address) return resolved.address;
    if (isEvmAddress(value.trim())) return value.trim().toLowerCase();
    return null;
  }, [resolved, value]);

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="relative">
        <div className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2">
          {showAvatar ? (
            <AddressBlockie
              address={showAvatar}
              avatarUrl={resolved?.avatar}
              size={22}
            />
          ) : (
            <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-[var(--surface-muted)] text-[10px] text-[var(--muted-fg)]">
              0x
            </span>
          )}
        </div>
        <input
          className={cn(
            "lc-input w-full !pl-10 !pr-10 font-mono text-sm",
            status === "error" && "border-red-400 focus:border-red-500",
            status === "ok" && "border-emerald-400/80",
          )}
          placeholder={placeholder}
          value={value}
          disabled={disabled}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          onChange={(e) => onChange(e.target.value.trimStart())}
        />
        <div className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2">
          {status === "loading" && (
            <Loader2 className="h-4 w-4 animate-spin text-[var(--muted-fg)]" />
          )}
          {status === "ok" && (
            <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          )}
          {status === "error" && value.trim() && (
            <X className="h-4 w-4 text-red-500" />
          )}
        </div>
      </div>

      {status === "ok" && resolved && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-0.5 text-[11px] text-[var(--muted-fg)]">
          {resolved.ens && (
            <span className="font-medium text-[var(--brand-fg)]">
              {resolved.ens}
            </span>
          )}
          <span className="font-mono">
            {resolved.address.slice(0, 6)}…{resolved.address.slice(-4)}
          </span>
        </p>
      )}
      {status === "error" && error && (
        <p className="px-0.5 text-[11px] text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
