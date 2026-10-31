import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/lib/auth/server";

function notConfigured() {
  return Response.json(
    { error: "Auth is not configured. Set BETTER_AUTH_SECRET." },
    { status: 503 },
  );
}

async function handle(request: Request, method: "GET" | "POST") {
  const auth = await getAuth();
  if (!auth) return notConfigured();
  const handler = toNextJsHandler(auth);
  return handler[method](request);
}

export function GET(request: Request) {
  return handle(request, "GET");
}

export function POST(request: Request) {
  return handle(request, "POST");
}
