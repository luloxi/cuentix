import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api-auth";

/** Discovery document for El Tano / Jurio. Auth required. */
export async function GET() {
  const authResult = await requireApiUser();
  if ("error" in authResult) return authResult.error;

  return NextResponse.json({
    name: "Cuentix agent API",
    auth: "Authorization: Bearer <token del hogar>. Fallback admin/dev: AGENT_API_TOKEN",
    actingAs: {
      id: authResult.user.id,
      email: authResult.user.email,
      householdId: authResult.householdId ?? null,
      authKind: authResult.authKind,
    },
    mcp: {
      url: "/api/mcp",
      transport: "streamable-http",
      tools: [
        "gastos_del_mes",
        "resumen",
        "importar_resumen",
        "listar_cargas",
      ],
    },
    endpoints: [
      {
        method: "GET",
        path: "/api/agent/summary",
        description:
          "Load stored statement/month summary from the household database.",
      },
      {
        method: "POST",
        path: "/api/agent/import",
        description:
          "Import a BBVA (or Fiwind-labeled) statement: multipart file, or JSON fileBase64.",
      },
      {
        method: "GET",
        path: "/api/agent/gastos",
        query: {
          period: "YYYY-MM | latest | omit for current calendar month (AR)",
        },
        description:
          "Gastos del mes from stored transactions (no placeholders).",
      },
      {
        method: "GET|POST",
        path: "/api/mcp",
        description:
          "Remote MCP (Streamable HTTP). Same bearer token. Tools wrap the agent API.",
      },
    ],
  });
}
