import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireApiUser } from "@/lib/api-auth";
import { getDb, schema } from "@/lib/db";
import { getUserHousehold } from "@/lib/household";
import { getLiveRates } from "@/lib/fx/live-rates";
import { refreshWalletUsd } from "@/lib/savings/balances";
import { resolveEvmInput } from "@/lib/ens";

function n(v: unknown): number {
  if (v == null) return 0;
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

function summarize(
  rows: (typeof schema.savingsAssets.$inferSelect)[],
  blueSell: number | null,
) {
  let totalArs = 0;
  let totalUsdBanks = 0;
  let totalUsdCrypto = 0;

  for (const r of rows) {
    if (r.kind === "bank") {
      totalArs += n(r.amountArs);
      totalUsdBanks += n(r.amountUsd);
    } else {
      totalUsdCrypto += n(r.lastBalanceUsd);
    }
  }

  const totalUsd = totalUsdBanks + totalUsdCrypto;
  const rate = blueSell && blueSell > 0 ? blueSell : 0;
  const netArs = totalArs + (rate > 0 ? totalUsd * rate : 0);

  return {
    totalArs,
    totalUsd,
    totalUsdBanks,
    totalUsdc: totalUsdCrypto,
    netArs,
    blueRate: rate || null,
  };
}

export async function GET(req: Request) {
  const authResult = await requireApiUser();
  if ("error" in authResult) return authResult.error;
  const { user } = authResult;

  try {
    const ctx = await getUserHousehold(user.id);
    if (!ctx) {
      return NextResponse.json({ error: "Sin espacio" }, { status: 400 });
    }

    const url = new URL(req.url);
    const shouldRefresh = url.searchParams.get("refresh") === "1";

    const db = (await getDb());
    let rows = await db
      .select()
      .from(schema.savingsAssets)
      .where(eq(schema.savingsAssets.userId, user.id));

    if (shouldRefresh) {
      for (const row of rows) {
        // EVM: saldo a mano. No pegar a DeBank ni guardar errores en la UI.
        if (row.kind !== "cardano" || !row.address) continue;
        const result = await refreshWalletUsd("cardano", row.address);
        await db
          .update(schema.savingsAssets)
          .set({
            lastBalanceUsd:
              result.usd != null ? String(result.usd) : row.lastBalanceUsd,
            lastSyncedAt: new Date(),
            syncError: null,
            updatedAt: new Date(),
          })
          .where(eq(schema.savingsAssets.id, row.id));
      }
      rows = await db
        .select()
        .from(schema.savingsAssets)
        .where(eq(schema.savingsAssets.userId, user.id));
    }

    const live = await getLiveRates();
    const blue = live.rates.find((r) => r.id === "blue")?.value ?? null;
    const summary = summarize(rows, blue);

    return NextResponse.json({
      assets: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        label: r.label,
        address: r.address,
        amountArs: r.amountArs != null ? n(r.amountArs) : null,
        amountUsd: r.amountUsd != null ? n(r.amountUsd) : null,
        lastBalanceUsd:
          r.lastBalanceUsd != null ? n(r.lastBalanceUsd) : null,
        lastSyncedAt: r.lastSyncedAt?.toISOString() ?? null,
        syncError: null,
      })),
      summary,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  const authResult = await requireApiUser();
  if ("error" in authResult) return authResult.error;
  const { user } = authResult;

  try {
    const ctx = await getUserHousehold(user.id);
    if (!ctx) {
      return NextResponse.json({ error: "Sin espacio" }, { status: 400 });
    }

    const body = (await req.json()) as {
      kind?: "evm" | "cardano" | "bank";
      label?: string;
      address?: string;
      ens?: string | null;
      amountArs?: number | null;
      amountUsd?: number | null;
    };

    const kind = body.kind;
    if (kind !== "evm" && kind !== "cardano" && kind !== "bank") {
      return NextResponse.json({ error: "Tipo inválido" }, { status: 400 });
    }

    let label = (body.label || "").trim() || defaultLabel(kind);
    const db = (await getDb());

    if (kind === "bank") {
      const [row] = await db
        .insert(schema.savingsAssets)
        .values({
          userId: user.id,
          householdId: ctx.household.id,
          kind: "bank",
          label,
          amountArs:
            body.amountArs != null ? String(body.amountArs) : null,
          amountUsd:
            body.amountUsd != null ? String(body.amountUsd) : null,
        })
        .returning();
      return NextResponse.json({ asset: row });
    }

    const raw = (body.address || "").trim();
    if (!raw) {
      return NextResponse.json(
        { error: "Falta la dirección o ENS de la wallet" },
        { status: 400 },
      );
    }

    let address = raw;
    let ens: string | null = body.ens ?? null;

    if (kind === "evm") {
      const resolved = await resolveEvmInput(raw);
      if (!resolved.ok) {
        return NextResponse.json({ error: resolved.error }, { status: 400 });
      }
      address = resolved.data.address;
      ens = resolved.data.ens;
      // Prefer ENS as friendly label when user left the default
      if (
        ens &&
        (!body.label ||
          body.label.trim() === "" ||
          body.label.trim() === defaultLabel("evm"))
      ) {
        label = ens;
      }
    }

    let lastBalanceUsd: string | null =
      body.amountUsd != null ? String(body.amountUsd) : null;
    if (kind === "cardano" && lastBalanceUsd == null) {
      const sync = await refreshWalletUsd("cardano", address);
      if (sync.usd != null) lastBalanceUsd = String(sync.usd);
    }
    const [row] = await db
      .insert(schema.savingsAssets)
      .values({
        userId: user.id,
        householdId: ctx.household.id,
        kind,
        label,
        address,
        lastBalanceUsd,
        lastSyncedAt: lastBalanceUsd != null ? new Date() : null,
        syncError: null,
      })
      .returning();

    return NextResponse.json({ asset: row, ens });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 400 },
    );
  }
}

