import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api-auth";
import {
  getAgentSummary,
  isAgentServiceError,
} from "@/lib/agent/services";

export async function GET() {
  const authResult = await requireApiUser();
  if ("error" in authResult) return authResult.error;

  try {
    const data = await getAgentSummary(authResult);
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
