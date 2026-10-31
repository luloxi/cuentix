import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { requireApiUser } from "@/lib/api-auth";
import { getDb, schema } from "@/lib/db";
import { getUserHousehold } from "@/lib/household";
import { resolvePersonalHouseholdId } from "@/lib/personal-household";
import {
  isIncomeFrequency,
  isIncomeKind,
  monthlyIncomeEvolution,
  periodIncomeEntries,
  type IncomeFrequency,
  type IncomeKind,
} from "@/lib/incomes";
import { isNonIncomeTransferLabel } from "@/lib/bbva/bank-entries";
import { currentPeriodAr, periodFromDateString } from "@/lib/utils";

function n(v: unknown): number | null {
  if (v == null || v === "") return null;
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : null;
}

function serialize(row: typeof schema.incomes.$inferSelect) {
  const kind: IncomeKind = row.kind === "recurring" ? "recurring" : "variable";
  const frequency =
    kind === "recurring" && isIncomeFrequency(row.frequency)
      ? row.frequency
      : null;
  return {
    id: row.id,
    kind,
    frequency,
    date: row.date,
    label: row.label,
    amountArs: row.amountArs != null ? Number(row.amountArs) : null,
    amountUsd: row.amountUsd != null ? Number(row.amountUsd) : null,
    createdAt: row.createdAt?.toISOString() ?? null,
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

    // Rainman: delete self/FX income rows so Variables stay clean.
    try {
      const { reclassifyFiwindNoise } = await import(
        "@/lib/import/reclassify-fiwind"
      );
      await reclassifyFiwindNoise(ctx.household.id, { userId: user.id });
    } catch {
      // Non-fatal
    }

    const url = new URL(req.url);
    const period = url.searchParams.get("period") || currentPeriodAr();

    const db = (await getDb());
    const rows = await db
      .select()
      .from(schema.incomes)
      .where(eq(schema.incomes.userId, user.id))
      .orderBy(desc(schema.incomes.date), desc(schema.incomes.createdAt));

    const rowsKeep = rows.filter((r) => !isNonIncomeTransferLabel(r.label));
    const incomes = rowsKeep.map(serialize);
    const periodEntries = periodIncomeEntries(
      rowsKeep.map((r) => ({
        id: r.id,
        date: r.date,
        label: r.label,
        kind: r.kind,
        frequency: r.frequency,
        amountArs: r.amountArs,
        amountUsd: r.amountUsd,
      })),
      period,
    );

    // Compat: si piden period, filtrar incomes "crudos" como antes para variables,
    // pero siempre devolver también las plantillas recurrentes.
    const filteredIncomes = incomes.filter((r) => {
      if (r.kind === "recurring") return true;
      return periodFromDateString(r.date) === period;
    });

    const incomeRowsForChart = rowsKeep.map((r) => ({
      id: r.id,
      date: r.date,
      label: r.label,
      kind: r.kind,
      frequency: r.frequency,
      amountArs: r.amountArs,
      amountUsd: r.amountUsd,
    }));
    const monthlyEvolution = monthlyIncomeEvolution(incomeRowsForChart, {
      months: 12,
    });

    return NextResponse.json({
      period,
      incomes: url.searchParams.has("period") ? filteredIncomes : incomes,
      periodEntries,
      monthlyEvolution,
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
      date?: string;
      label?: string;
      amountArs?: number | null;
      amountUsd?: number | null;
      kind?: string;
      frequency?: string | null;
    };

    const date = (body.date || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json(
        { error: "Fecha inválida (YYYY-MM-DD)" },
        { status: 400 },
      );
    }
    const label = (body.label || "").trim();
    if (!label) {
      return NextResponse.json({ error: "Falta la descripción" }, { status: 400 });
    }
    if (isNonIncomeTransferLabel(label)) {
      return NextResponse.json(
        {
          error:
            "Eso es Transferencia interna (self/FX/DEBIN), no un ingreso. Marcá Transferencia interna en Consumos.",
        },
        { status: 400 },
      );
    }

    const kind: IncomeKind = isIncomeKind(body.kind) ? body.kind : "variable";
    let frequency: IncomeFrequency | null = null;
    if (kind === "recurring") {
      if (!isIncomeFrequency(body.frequency)) {
        return NextResponse.json(
          { error: "Elegí la frecuencia: mensual, quincenal o semanal" },
          { status: 400 },
        );
      }
      frequency = body.frequency;
    }

    const amountArs = n(body.amountArs);
    const amountUsd = n(body.amountUsd);
    if (
      (amountArs == null || amountArs === 0) &&
      (amountUsd == null || amountUsd === 0)
    ) {
      return NextResponse.json(
        { error: "Poné un monto en pesos y/o dólares" },
        { status: 400 },
      );
    }

    const db = (await getDb());
    const [row] = await db
      .insert(schema.incomes)
      .values({
        userId: user.id,
        householdId:
          (await resolvePersonalHouseholdId(user.id)) ?? ctx.household.id,
        kind,
        frequency,
        date,
        label,
        amountArs: amountArs != null ? String(amountArs) : null,
        amountUsd: amountUsd != null ? String(amountUsd) : null,
      })
      .returning();

    return NextResponse.json({ income: serialize(row) });
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
      .delete(schema.incomes)
      .where(
        and(eq(schema.incomes.id, id), eq(schema.incomes.userId, user.id)),
      );

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 400 },
    );
  }
}