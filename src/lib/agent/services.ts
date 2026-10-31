import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { AppUser } from "@/lib/session";
import { resolveImportBank, statementTypeLabel } from "@/lib/import/source";
import { getDb, schema } from "@/lib/db";
import { mapInChunks } from "@/lib/db/chunk";
import { getMonthEndBuyRates } from "@/lib/fx/month-end-rates";
import {
  getCategoryMap,
  getHouseholdById,
  requireHousehold,
} from "@/lib/household";
import {
  importBbvaFile,
  importTransparenciaConsumos,
} from "@/lib/import/bbva";
import {
  forceSharedOnlyForHousehold,
  resolvePersonalHouseholdId,
} from "@/lib/personal-household";
import {
  parseStatementMovements,
  summarizeParsedMovements,
} from "@/lib/agent/import-summary";
import {
  aggregateByBank,
  aggregateByPeriod,
  buildMonthFromAgg,
  currentPeriodAr,
  formatGastosHeadline,
  visibleExpenseRows,
} from "@/lib/stats/monthly-expenses";
import { formatArs, formatUsd } from "@/lib/utils";

export type AgentServiceError = {
  status: number;
  error: string;
  code?: string;
};

export function isAgentServiceError(e: unknown): e is AgentServiceError {
  return (
    typeof e === "object" &&
    e !== null &&
    "status" in e &&
    "error" in e &&
    typeof (e as AgentServiceError).status === "number"
  );
}

function mapCaught(e: unknown): never {
  const msg = e instanceof Error ? e.message : "Error";
  if (msg === "NO_HOUSEHOLD") {
    throw {
      status: 400,
      error:
        "Sin hogar para este token. Generá el token del hogar en /mcp (sesión de la app). Admin/dev: si usás AGENT_API_TOKEN, revisá AGENT_USER_ID / AGENT_USER_EMAIL.",
      code: "no_household",
    } satisfies AgentServiceError;
  }
  throw {
    status: 500,
    error: msg,
    code: "internal",
  } satisfies AgentServiceError;
}

/** Caller from session, household token, or admin/dev global token. */
export type AgentCaller = {
  user: AppUser;
  householdId?: string;
};

/**
 * Scope every agent/MCP query to the token's household_id when present.
 * Never fall back to another household the acting user might belong to.
 */
async function householdForAgent(caller: AgentCaller) {
  if (caller.householdId) {
    const ctx = await getHouseholdById(caller.householdId);
    if (!ctx) {
      throw {
        status: 400,
        error:
          "Este token no tiene un hogar válido. Generá uno nuevo en /mcp.",
        code: "no_household",
      } satisfies AgentServiceError;
    }
    return ctx;
  }
  return requireHousehold(caller.user.id);
}

export async function getAgentSummary(caller: AgentCaller) {
  try {
    const ctx = await householdForAgent(caller);
    const user = caller.user;
    const db = (await getDb());
    const { byId } = await getCategoryMap({ householdId: ctx.household.id });

    const [allRows, statements] = await Promise.all([
      db
        .select()
        .from(schema.transactions)
        .where(eq(schema.transactions.householdId, ctx.household.id)),
      db
        .select({
          id: schema.cardStatements.id,
          source: schema.cardStatements.source,
          fileName: schema.cardStatements.fileName,
          importedAt: schema.cardStatements.importedAt,
          rowCount: schema.cardStatements.rowCount,
        })
        .from(schema.cardStatements)
        .where(eq(schema.cardStatements.householdId, ctx.household.id))
        .orderBy(desc(schema.cardStatements.importedAt))
        .limit(10),
    ]);

    const expenses = forceSharedOnlyForHousehold(ctx.household.name)
      ? visibleExpenseRows(allRows, user.id).filter((r) => r.ownership === "shared")
      : visibleExpenseRows(allRows, user.id);
    const { periods, byPeriod } = aggregateByPeriod(expenses, byId);
    const period = currentPeriodAr();
    const rates = await getMonthEndBuyRates([
      ...new Set([...periods, period]),
    ]);
    const month = buildMonthFromAgg(
      period,
      byPeriod.get(period),
      rates.get(period),
    );
    const latest = periods[0] ?? null;
    const latestMonth = latest
      ? buildMonthFromAgg(latest, byPeriod.get(latest), rates.get(latest))
      : null;

    return {
      household: {
        id: ctx.household.id,
        name: ctx.household.name,
      },
      statements: statements.map((s) => ({
        id: s.id,
        source: s.source,
        fileName: s.fileName,
        importedAt: s.importedAt,
        rowCount: s.rowCount,
      })),
      availablePeriods: periods,
      currentPeriod: period,
      latestPeriodWithData: latest,
      currentMonth: {
        ...month,
        byBank: aggregateByBank(
          expenses.filter((r) => r.date.startsWith(period)),
        ),
        formatted: {
          headline: formatGastosHeadline(month),
          totalArs: formatArs(month.totalArs),
          totalUsd: formatUsd(month.totalUsd),
          totalArsCombined: formatArs(month.totalArsCombined),
        },
      },
      latestMonth: latestMonth
        ? {
            ...latestMonth,
            formatted: {
              headline: formatGastosHeadline(latestMonth),
              totalArs: formatArs(latestMonth.totalArs),
              totalUsd: formatUsd(latestMonth.totalUsd),
              totalArsCombined: formatArs(latestMonth.totalArsCombined),
            },
          }
        : null,
    };
  } catch (e) {
    if (isAgentServiceError(e)) throw e;
    mapCaught(e);
  }
}

