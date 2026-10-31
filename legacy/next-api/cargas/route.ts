import { NextResponse } from "next/server";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { requireApiUser } from "@/lib/api-auth";
import { requireHousehold } from "@/lib/household";
import { getDb, schema } from "@/lib/db";
import { mapInChunks } from "@/lib/db/chunk";
import { statementTypeLabel } from "@/lib/import/source";

export type CargaItem = {
  id: string;
  kind: "statement" | "receipt" | "manual";
  typeLabel: string;
  date: string;
  fileName: string | null;
  count: number;
  status: string;
  source: string | null;
  detail: string | null;
};

function receiptStatusLabel(status: string): string {
  switch (status) {
    case "matched":
      return "Vinculado";
    case "parsed":
      return "Leído";
    case "pending":
      return "Pendiente";
    case "failed":
      return "Falló";
    default:
      return status;
  }
}

export async function GET() {
  const authResult = await requireApiUser();
  if ("error" in authResult) return authResult.error;
  const { user } = authResult;

  try {
    const ctx = await requireHousehold(user.id);
    const db = (await getDb());
    const householdId = ctx.household.id;

    const [statements, receipts, manuals] = await Promise.all([
      db
        .select({
          id: schema.cardStatements.id,
          source: schema.cardStatements.source,
          fileName: schema.cardStatements.fileName,
          importedAt: schema.cardStatements.importedAt,
          rowCount: schema.cardStatements.rowCount,
        })
        .from(schema.cardStatements)
        .where(eq(schema.cardStatements.householdId, householdId))
        .orderBy(desc(schema.cardStatements.importedAt))
        .limit(100),
      db
        .select({
          id: schema.receipts.id,
          merchantName: schema.receipts.merchantName,
          receiptDate: schema.receipts.receiptDate,
          status: schema.receipts.status,
          createdAt: schema.receipts.createdAt,
        })
        .from(schema.receipts)
        .where(eq(schema.receipts.householdId, householdId))
        .orderBy(desc(schema.receipts.createdAt))
        .limit(100),
      db
        .select({
          id: schema.transactions.id,
          date: schema.transactions.date,
          descriptionNormalized: schema.transactions.descriptionNormalized,
          createdAt: schema.transactions.createdAt,
        })
        .from(schema.transactions)
        .where(
          and(
            eq(schema.transactions.householdId, householdId),
            eq(schema.transactions.source, "manual"),
            eq(schema.transactions.paidByUserId, user.id),
          ),
        )
        .orderBy(desc(schema.transactions.createdAt))
        .limit(200),
    ]);

    const statementIds = statements.map((s) => s.id);
    const bankByStatement = new Map<string, string>();
    if (statementIds.length > 0) {
      const bankRows = await mapInChunks(statementIds, 1, (chunk) =>
        db
          .select({
            statementId: schema.transactions.statementId,
            bank: schema.transactions.bank,
          })
          .from(schema.transactions)
          .where(
            and(
              eq(schema.transactions.householdId, householdId),
              inArray(schema.transactions.statementId, chunk),
            ),
          )
          .limit(2000),
      );
      for (const row of bankRows) {
        if (!row.statementId || !row.bank) continue;
        if (!bankByStatement.has(row.statementId)) {
          bankByStatement.set(row.statementId, row.bank);
        }
      }
    }

    const receiptIds = receipts.map((r) => r.id);
    const itemCounts = new Map<string, number>();
    if (receiptIds.length > 0) {
      const rows = await mapInChunks(receiptIds, 0, (chunk) =>
        db
          .select({
            receiptId: schema.receiptItems.receiptId,
            n: sql<number>`count(*)`,
          })
          .from(schema.receiptItems)
          .where(inArray(schema.receiptItems.receiptId, chunk))
          .groupBy(schema.receiptItems.receiptId),
      );
      for (const row of rows) {
        itemCounts.set(row.receiptId, Number(row.n));
      }
    }

    const items: CargaItem[] = [];

    for (const s of statements) {
      items.push({
        id: `statement:${s.id}`,
        kind: "statement",
        typeLabel: statementTypeLabel(s.source, bankByStatement.get(s.id) ?? null),
        date: s.importedAt.toISOString(),
        fileName: s.fileName,
        count: s.rowCount,
        status: s.rowCount > 0 ? "Importado" : "Sin filas",
        source: s.source,
        detail: bankByStatement.get(s.id) ?? null,
      });
    }

    for (const r of receipts) {
      const count = itemCounts.get(r.id) ?? 0;
      items.push({
        id: `receipt:${r.id}`,
        kind: "receipt",
        typeLabel: "Ticket (OCR)",
        date: (r.createdAt ?? new Date()).toISOString(),
        fileName: r.merchantName,
        count: count > 0 ? count : 1,
        status: receiptStatusLabel(r.status),
        source: "receipt",
        detail: r.receiptDate,
      });
    }

    // Group manuals by calendar day of createdAt (AR-ish: use date field)
    const byDay = new Map<
      string,
      { count: number; latest: string; sample: string }
    >();
    for (const m of manuals) {
      const day = m.date;
      const created =
        m.createdAt instanceof Date
          ? m.createdAt.toISOString()
          : String(m.createdAt);
      const cur = byDay.get(day);
      if (!cur) {
        byDay.set(day, {
          count: 1,
          latest: created,
          sample: m.descriptionNormalized,
        });
      } else {
        cur.count += 1;
        if (created > cur.latest) cur.latest = created;
      }
    }
    for (const [day, g] of byDay) {
      items.push({
        id: `manual:${day}`,
        kind: "manual",
        typeLabel: "Carga manual",
        date: g.latest,
        fileName: g.sample,
        count: g.count,
        status: "Manual",
        source: "manual",
        detail: day,
      });
    }

    items.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

    return NextResponse.json({
      items,
      counts: {
        statements: statements.length,
        receipts: receipts.length,
        manuals: manuals.length,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    if (msg === "NO_HOUSEHOLD") {
      return NextResponse.json(
        { error: "Creá o uníte a un hogar primero" },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
