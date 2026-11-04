const LEGACY_HOST = "cuentix.lulox.com.ar";
const PUBLIC_ORIGIN = "https://tarask.lulox.com.ar";

/**
 * Old host still routes to this Worker. 301 to the public origin, same path and query.
 * /api/* stays on the old host, except the Google OAuth callback: Google returns to the old
 * (registered) URI, but the login started on tarask set its state cookie there, so the callback
 * must continue on tarask with the same code and state.
 */
export function redirectLegacyHost(request: Request): Response | null {
  const url = new URL(request.url);
  if (url.hostname !== LEGACY_HOST) return null;
  const isCallback = url.pathname === "/api/auth/callback/google";
  if (!isCallback && (url.pathname === "/api" || url.pathname.startsWith("/api/"))) return null;
  return new Response(null, {
    status: 301,
    headers: {
      location: `${PUBLIC_ORIGIN}${url.pathname}${url.search}`,
      "cache-control": "no-store",
    },
  });
}
