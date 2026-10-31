/**
 * On-chain balance helpers for Ahorros.
 * EVM: DeBank OpenAPI (optional DEBANK_ACCESS_KEY).
 * Cardano: Koios address assets + CoinGecko prices.
 */

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function fetchEvmTotalUsd(address: string): Promise<{
  usd: number | null;
  error?: string;
}> {
  const addr = address.trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(addr)) {
    return { usd: null };
  }

  const key =
    process.env.DEBANK_ACCESS_KEY ||
    process.env.DEBANK_API_KEY ||
    process.env.DEBANK_ACCESSKEY ||
    "";

  // Sin clave no pegamos a la API pública (falla y ensucia la UI).
  // El saldo EVM se carga a mano; DeBank es un link para chequear.
  if (!key) return { usd: null };

  try {
    const res = await fetch(
      `https://pro-openapi.debank.com/v1/user/total_balance?id=${encodeURIComponent(addr)}`,
      {
        headers: {
          Accept: "application/json",
          AccessKey: key,
        },
        next: { revalidate: 0 },
      },
    );
    if (!res.ok) return { usd: null };
    const data = (await res.json()) as { total_usd_value?: number };
    const usd = num(data.total_usd_value);
    return { usd: usd ?? 0 };
  } catch {
    return { usd: null };
  }
}

async function fetchCoinGeckoPrices(ids: string[]): Promise<Map<string, number>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const map = new Map<string, number>();
  if (unique.length === 0) return map;
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(unique.join(","))}&vs_currencies=usd`,
      { next: { revalidate: 120 } },
    );
    if (!res.ok) return map;
    const data = (await res.json()) as Record<string, { usd?: number }>;
    for (const id of unique) {
      const v = num(data[id]?.usd);
      if (v != null) map.set(id, v);
    }
  } catch {
    /* ignore */
  }
  return map;
}

export async function fetchCardanoTotalUsd(address: string): Promise<{
  usd: number | null;
  error?: string;
}> {
  const addr = address.trim();
  if (!/^(addr1|addr_test1)[a-z0-9]+$/i.test(addr)) {
    return { usd: null, error: "Dirección Cardano inválida (addr1…)" };
  }

  try {
    const res = await fetch("https://api.koios.rest/api/v1/address_info", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ _addresses: [addr] }),
      next: { revalidate: 0 },
    });
    if (!res.ok) {
      return { usd: null, error: `Koios ${res.status}` };
    }
    const rows = (await res.json()) as Array<{
      balance?: string;
      utxo_set?: Array<{
        asset_list?: Array<{ unit?: string; quantity?: string }>;
      }>;
    }>;
    const row = rows[0];
    if (!row) return { usd: 0 };

    const qty = new Map<string, number>();
    const lovelace = num(row.balance);
    if (lovelace != null) qty.set("lovelace", lovelace);

    for (const u of row.utxo_set ?? []) {
      for (const a of u.asset_list ?? []) {
        if (!a.unit || !a.quantity) continue;
        const q = num(a.quantity) ?? 0;
        qty.set(a.unit, (qty.get(a.unit) ?? 0) + q);
      }
    }

    const prices = await fetchCoinGeckoPrices(["cardano"]);
    const adaPrice = prices.get("cardano") ?? 0;
    const ada = (qty.get("lovelace") ?? 0) / 1_000_000;
    const usd = ada * adaPrice;

    return { usd };
  } catch (e) {
    return {
      usd: null,
      error: e instanceof Error ? e.message : "Error consultando Cardano",
    };
  }
}

export async function refreshWalletUsd(
  kind: "evm" | "cardano",
  address: string,
): Promise<{ usd: number | null; error?: string }> {
  if (kind === "evm") return fetchEvmTotalUsd(address);
  return fetchCardanoTotalUsd(address);
}
