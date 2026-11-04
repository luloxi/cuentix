const LEGACY_HOST = "cuentix.lulox.com.ar";
const PUBLIC_ORIGIN = "https://tarask.lulox.com.ar";

/** Old host still routes to this Worker. 301 to the public origin, same path and query. */
export function redirectLegacyHost(request: Request): Response | null {
  const url = new URL(request.url);
  if (url.hostname !== LEGACY_HOST) return null;
  return Response.redirect(`${PUBLIC_ORIGIN}${url.pathname}${url.search}`, 301);
}
