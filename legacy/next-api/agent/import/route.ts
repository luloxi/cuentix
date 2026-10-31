import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api-auth";
import { normalizeBank } from "@/lib/banks";
import {
  importAgentStatement,
  isAgentServiceError,
} from "@/lib/agent/services";

async function readUpload(req: Request): Promise<
  | {
      buffer: Buffer;
      fileName: string;
      bank: string;
      kind: string;
    }
  | { error: string }
> {
  const contentType = req.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const body = (await req.json()) as {
      fileBase64?: string;
      fileName?: string;
      bank?: string;
      kind?: string;
    };
    if (!body.fileBase64) return { error: "Falta fileBase64" };
    const fileName =
      (body.fileName ?? "statement.bin").trim() || "statement.bin";
    const buffer = Buffer.from(body.fileBase64, "base64");
    if (buffer.length === 0) return { error: "Archivo vacío" };
    return {
      buffer,
      fileName,
      bank: normalizeBank(body.bank) ?? "BBVA",
      kind: String(body.kind ?? "bbva"),
    };
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return { error: "Falta el archivo" };
  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length === 0) return { error: "Archivo vacío" };
  return {
    buffer,
    fileName: file.name,
    bank: normalizeBank(String(form.get("bank") ?? "")) ?? "BBVA",
    kind: String(form.get("kind") ?? "bbva"),
  };
}

export async function POST(req: Request) {
  const authResult = await requireApiUser();
  if ("error" in authResult) return authResult.error;

  try {
    const upload = await readUpload(req);
    if ("error" in upload) {
      return NextResponse.json({ error: upload.error }, { status: 400 });
    }

    const data = await importAgentStatement(authResult, upload);
    return NextResponse.json(data);
  } catch (e) {
    if (isAgentServiceError(e)) {
      return NextResponse.json(
        { error: e.error, code: e.code },
        { status: e.status },
      );
    }
    const msg = e instanceof Error ? e.message : "Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
