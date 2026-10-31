import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api-auth";
import { resolveEvmInput } from "@/lib/ens";

export async function GET(req: Request) {
  const authResult = await requireApiUser();
  if ("error" in authResult) return authResult.error;

  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (!q) {
    return NextResponse.json({ error: "Falta q" }, { status: 400 });
  }

  const result = await resolveEvmInput(q);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json(result.data);
}
