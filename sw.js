const CACHE_NAME = "mst26-cp1-cache-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./app.js",
  "./sw.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => (k === CACHE_NAME ? null : caches.delete(k))));
      await self.clients.claim();
    })()
  );
});

// 基本は「キャッシュ優先」：オフラインでも起動できるようにする
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // GitHub Pages の同一オリジンだけキャッシュ（APIはキャッシュしない）
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req, { ignoreSearch: true });
      if (cached) return cached;

      try {
        const fresh = await fetch(req);
        // html/js/css は保存しておく（次回オフライン起動用）
        if (fresh.ok && (req.method === "GET")) {
          cache.put(req, fresh.clone());
        }
        return fresh;
      } catch (e) {
        // 何も取れない場合はトップにフォールバック
        return (await cache.match("./index.html")) || new Response("offline", { status: 503 });
      }
    })()
  );
});
