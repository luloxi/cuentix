/**
 * Minimal service worker for Web Share Target.
 * Intercepts POST /share-target, stores the shared file in Cache,
 * then redirects to the app so the client can process it.
 */
const CACHE_NAME = "lc-share-target-v1";
const SHARED_FILE_KEY = "shared-comprobante";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Only handle the share-target POST
  if (
    event.request.method === "POST" &&
    url.pathname === "/share-target"
  ) {
    event.respondWith(handleShareTarget(event.request));
    return;
  }
});

async function handleShareTarget(request) {
  try {
    const formData = await request.formData();
    const file =
      formData.get("comprobante") ||
      formData.get("file") ||
      formData.get("image");

    if (file && file instanceof File && file.size > 0) {
      const cache = await caches.open(CACHE_NAME);
      // Store as a Response so we can retrieve it later as a blob
      await cache.put(
        SHARED_FILE_KEY,
        new Response(file, {
          headers: {
            "Content-Type": file.type || "application/octet-stream",
            "X-File-Name": encodeURIComponent(file.name || "comprobante"),
            "X-File-Size": String(file.size),
          },
        }),
      );
    }

    // Also stash text/title/url if present (for future use)
    const meta = {
      title: formData.get("title") || "",
      text: formData.get("text") || "",
      url: formData.get("url") || "",
      receivedAt: Date.now(),
    };
    const cache = await caches.open(CACHE_NAME);
    await cache.put(
      "shared-meta",
      new Response(JSON.stringify(meta), {
        headers: { "Content-Type": "application/json" },
      }),
    );
  } catch (err) {
    console.error("[sw] share-target error", err);
  }

  // Redirect to the client page that will pick up the file
  return Response.redirect("/share-target?shared=1", 303);
}