function defaultLabel(kind: "evm" | "cardano" | "bank") {
  if (kind === "evm") return "Wallet EVM";
  if (kind === "cardano") return "Wallet Cardano";
  return "Banco";
}

export async function PATCH(req: Request) {
  const authResult = await requireApiUser();
  if ("error" in authResult) return authResult.error;
  const { user } = authResult;

  try {
    const body = (await req.json()) as {
      id?: string;
      label?: string;
      amountArs?: number | null;
      amountUsd?: number | null;
      address?: string;
      refresh?: boolean;
    };
    if (!body.id) {
      return NextResponse.json({ error: "Falta id" }, { status: 400 });
    }

    const db = (await getDb());
    const [existing] = await db
      .select()
      .from(schema.savingsAssets)
      .where(
        and(
          eq(schema.savingsAssets.id, body.id),
          eq(schema.savingsAssets.userId, user.id),
        ),
      )
      .limit(1);
    if (!existing) {
      return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    }

    const patch: Partial<typeof schema.savingsAssets.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (body.label != null) patch.label = body.label.trim() || existing.label;
    if (existing.kind === "bank") {
      if (body.amountArs !== undefined) {
        patch.amountArs =
          body.amountArs != null ? String(body.amountArs) : null;
      }
      if (body.amountUsd !== undefined) {
        patch.amountUsd =
          body.amountUsd != null ? String(body.amountUsd) : null;
      }
    } else if (body.amountUsd !== undefined) {
      patch.lastBalanceUsd =
        body.amountUsd != null ? String(body.amountUsd) : null;
      patch.lastSyncedAt = new Date();
      patch.syncError = null;
    }
    if (existing.kind !== "bank" && body.address) {
      let nextAddr = body.address.trim();
      if (existing.kind === "evm") {
        const resolved = await resolveEvmInput(nextAddr);
        if (!resolved.ok) {
          return NextResponse.json({ error: resolved.error }, { status: 400 });
        }
        nextAddr = resolved.data.address;
        if (
          resolved.data.ens &&
          (body.label == null ||
            !body.label.trim() ||
            body.label.trim() === defaultLabel("evm"))
        ) {
          patch.label = resolved.data.ens;
        }
      }
      patch.address = nextAddr;
    }

    if (
      body.refresh &&
      existing.kind === "cardano" &&
      (patch.address || existing.address)
    ) {
      const addr = (patch.address as string) || existing.address!;
      const sync = await refreshWalletUsd("cardano", addr);
      if (sync.usd != null) patch.lastBalanceUsd = String(sync.usd);
      patch.lastSyncedAt = new Date();
      patch.syncError = null;
    }

    const [row] = await db
      .update(schema.savingsAssets)
      .set(patch)
      .where(eq(schema.savingsAssets.id, existing.id))
      .returning();

    return NextResponse.json({ asset: row });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 400 },
    );
  }
}

export async function DELETE(req: Request) {
  const authResult = await requireApiUser();
  if ("error" in authResult) return authResult.error;
  const { user } = authResult;

  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Falta id" }, { status: 400 });
    }

    const db = (await getDb());
    await db
      .delete(schema.savingsAssets)
      .where(
        and(
          eq(schema.savingsAssets.id, id),
          eq(schema.savingsAssets.userId, user.id),
        ),
      );

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 400 },
    );
  }
}
