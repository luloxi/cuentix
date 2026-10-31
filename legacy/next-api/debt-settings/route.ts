import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireApiUser } from "@/lib/api-auth";
import { getDb, schema } from "@/lib/db";

function n(v: unknown): number | null {
  if (v == null || v === "") return null;
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : null;
}

function serialize(row: typeof schema.debtSettings.$inferSelect | undefined) {
  if (!row) {
    return {
      ratePct: null as number | null,
      minPaymentArs: null as number | null,
      dueDay: null as number | null,
      notes: null as string | null,
      forceSettled: false,
      clearedAt: null as string | null,
      cardLast4: null as string | null,
      saldoDeudaArs: null as number | null,
      saldoDeudaUsd: null as number | null,
      updatedAt: null as string | null,
    };
  }
  return {
    ratePct: row.ratePct != null ? Number(row.ratePct) : null,
    minPaymentArs: row.minPaymentArs != null ? Number(row.minPaymentArs) : null,
    dueDay: row.dueDay ?? null,
    notes: row.notes ?? null,
    forceSettled: Boolean(row.forceSettled),
    clearedAt: row.clearedAt?.toISOString() ?? null,
    cardLast4: row.cardLast4 ?? null,
    saldoDeudaArs: row.saldoDeudaArs != null ? Number(row.saldoDeudaArs) : null,
    saldoDeudaUsd: row.saldoDeudaUsd != null ? Number(row.saldoDeudaUsd) : null,
    updatedAt: row.updatedAt?.toISOString() ?? null,
  };
}

export async function GET() {
  const authResult = await requireApiUser();
  if ("error" in authResult) return authResult.error;
  const { user } = authResult;

  try {
    const db = (await getDb());
    const [row] = await db
      .select()
      .from(schema.debtSettings)
      .where(eq(schema.debtSettings.userId, user.id))
      .limit(1);
    return NextResponse.json({ settings: serialize(row) });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}

export async function PATCH(req: Request) {
  const authResult = await requireApiUser();
  if ("error" in authResult) return authResult.error;
  const { user } = authResult;

  try {
    const body = (await req.json()) as {
      ratePct?: number | null;
      minPaymentArs?: number | null;
      dueDay?: number | null;
      notes?: string | null;
      forceSettled?: boolean | null;
      cardLast4?: string | null;
      saldoDeudaArs?: number | null;
      saldoDeudaUsd?: number | null;
    };

    let dueDay: number | null | undefined = undefined;
    if (body.dueDay !== undefined) {
      if (body.dueDay == null || body.dueDay === ("" as unknown)) {
        dueDay = null;
      } else {
        const d = Math.round(Number(body.dueDay));
        if (!Number.isFinite(d) || d < 1 || d > 31) {
          return NextResponse.json(
            { error: "El día de vencimiento tiene que ser entre 1 y 31" },
            { status: 400 },
          );
        }
        dueDay = d;
      }
    }

    const ratePct = body.ratePct !== undefined ? n(body.ratePct) : undefined;
    const minPaymentArs =
      body.minPaymentArs !== undefined ? n(body.minPaymentArs) : undefined;
    const notes =
      body.notes !== undefined
        ? body.notes == null
          ? null
          : String(body.notes).trim() || null
        : undefined;

    let forceSettled: boolean | undefined = undefined;
    let clearedAt: Date | null | undefined = undefined;
    if (body.forceSettled !== undefined) {
      forceSettled = Boolean(body.forceSettled);
      clearedAt = forceSettled ? new Date() : null;
    }

    let cardLast4: string | null | undefined = undefined;
    if (body.cardLast4 !== undefined) {
      if (body.cardLast4 == null || body.cardLast4 === "") {
        cardLast4 = null;
      } else {
        const m = String(body.cardLast4).match(/(\d{4})\s*$/);
        cardLast4 = m ? m[1] : String(body.cardLast4).trim().slice(-4);
      }
    }

    const saldoDeudaArs =
      body.saldoDeudaArs !== undefined ? n(body.saldoDeudaArs) : undefined;
    const saldoDeudaUsd =
      body.saldoDeudaUsd !== undefined ? n(body.saldoDeudaUsd) : undefined;

    if (ratePct != null && (ratePct < 0 || ratePct > 1000)) {
      return NextResponse.json(
        { error: "La tasa parece rara (0–1000%)" },
        { status: 400 },
      );
    }

    const db = (await getDb());
    const [existing] = await db
      .select()
      .from(schema.debtSettings)
      .where(eq(schema.debtSettings.userId, user.id))
      .limit(1);

    const values = {
      userId: user.id,
      ratePct:
        ratePct !== undefined
          ? ratePct != null
            ? String(ratePct)
            : null
          : existing?.ratePct ?? null,
      minPaymentArs:
        minPaymentArs !== undefined
          ? minPaymentArs != null
            ? String(minPaymentArs)
            : null
          : existing?.minPaymentArs ?? null,
      dueDay: dueDay !== undefined ? dueDay : existing?.dueDay ?? null,
      notes: notes !== undefined ? notes : existing?.notes ?? null,
      forceSettled:
        forceSettled !== undefined
          ? forceSettled
          : existing?.forceSettled ?? false,
      clearedAt:
        clearedAt !== undefined ? clearedAt : existing?.clearedAt ?? null,
      cardLast4:
        cardLast4 !== undefined ? cardLast4 : existing?.cardLast4 ?? null,
      saldoDeudaArs:
        saldoDeudaArs !== undefined
          ? saldoDeudaArs != null
            ? String(saldoDeudaArs)
            : null
          : existing?.saldoDeudaArs ?? null,
      saldoDeudaUsd:
        saldoDeudaUsd !== undefined
          ? saldoDeudaUsd != null
            ? String(saldoDeudaUsd)
            : null
          : existing?.saldoDeudaUsd ?? null,
      updatedAt: new Date(),
    };

    const [row] = await db
      .insert(schema.debtSettings)
      .values(values)
      .onConflictDoUpdate({
        target: schema.debtSettings.userId,
        set: {
          ratePct: values.ratePct,
          minPaymentArs: values.minPaymentArs,
          dueDay: values.dueDay,
          notes: values.notes,
          forceSettled: values.forceSettled,
          clearedAt: values.clearedAt,
          cardLast4: values.cardLast4,
          saldoDeudaArs: values.saldoDeudaArs,
          saldoDeudaUsd: values.saldoDeudaUsd,
          updatedAt: values.updatedAt,
        },
      })
      .returning();

    return NextResponse.json({ settings: serialize(row) });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 400 },
    );
  }
}
