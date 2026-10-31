import { createHash } from "crypto";
import { getCloudflareContext } from "@opennextjs/cloudflare";

const PUBLIC_PREFIX = "/api/receipts/file/";

type ReceiptsBucket = NonNullable<CloudflareEnv["RECEIPTS"]>;

/** True when the stored image_url is an object we can read back from R2. */
export function isReceiptObjectPath(imageUrl: string | null | undefined): boolean {
  return Boolean(imageUrl && imageUrl.startsWith(PUBLIC_PREFIX));
}

export function receiptPublicPath(objectKey: string): string {
  return `${PUBLIC_PREFIX}${objectKey.split("/").map(encodeURIComponent).join("/")}`;
}

export function objectKeyFromPublicPath(pathname: string): string | null {
  if (!pathname.startsWith(PUBLIC_PREFIX)) return null;
  const rest = pathname.slice(PUBLIC_PREFIX.length);
  if (!rest || rest.includes("..")) return null;
  try {
    const key = rest.split("/").map((part) => decodeURIComponent(part)).join("/");
    return safeReceiptKey(key) ? key : null;
  } catch {
    return null;
  }
}

/** receipts/{householdId}/{file} — no traversal, no empty segments. */
export function safeReceiptKey(key: string): boolean {
  if (!key.startsWith("receipts/")) return false;
  const parts = key.split("/");
  if (parts.length < 3) return false;
  if (parts.some((part) => !part || part === "." || part === "..")) return false;
  return true;
}

export function householdIdFromReceiptKey(key: string): string | null {
  if (!safeReceiptKey(key)) return null;
  return key.split("/")[1] ?? null;
}

export async function getReceiptsBucket(): Promise<ReceiptsBucket | null> {
  try {
    const { env } = await getCloudflareContext({ async: true });
    const bucket = (env as CloudflareEnv).RECEIPTS;
    if (!bucket || typeof bucket.put !== "function") return null;
    return bucket;
  } catch {
    return null;
  }
}

/** statements/{householdId}/{sha256}.pdf — not served by the receipt file route. */
export async function putStatementPdf(opts: {
  householdId: string;
  body: Uint8Array;
}): Promise<string | null> {
  const bucket = await getReceiptsBucket();
  if (!bucket) return null;
  if (!opts.householdId || opts.householdId.includes("/") || opts.householdId.includes("..")) {
    return null;
  }
  const hash = createHash("sha256").update(opts.body).digest("hex");
  const key = `statements/${opts.householdId}/${hash}.pdf`;
  await bucket.put(key, opts.body, {
    httpMetadata: { contentType: "application/pdf" },
  });
  return key;
}

export async function putReceiptImage(opts: {
  householdId: string;
  fileName: string;
  body: Uint8Array;
  contentType: string;
}): Promise<string | null> {
  const bucket = await getReceiptsBucket();
  if (!bucket) return null;
  const safeName =
    opts.fileName.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^\.+/, "").slice(0, 80) ||
    "ticket";
  const key = `receipts/${opts.householdId}/${Date.now()}-${safeName}`;
  await bucket.put(key, opts.body, {
    httpMetadata: { contentType: opts.contentType || "application/octet-stream" },
  });
  return receiptPublicPath(key);
}

export async function deleteReceiptImage(imageUrl: string | null | undefined): Promise<void> {
  if (!imageUrl || !isReceiptObjectPath(imageUrl)) return;
  const key = objectKeyFromPublicPath(imageUrl.split("?")[0] ?? imageUrl);
  if (!key) return;
  const bucket = await getReceiptsBucket();
  if (!bucket) return;
  await bucket.delete(key);
}

export async function readReceiptImage(key: string): Promise<{
  body: ReadableStream;
  contentType: string;
} | null> {
  if (!safeReceiptKey(key)) return null;
  const bucket = await getReceiptsBucket();
  if (!bucket) return null;
  const object = await bucket.get(key);
  if (!object) return null;
  return {
    body: object.body,
    contentType: object.httpMetadata?.contentType || "application/octet-stream",
  };
}
