/**
 * GET `/api/billing/subscription` — read-only Polar plan + D1 row.
 * Checkout / webhook stay unported ( Polar API + Node crypto ).
 */

import type { SessionUser } from "./auth";
import type { Env } from "./env";
import { json } from "./http";

const PRO_PLAN = {
  name: "Pro",
  amountArs: 9990,
  interval: "mes",
} as const;

export async function handleBillingSubscription(
  req: Request,
  env: Env,
  user: SessionUser,
): Promise<Response> {
  if (req.method !== "GET") return json({ error: "Método no permitido" }, 405);

  const configured = Boolean(
    env.POLAR_ACCESS_TOKEN?.trim() && env.POLAR_PRODUCT_ID?.trim(),
  );
  const row = await env.DB.prepare(
    `SELECT polar_subscription_id AS polar_subscription_id,
            status AS status,
            current_period_end AS current_period_end
     FROM subscriptions
     WHERE user_id = ?
     ORDER BY updated_at DESC
     LIMIT 1`,
  )
    .bind(user.id)
    .first<{
      polar_subscription_id: string;
      status: string;
      current_period_end: number | string | null;
    }>();

  let subscription: {
    polarSubscriptionId: string;
    status: string;
    currentPeriodEnd: string | null;
  } | null = null;
  if (row?.polar_subscription_id) {
    subscription = {
      polarSubscriptionId: row.polar_subscription_id,
      status: row.status,
      currentPeriodEnd: isoFromMs(row.current_period_end),
    };
  }

  return json({
    configured,
    plan: PRO_PLAN,
    subscription,
  });
}

function isoFromMs(value: unknown): string | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (Number.isFinite(n) && n > 0) return new Date(n).toISOString();
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return null;
}
