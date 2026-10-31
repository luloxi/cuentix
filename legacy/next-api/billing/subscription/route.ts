import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { requireApiUser } from "@/lib/api-auth";
import { getDb, hasDatabase, schema } from "@/lib/db";
import { isPolarCheckoutConfigured, PRO_PLAN } from "@/lib/polar";

export async function GET() {
  const authResult = await requireApiUser();
  if ("error" in authResult) return authResult.error;
  const { user } = authResult;

  const configured = isPolarCheckoutConfigured();
  let subscription: {
    polarSubscriptionId: string;
    status: string;
    currentPeriodEnd: string | null;
  } | null = null;

  if ((await hasDatabase())) {
    try {
      const db = (await getDb());
      const [row] = await db
        .select()
        .from(schema.subscriptions)
        .where(eq(schema.subscriptions.userId, user.id))
        .orderBy(desc(schema.subscriptions.updatedAt))
        .limit(1);
      if (row) {
        subscription = {
          polarSubscriptionId: row.polarSubscriptionId,
          status: row.status,
          currentPeriodEnd: row.currentPeriodEnd
            ? row.currentPeriodEnd.toISOString()
            : null,
        };
      }
    } catch (e) {
      console.error(
        "[billing/subscription]",
        e instanceof Error ? e.message : e,
      );
    }
  }

  return NextResponse.json({
    configured,
    plan: PRO_PLAN,
    subscription,
  });
}
