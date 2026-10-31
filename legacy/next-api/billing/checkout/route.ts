import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api-auth";
import {
  appUrlFromRequest,
  clientIp,
  createPolarCheckout,
  isPolarCheckoutConfigured,
  polarAccessToken,
  polarProductId,
} from "@/lib/polar";

export async function POST(req: Request) {
  const authResult = await requireApiUser();
  if ("error" in authResult) return authResult.error;
  const { user } = authResult;

  if (!isPolarCheckoutConfigured()) {
    return NextResponse.json(
      { error: "Falta configurar Polar", code: "polar_unconfigured" },
      { status: 503 },
    );
  }

  const productId = polarProductId();
  if (!polarAccessToken() || !productId) {
    return NextResponse.json(
      { error: "Falta configurar Polar", code: "polar_unconfigured" },
      { status: 503 },
    );
  }

  const origin = appUrlFromRequest(req);
  const successUrl = `${origin}/suscripcion?checkout=ok`;
  const returnUrl = `${origin}/suscripcion`;
  const ip = clientIp(req);

  const base: Record<string, unknown> = {
    products: [productId],
    external_customer_id: user.id,
    customer_email: user.email ?? undefined,
    metadata: { userId: user.id },
    success_url: successUrl,
    return_url: returnUrl,
    customer_ip_address: ip,
  };

  try {
    let checkout;
    try {
      checkout = await createPolarCheckout({ ...base, currency: "ars" });
    } catch (arsErr) {
      console.warn(
        "[billing/checkout] ARS presentment failed, retrying without currency",
        arsErr instanceof Error ? arsErr.message : arsErr,
      );
      checkout = await createPolarCheckout(base);
    }

    if (!checkout.url) {
      return NextResponse.json(
        { error: "Polar no devolvió una URL de checkout" },
        { status: 502 },
      );
    }

    return NextResponse.json({ url: checkout.url });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Error de Polar";
    console.error("[billing/checkout]", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
