import {
  generateProtectedResourceMetadata,
  metadataCorsOptionsRequestHandler,
} from "mcp-handler";

/**
 * RFC 9728 protected-resource metadata for MCP clients.
 * Auth is a static agent token header (not a full interactive OAuth AS).
 * Clients should send Authorization with the configured agent token.
 */
export async function GET(req: Request) {
  const origin =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
    new URL(req.url).origin;
  const metadata = {
    ...generateProtectedResourceMetadata({
      authServerUrls: [origin],
      resourceUrl: `${origin}/api/mcp`,
    }),
    bearer_methods_supported: ["header"],
    resource_documentation: `${origin}/mcp`,
    scopes_supported: ["llevacuentas:read", "llevacuentas:import"],
  };
  return Response.json(metadata, {
    headers: {
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

export const OPTIONS = metadataCorsOptionsRequestHandler();