export async function getAgentGastos(
  caller: AgentCaller,
  periodParam?: string | null,
) {
  try {
    const ctx = await householdForAgent(caller);
    const user = caller.user;
    const db = (await getDb());
    const { byId } = await getCategoryMap({ householdId: ctx.household.id });
    const allRows = await db
      .select()
      .from(schema.transactions)
      .where(eq(schema.transactions.householdId, ctx.household.id));

    const expenses = forceSharedOnlyForHousehold(ctx.household.name)
      ? visibleExpenseRows(allRows, user.id).filter((r) => r.ownership === "shared")
      : visibleExpenseRows(allRows, user.id);
    const { periods, byPeriod } = aggregateByPeriod(expenses, byId);
    const extraPeriod =
      periodParam && periodParam !== "latest" && periodParam !== "current"
        ? [periodParam]
        : [];
    const rates = await getMonthEndBuyRates([
      ...new Set([...periods, ...extraPeriod]),
    ]);

    const latest = periods[0] ?? null;
    let period: string;
    if (!periodParam || periodParam === "current") {
      period = currentPeriodAr();
    } else if (periodParam === "latest") {
      period = latest ?? currentPeriodAr();
    } else {
      period = periodParam;
    }

    const month = buildMonthFromAgg(
      period,
      byPeriod.get(period),
      rates.get(period),
    );
    const inPeriod = expenses.filter((r) => r.date.startsWith(period));
    const byBank = aggregateByBank(inPeriod);
    const headline = formatGastosHeadline(month);

    return {
      period: month.period,
      latestPeriodWithData: latest,
      availablePeriods: periods,
      totalArs: month.totalArs,
      totalUsd: month.totalUsd,
      totalArsFromUsd: month.totalArsFromUsd,
      totalArsCombined: month.totalArsCombined,
      totalCount: month.totalCount,
      usdRate: month.usdRate,
      categories: month.categories,
      byBank,
      formatted: {
        headline,
        totalArs: formatArs(month.totalArs),
        totalUsd: formatUsd(month.totalUsd),
        totalArsCombined: formatArs(month.totalArsCombined),
      },
    };
  } catch (e) {
    if (isAgentServiceError(e)) throw e;
    mapCaught(e);
  }
}

export async function importAgentStatement(
  caller: AgentCaller,
  input: {
    buffer: Buffer;
    fileName: string;
    bank?: string | null;
    kind?: string | null;
  },
) {
  try {
    const ctx = await householdForAgent(caller);
    const user = caller.user;
    if (!input.buffer.length) {
      throw {
        status: 400,
        error: "Archivo vacío",
        code: "empty_file",
      } satisfies AgentServiceError;
    }
    const fileName = (input.fileName ?? "statement.bin").trim() || "statement.bin";
    const kind = String(input.kind ?? "bbva");

    const { movements, source, detectedBank } = await parseStatementMovements(
      input.buffer,
      fileName,
    );
    const bank = resolveImportBank({
      selected: input.bank,
      detected: detectedBank,
      fileName,
    });
    const fileSummary = summarizeParsedMovements(movements, source);

    const personalId =
      (await resolvePersonalHouseholdId(user.id)) ?? ctx.household.id;
    const result =
      kind === "transparencia"
        ? await importTransparenciaConsumos({
            householdId: personalId,
            userId: user.id,
            fileName,
            buffer: input.buffer,
            bank,
          })
        : await importBbvaFile({
            householdId: personalId,
            userId: user.id,
            fileName,
            buffer: input.buffer,
            bank,
          });

    return {
      ok: true as const,
      bank,
      fileName,
      file: fileSummary,
      import: result,
    };
  } catch (e) {
    if (isAgentServiceError(e)) throw e;
    mapCaught(e);
  }
}

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

export async function listAgentCargas(caller: AgentCaller, limit = 50) {
  try {
    const ctx = await householdForAgent(caller);
    const user = caller.user;
    const db = (await getDb());
    const householdId = ctx.household.id;
    const capped = Math.min(Math.max(limit, 1), 100);

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
        .limit(capped),
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
        .limit(capped),
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
        typeLabel: statementTypeLabel(
          s.source,
          bankByStatement.get(s.id) ?? null,
        ),
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

    return {
      items: items.slice(0, capped),
      counts: {
        statements: statements.length,
        receipts: receipts.length,
        manuals: manuals.length,
      },
    };
  } catch (e) {
    if (isAgentServiceError(e)) throw e;
    mapCaught(e);
  }
}
