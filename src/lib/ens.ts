/**
 * ENS helpers — resolve name → address and reverse lookup.
 * Uses public endpoints (no wallet client required).
 */

const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;
const ENS_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

export function isEvmAddress(value: string): boolean {
  return ADDR_RE.test(value.trim());
}

export function looksLikeEns(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (v.startsWith("0x")) return false;
  return ENS_RE.test(v) && v.includes(".");
}

export type EnsResolution = {
  address: string;
  ens: string | null;
  avatar: string | null;
};

/**
 * Resolve user input (0x… or name.eth) to a checksum-ish address + optional ENS.
 */
export async function resolveEvmInput(input: string): Promise<
  | { ok: true; data: EnsResolution }
  | { ok: false; error: string }
> {
  const raw = input.trim();
  if (!raw) return { ok: false, error: "Ingresá una address o ENS" };

  if (isEvmAddress(raw)) {
    const address = raw.toLowerCase();
    const reverse = await reverseEns(address);
    return {
      ok: true,
      data: {
        address,
        ens: reverse?.ens ?? null,
        avatar: reverse?.avatar ?? null,
      },
    };
  }

  if (!looksLikeEns(raw)) {
    return {
      ok: false,
      error: "Usá una address 0x… o un nombre ENS (ej. vitalik.eth)",
    };
  }

  const name = raw.toLowerCase();
  try {
    // ensideas: free public resolver
    const res = await fetch(
      `https://api.ensideas.com/ens/resolve/${encodeURIComponent(name)}`,
      {
        headers: { Accept: "application/json" },
        next: { revalidate: 300 },
      },
    );
    if (!res.ok) {
      return { ok: false, error: `No se pudo resolver ${name}` };
    }
    const data = (await res.json()) as {
      address?: string | null;
      name?: string | null;
      avatar?: string | null;
    };
    if (!data.address || !isEvmAddress(data.address)) {
      return { ok: false, error: `${name} no resuelve a una address` };
    }
    return {
      ok: true,
      data: {
        address: data.address.toLowerCase(),
        ens: data.name ?? name,
        avatar: data.avatar ?? null,
      },
    };
  } catch {
    return { ok: false, error: `Error resolviendo ${name}` };
  }
}

async function reverseEns(
  address: string,
): Promise<{ ens: string; avatar: string | null } | null> {
  try {
    const res = await fetch(
      `https://api.ensideas.com/ens/resolve/${encodeURIComponent(address)}`,
      {
        headers: { Accept: "application/json" },
        next: { revalidate: 300 },
      },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      name?: string | null;
      avatar?: string | null;
    };
    if (!data.name) return null;
    return { ens: data.name, avatar: data.avatar ?? null };
  } catch {
    return null;
  }
}

/** Client-side resolve via our API (avoids CORS issues with some providers). */
export async function resolveEvmInputClient(input: string): Promise<
  | { ok: true; data: EnsResolution }
  | { ok: false; error: string }
> {
  const raw = input.trim();
  if (!raw) return { ok: false, error: "Ingresá una address o ENS" };
  if (isEvmAddress(raw) && !looksLikeEns(raw)) {
    // Still try reverse for display; address itself is valid
    try {
      const res = await fetch(
        `/api/ens?q=${encodeURIComponent(raw)}`,
        { credentials: "include" },
      );
      const data = await res.json();
      if (res.ok && data.address) {
        return {
          ok: true,
          data: {
            address: data.address,
            ens: data.ens ?? null,
            avatar: data.avatar ?? null,
          },
        };
      }
    } catch {
      /* fall through */
    }
    return {
      ok: true,
      data: { address: raw.toLowerCase(), ens: null, avatar: null },
    };
  }

  try {
    const res = await fetch(`/api/ens?q=${encodeURIComponent(raw)}`, {
      credentials: "include",
    });
    const data = await res.json();
    if (!res.ok) {
      return { ok: false, error: data.error || "No se pudo resolver" };
    }
    return {
      ok: true,
      data: {
        address: data.address,
        ens: data.ens ?? null,
        avatar: data.avatar ?? null,
      },
    };
  } catch {
    return { ok: false, error: "Error de red resolviendo ENS" };
  }
}
