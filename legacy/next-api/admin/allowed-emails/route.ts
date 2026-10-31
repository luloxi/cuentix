import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api-auth";
import {
  addAllowedEmail,
  isAdminEmail,
  listAllowedEmails,
  removeAllowedEmail,
} from "@/lib/auth/allowlist";

export async function GET() {
  const authResult = await requireApiUser();
  if ("error" in authResult) return authResult.error;
  const { user } = authResult;

  if (!isAdminEmail(user.email)) {
    return NextResponse.json({ error: "Solo admin" }, { status: 403 });
  }

  try {
    const emails = await listAllowedEmails();
    return NextResponse.json({ emails });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  const authResult = await requireApiUser();
  if ("error" in authResult) return authResult.error;
  const { user } = authResult;

  if (!isAdminEmail(user.email)) {
    return NextResponse.json({ error: "Solo admin" }, { status: 403 });
  }

  try {
    const body = (await req.json()) as { email?: string };
    if (!body.email?.trim()) {
      return NextResponse.json({ error: "Email requerido" }, { status: 400 });
    }
    const row = await addAllowedEmail(body.email, user.email);
    const emails = await listAllowedEmails();
    return NextResponse.json({ ok: true, added: row, emails });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 400 },
    );
  }
}

export async function DELETE(req: Request) {
  const authResult = await requireApiUser();
  if ("error" in authResult) return authResult.error;
  const { user } = authResult;

  if (!isAdminEmail(user.email)) {
    return NextResponse.json({ error: "Solo admin" }, { status: 403 });
  }

  try {
    const body = (await req.json()) as { email?: string };
    if (!body.email?.trim()) {
      return NextResponse.json({ error: "Email requerido" }, { status: 400 });
    }
    await removeAllowedEmail(body.email);
    const emails = await listAllowedEmails();
    return NextResponse.json({ ok: true, emails });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 400 },
    );
  }
}
