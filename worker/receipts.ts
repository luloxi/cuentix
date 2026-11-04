/**
 * GET `/api/receipts` — supermarket tickets for the active household.
 * Items come back in the same response. Image bytes, OCR and deletes stay off.
 */

import type { SessionUser } from "./auth";
import type { Env } from "./env";
import { activeHousehold } from "./household";
import { json, num } from "./http";

type ReceiptRow = {
  id: string;
  merchant_name: string | null;
  receipt_date: string | null;
  total_ars: string | null;
  status: string;
  transaction_id: string | null;
};

type ItemRow = {
  id: string;
  receipt_id: string;
  name: string;
  quantity: string | null;
  line_total: string | null;
};

export async function handleReceipts(
  req: Request,
  env: Env,
  user: SessionUser,
): Promise<Response> {
  if (req.method !== "GET") return json({ error: "Método no permitido" }, 405);
  const { active } = await activeHousehold(req, env, user.id);
  if (!active) return json({ error: "NO_HOUSEHOLD" }, 400);

  const receipts = await env.DB.prepare(
    `SELECT id, merchant_name, receipt_date, total_ars, status, transaction_id
     FROM receipts
     WHERE household_id = ?
     ORDER BY created_at DESC
     LIMIT 100`,
  )
    .bind(active.id)
    .all<ReceiptRow>();

  const rows = receipts.results ?? [];
  const itemsByReceipt = new Map<string, ItemRow[]>();
  if (rows.length > 0) {
    const marks = rows.map(() => "?").join(", ");
    const items = await env.DB.prepare(
      `SELECT id, receipt_id, name, quantity, line_total
       FROM receipt_items
       WHERE receipt_id IN (${marks})`,
    )
      .bind(...rows.map((row) => row.id))
      .all<ItemRow>();
    for (const item of items.results ?? []) {
      const list = itemsByReceipt.get(item.receipt_id) ?? [];
      list.push(item);
      itemsByReceipt.set(item.receipt_id, list);
    }
  }

  return json({
    receipts: rows.map((row) => ({
      id: row.id,
      merchantName: row.merchant_name,
      receiptDate: row.receipt_date,
      totalArs: row.total_ars == null || row.total_ars === "" ? null : num(row.total_ars),
      status: row.status,
      transactionId: row.transaction_id,
      items: (itemsByReceipt.get(row.id) ?? []).map((item) => ({
        id: item.id,
        name: item.name,
        quantity: item.quantity == null || item.quantity === "" ? null : num(item.quantity),
        lineTotal: item.line_total == null || item.line_total === "" ? null : num(item.line_total),
      })),
    })),
  });
}
