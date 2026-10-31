import { NextResponse } from "next/server";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { createHash } from "crypto";
import { requireApiUser } from "@/lib/api-auth";
import { getCategoryMap, requireHousehold } from "@/lib/household";
import { getDb, schema } from "@/lib/db";
import { deleteReceiptImage, putReceiptImage } from "@/lib/receipts/storage";
import {
  isOcrConfigured,
  mockReceiptOcr,
  parseReceiptImage,
} from "@/lib/receipts/ocr";
import { matchReceiptToTransactions } from "@/lib/receipts/match";

export async function GET() {
  const authResult = await requireApiUser();
  if ("error" in authResult) return authResult.error;
  const { user: sessionUser } = authResult;
  try {
    const ctx = await requireHousehold(sessionUser.id);
    const db = (await getDb());
    const rows = await db
      .select()
      .from(schema.receipts)
      .where(eq(schema.receipts.householdId, ctx.household.id))
      .orderBy(desc(schema.receipts.createdAt));

    const withItems = await Promise.all(
      rows.map(async (r) => {
        const items = await db
          .select()
          .from(schema.receiptItems)
          .where(eq(schema.receiptItems.receiptId, r.id));
        return {
          ...r,
          totalArs: r.totalArs != null ? Number(r.totalArs) : null,
          items: items.map((i) => ({
            ...i,
            quantity: i.quantity != null ? Number(i.quantity) : null,
            unitPrice: i.unitPrice != null ? Number(i.unitPrice) : null,
            lineTotal: i.lineTotal != null ? Number(i.lineTotal) : null,
          })),
        };
      }),
    );

    return NextResponse.json({ receipts: withItems });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}

/** Reject oversized photos before buffering. Workers accept more; keep the app limit. */
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export async function POST(req: Request) {
  const authResult = await requireApiUser();
  if ("error" in authResult) return authResult.error;
  const { user: sessionUser } = authResult;

  try {
    const contentLength = Number(req.headers.get("content-length") || 0);
    if (contentLength > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        {
          error:
            "La foto es demasiado grande. Sacá otra o usá una resolución menor.",
        },
        { status: 413 },
      );
    }

    const ctx = await requireHousehold(sessionUser.id);
    const form = await req.formData();
    const file = form.get("file");
    const dryRun =
      form.get("dryRun") === "1" ||
      form.get("dryRun") === "true" ||
      form.get("preview") === "1";
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Falta la imagen" }, { status: 400 });
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        {
          error:
            "La foto es demasiado grande. Sacá otra o usá una resolución menor.",
        },
        { status: 413 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const contentType = file.type || "image/jpeg";
    const dataUrl = `data:${contentType};base64,${buffer.toString("base64")}`;

    // OCR (preview uses data URL only — no Blob upload)
    let ocr;
    let status: "parsed" | "failed" = "parsed";
    try {
      if (isOcrConfigured()) {
        ocr = await parseReceiptImage(dataUrl);
      } else {
        ocr = mockReceiptOcr();
      }
    } catch (err) {
      status = "failed";
      ocr = mockReceiptOcr();
      console.error("OCR failed", err);
    }

    // Preview only: fill the “Agregar gasto” form without saving
    if (dryRun) {
      return NextResponse.json({
        dryRun: true,
        status,
        ocr,
      });
    }

    let imageUrl: string;
    const storedPath = await putReceiptImage({
      householdId: ctx.household.id,
      fileName: file.name,
      body: buffer,
      contentType,
    });
    if (storedPath) {
      imageUrl = storedPath;
    } else {
      // No R2 binding (local demo). Same local:// ref as before; not a fake receipt.
      imageUrl = dataUrl;
    }

    const db = (await getDb());
    const { bySlug, byId } = await getCategoryMap();

    const [receipt] = await db
      .insert(schema.receipts)
      .values({
        householdId: ctx.household.id,
        imageUrl: imageUrl.startsWith("data:")
          ? `local://${createHash("sha256").update(buffer).digest("hex").slice(0, 16)}`
          : imageUrl,
        merchantName: ocr.merchant,
        receiptDate: ocr.date,
        totalArs: ocr.total != null ? String(ocr.total) : null,
        currency: ocr.currency,
        ocrRaw: ocr,
        status,
        createdBy: sessionUser.id,
      })
      .returning();

    // Persist data URL separately if needed - store full URL when blob
    if (imageUrl.startsWith("data:")) {
      // Keep truncated local ref; put full data in ocrRaw for preview in demo
      await db
        .update(schema.receipts)
        .set({
          ocrRaw: { ...ocr, _previewDataUrl: imageUrl.slice(0, 100) + "…" },
        })
        .where(eq(schema.receipts.id, receipt.id));
    }

    for (const item of ocr.items) {
      await db.insert(schema.receiptItems).values({
        receiptId: receipt.id,
        name: item.name,
        quantity: item.quantity != null ? String(item.quantity) : "1",
        unitPrice: item.unit_price != null ? String(item.unit_price) : null,
        lineTotal: item.line_total != null ? String(item.line_total) : null,
      });
    }

    // Candidate transactions around receipt date
    let candidates: Array<{
      id: string;
      date: string;
      descriptionNormalized: string;
      amountArs: number | null;
      categorySlug?: string | null;
      hasReceipt?: boolean;
    }> = [];

    if (ocr.date) {
      const d = new Date(ocr.date + "T12:00:00Z");
      const from = new Date(d);
      from.setUTCDate(from.getUTCDate() - 1);
      const to = new Date(d);
      to.setUTCDate(to.getUTCDate() + 2);
      const fromStr = from.toISOString().slice(0, 10);
      const toStr = to.toISOString().slice(0, 10);

      const txs = await db
        .select()
        .from(schema.transactions)
        .where(
          and(
            eq(schema.transactions.householdId, ctx.household.id),
            gte(schema.transactions.date, fromStr),
            lte(schema.transactions.date, toStr),
          ),
        );

      const linked = await db
        .select({ transactionId: schema.receipts.transactionId })
        .from(schema.receipts)
        .where(eq(schema.receipts.householdId, ctx.household.id));
      const linkedSet = new Set(
        linked.map((l) => l.transactionId).filter(Boolean) as string[],
      );

      candidates = txs.map((t) => ({
        id: t.id,
        date: t.date,
        descriptionNormalized: t.descriptionNormalized,
        amountArs: t.amountArs != null ? Number(t.amountArs) : null,
        categorySlug: t.categoryId ? byId.get(t.categoryId)?.slug : null,
        hasReceipt: linkedSet.has(t.id),
      }));
    }

    const match = matchReceiptToTransactions(
      {
        merchantName: ocr.merchant,
        receiptDate: ocr.date,
        totalArs: ocr.total,
      },
      candidates,
    );

    let transactionId = match.transactionId;
    let createdTransaction = false;

    if (transactionId) {
      const superCat = bySlug.get("supermercado");
      await db
        .update(schema.receipts)
        .set({ transactionId, status: "matched" })
        .where(eq(schema.receipts.id, receipt.id));
      // Mark bank row as supermarket ticket (highlighted category)
      if (superCat) {
        await db
          .update(schema.transactions)
          .set({ categoryId: superCat.id, updatedAt: new Date() })
          .where(
            and(
              eq(schema.transactions.id, transactionId),
              eq(schema.transactions.householdId, ctx.household.id),
            ),
          );
      }
    } else if (
      match.candidates.length === 0 &&
      ocr.total != null &&
      ocr.date
    ) {
      // Create new bank-like transaction from receipt
      const superCat = bySlug.get("supermercado");
      const merchant = ocr.merchant || "Supermercado";
      const fp = createHash("sha256")
        .update(`receipt|${ocr.date}|${merchant}|${ocr.total}`)
        .digest("hex")
        .slice(0, 32);

      try {
        const [tx] = await db
          .insert(schema.transactions)
          .values({
            householdId: ctx.household.id,
            date: ocr.date,
            descriptionRaw: merchant,
            descriptionNormalized: merchant,
            amountArs: String(ocr.total),
            categoryId: superCat?.id,
            ownership: "shared",
            paidByUserId: sessionUser.id,
            externalFingerprint: fp,
            source: "receipt",
          })
          .returning();
        transactionId = tx.id;
        createdTransaction = true;
        await db
          .update(schema.receipts)
          .set({ transactionId, status: "matched" })
          .where(eq(schema.receipts.id, receipt.id));
      } catch {
        // fingerprint collision — try link existing
        const [existing] = await db
          .select()
          .from(schema.transactions)
          .where(
            and(
              eq(schema.transactions.householdId, ctx.household.id),
              eq(schema.transactions.externalFingerprint, fp),
            ),
          )
          .limit(1);
        if (existing) {
          transactionId = existing.id;
          await db
            .update(schema.receipts)
            .set({ transactionId, status: "matched" })
            .where(eq(schema.receipts.id, receipt.id));
        }
      }
    }

    return NextResponse.json({
      receipt: {
        ...receipt,
        totalArs: ocr.total,
        status: transactionId ? "matched" : status,
        transactionId,
      },
      ocr,
      match,
      createdTransaction,
      imageUrl: imageUrl.startsWith("data:") ? imageUrl : imageUrl,
    });
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
  const { user: sessionUser } = authResult;
  try {
    const ctx = await requireHousehold(sessionUser.id);
    const body = await req.json();
    const db = (await getDb());

    // Update a line item (name / product subcategory)
    if (body.itemId) {
      const [item] = await db
        .select({
          id: schema.receiptItems.id,
          receiptId: schema.receiptItems.receiptId,
        })
        .from(schema.receiptItems)
        .where(eq(schema.receiptItems.id, body.itemId))
        .limit(1);
      if (!item) {
        return NextResponse.json({ error: "Ítem no encontrado" }, { status: 404 });
      }
      const [receipt] = await db
        .select({ id: schema.receipts.id })
        .from(schema.receipts)
        .where(
          and(
            eq(schema.receipts.id, item.receiptId),
            eq(schema.receipts.householdId, ctx.household.id),
          ),
        )
        .limit(1);
      if (!receipt) {
        return NextResponse.json({ error: "Sin acceso" }, { status: 403 });
      }

      const patch: {
        name?: string;
        productCategory?: string | null;
      } = {};
      if (typeof body.name === "string" && body.name.trim()) {
        patch.name = body.name.trim();
      }
      if ("productCategory" in body) {
        patch.productCategory =
          body.productCategory == null || body.productCategory === ""
            ? null
            : String(body.productCategory).trim();
      }

      const [updated] = await db
        .update(schema.receiptItems)
        .set(patch)
        .where(eq(schema.receiptItems.id, body.itemId))
        .returning();
      return NextResponse.json({ item: updated });
    }

    const [row] = await db
      .update(schema.receipts)
      .set({
        transactionId: body.transactionId ?? null,
        status: body.transactionId ? "matched" : "parsed",
      })
      .where(
        and(
          eq(schema.receipts.id, body.id),
          eq(schema.receipts.householdId, ctx.household.id),
        ),
      )
      .returning();
    return NextResponse.json({ receipt: row });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}

/**
 * Delete one receipt or all household receipts.
 * Also removes transactions created from receipt OCR (source = "receipt").
 */
export async function DELETE(req: Request) {
  const authResult = await requireApiUser();
  if ("error" in authResult) return authResult.error;
  const { user: sessionUser } = authResult;

  try {
    const ctx = await requireHousehold(sessionUser.id);
    const body = (await req.json().catch(() => ({}))) as {
      id?: string;
      all?: boolean;
    };
    const db = (await getDb());

    if (body.all) {
      const all = await db
        .select({
          id: schema.receipts.id,
          transactionId: schema.receipts.transactionId,
          imageUrl: schema.receipts.imageUrl,
        })
        .from(schema.receipts)
        .where(eq(schema.receipts.householdId, ctx.household.id));

      for (const r of all) {
        await deleteReceiptImage(r.imageUrl).catch(() => undefined);
        await db
          .delete(schema.receiptItems)
          .where(eq(schema.receiptItems.receiptId, r.id));
        if (r.transactionId) {
          await db
            .delete(schema.transactions)
            .where(
              and(
                eq(schema.transactions.id, r.transactionId),
                eq(schema.transactions.householdId, ctx.household.id),
                eq(schema.transactions.source, "receipt"),
              ),
            );
        }
      }
      await db
        .delete(schema.receipts)
        .where(eq(schema.receipts.householdId, ctx.household.id));

      // orphan receipt-source txs without receipt link
      await db
        .delete(schema.transactions)
        .where(
          and(
            eq(schema.transactions.householdId, ctx.household.id),
            eq(schema.transactions.source, "receipt"),
          ),
        );

      return NextResponse.json({ ok: true, deleted: all.length });
    }

    if (!body.id) {
      return NextResponse.json(
        { error: "Indicá id o all: true" },
        { status: 400 },
      );
    }

    const [receipt] = await db
      .select()
      .from(schema.receipts)
      .where(
        and(
          eq(schema.receipts.id, body.id),
          eq(schema.receipts.householdId, ctx.household.id),
        ),
      )
      .limit(1);

    if (!receipt) {
      return NextResponse.json({ error: "Ticket no encontrado" }, { status: 404 });
    }

    await deleteReceiptImage(receipt.imageUrl).catch(() => undefined);

    await db
      .delete(schema.receiptItems)
      .where(eq(schema.receiptItems.receiptId, receipt.id));

    if (receipt.transactionId) {
      await db
        .delete(schema.transactions)
        .where(
          and(
            eq(schema.transactions.id, receipt.transactionId),
            eq(schema.transactions.householdId, ctx.household.id),
            eq(schema.transactions.source, "receipt"),
          ),
        );
    }

    await db
      .delete(schema.receipts)
      .where(eq(schema.receipts.id, receipt.id));

    return NextResponse.json({ ok: true, deleted: 1 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}
