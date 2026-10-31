"use client";

/**
 * Compact address display inspired by Scaffold-ETH 2 Address:
 * blockie + ENS or truncated address, copy on click.
 */

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

/** Simple blockie via effigy.im (no extra deps). */
export function AddressBlockie({
  address,
  avatarUrl,
  size = 24,
  className,
}: {
  address: string;
  avatarUrl?: string | null;
  size?: number;
  className?: string;
}) {
  const src =
    avatarUrl ||
    `https://effigy.im/a/${address.toLowerCase()}.svg`;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      className={cn("rounded-full bg-[var(--surface-muted)]", className)}
      style={{ width: size, height: size }}
    />
  );
}

export function AddressDisplay({
  address,
  ens,
  avatarUrl,
  className,
}: {
  address: string;
  ens?: string | null;
  avatarUrl?: string | null;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const short = `${address.slice(0, 6)}…${address.slice(-4)}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(ens || address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      /* ignore */
    }
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      title={address}
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-muted)]/60 px-2 py-0.5 text-left transition hover:bg-[var(--surface-muted)]",
        className,
      )}
    >
      <AddressBlockie address={address} avatarUrl={avatarUrl} size={16} />
      <span className="min-w-0 truncate text-[11px] font-medium">
        {ens ? (
          <span className="text-[var(--brand-fg)]">{ens}</span>
        ) : (
          <span className="font-mono text-[var(--muted-fg)]">{short}</span>
        )}
      </span>
      {copied ? (
        <Check className="h-3 w-3 shrink-0 text-emerald-600" />
      ) : (
        <Copy className="h-3 w-3 shrink-0 text-[var(--muted-fg)]" />
      )}
    </button>
  );
}
