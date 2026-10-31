import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, hasDatabase, schema } from "@/lib/db";
import { polarWebhookSecret, verifyPolarWebhook } from "@/lib/polar";

type PolarSubscription = {
  id: string;
  status: string;
  current_period_end?: string | null;
  metadata?: Record<string, unknown>;
  customer?: { external_id?: string | null };
};

type PolarWebhookEvent = {
  type: string;
  data: PolarSubscription;
};

function metaUserId(metadata: Record<string, unknown> | undefined): string | null {
  const raw = metadata?.userId;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

function resolveUserId(sub: PolarSubscription): string | null {
  return (
    metaUserId(sub.metadata) ??
    (sub.customer?.external_id?.trim() || null)
  );
}

function periodEnd(sub: PolarSubscription): Date | null {
  const end = sub.current_period_end;
  if (!end) return null;
  const d = new Date(end);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function upsertSubscription(sub: PolarSubscription) {
  const userId = resolveUserId(sub);
  if (!userId) {
    console.warn("[billing/webhook] subscription without user id", sub.id);
    return;
  }
  if (!(await hasDatabase())) {
    // User row then subscription are sequential. D1 has no interactive transaction.
    console.warn("[billing/webhook] no D1 binding, skip sync");
    return;
  }

  const db = (await getDb());

  const existingUser = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);

  if (!existingUser[0]) {
    await db.insert(schema.users).values({ id: userId }).onConflictDoNothing();
  }

  await db
    .insert(schema.subscriptions)
    .values({
      userId,
      polarSubscriptionId: sub.id,
      status: sub.status,
      currentPeriodEnd: periodEnd(sub),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: schema.subscriptions.polarSubscriptionId,
      set: {
        userId,
        status: sub.status,
        currentPeriodEnd: periodEnd(sub),
        updatedAt: new Date(),
      },
    });
}

export async function POST(req: Request) {
  const secret = polarWebhookSecret();
  if (!secret) {
    return NextResponse.json(
      { error: "Falta configurar Polar", code: "polar_unconfigured" },
      { status: 503 },
    );
  }

  const body = await req.text();
  let event: PolarWebhookEvent;
  try {
    event = verifyPolarWebhook(body, req.headers, secret) as PolarWebhookEvent;
  } catch (e) {
    const message = e instanceof Error ? e.message : "Webhook inválido";
    const status = message === "Firma inválida" ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }

  try {
    if (
      event.type === "subscription.created" ||
      event.type === "subscription.updated" ||
      event.type === "subscription.canceled"
    ) {
      await upsertSubscription(event.data);
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "Error al sincronizar";
    console.error("[billing/webhook]", event.type, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return new NextResponse(null, { status: 202 });
}
