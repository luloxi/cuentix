import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api-auth";
import {
  getAgentGastos,
  isAgentServiceError,
} from "@/lib/agent/services";

export async function GET(req: Request) {
  const authResult = await requireApiUser();
  if ("error" in authResult) return authResult.error;

  try {
    const { searchParams } = new URL(req.url);
    const data = await getAgentGastos(
      authResult,
      searchParams.get("period"),
    );
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
