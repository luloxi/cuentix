import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { requireApiUser } from "@/lib/api-auth";
import { getDb, schema } from "@/lib/db";
import {
  householdIdFromReceiptKey,
  readReceiptImage,
  safeReceiptKey,
} from "@/lib/receipts/storage";

export const dynamic = "force-dynamic";

/**
 * Authenticated read of a receipt image stored in the RECEIPTS R2 bucket.
 * Object keys are receipts/{householdId}/{file}. Callers must belong to that hogar.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ key: string[] }> },
) {
  const authResult = await requireApiUser();
  if ("error" in authResult) return authResult.error;

  const { key: parts } = await ctx.params;
  const key = parts.map((part) => {
    try {
      return decodeURIComponent(part);
    } catch {
      return part;
    }
  }).join("/");

  if (!safeReceiptKey(key)) {
    return NextResponse.json({ error: "Ruta inválida" }, { status: 400 });
  }

  const householdId = householdIdFromReceiptKey(key);
  if (!householdId) {
    return NextResponse.json({ error: "Ruta inválida" }, { status: 400 });
  }

  if (authResult.householdId && authResult.householdId !== householdId) {
    return NextResponse.json({ error: "Sin acceso" }, { status: 403 });
  }

  try {
    const db = (await getDb());
    const [member] = await db
      .select({ userId: schema.householdMembers.userId })
      .from(schema.householdMembers)
      .where(
        and(
          eq(schema.householdMembers.householdId, householdId),
          eq(schema.householdMembers.userId, authResult.user.id),
        ),
      )
      .limit(1);
    if (!member) {
      return NextResponse.json({ error: "Sin acceso" }, { status: 403 });
    }

    const object = await readReceiptImage(key);
    if (!object) {
      return NextResponse.json({ error: "Ticket no encontrado" }, { status: 404 });
    }

    const headers = new Headers();
    headers.set("Content-Type", object.contentType);
    headers.set("Cache-Control", "private, max-age=3600");
    headers.set("X-Content-Type-Options", "nosniff");
    return new NextResponse(object.body, { status: 200, headers });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}
