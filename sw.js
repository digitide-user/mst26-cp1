const CACHE_NAME = "mst26-cp1-cache-v2"; // v1 から v2 に上げて旧キャッシュを確実に捨てる

const CORE = [
  "./",
  "./index.html",
  "./app.js",
  "./sw.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(CORE);
  })());
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => (k === CACHE_NAME ? null : caches.delete(k))));
    await self.clients.claim();
  })());
});

// online優先（更新を取りに行く）＋ offlineフォールバック
async function networkFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const fresh = await fetch(req, { cache: "no-store" });
    if (fresh && fresh.ok) cache.put(req, fresh.clone());
    return fresh;
  } catch (e) {
    const cached = await cache.match(req);
    return cached || (await cache.match("./index.html")) || new Response("offline", { status: 503 });
  }
}

// cache優先（オフラインでも軽く動く）＋裏で更新
async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(req);

  const fetchPromise = fetch(req).then((fresh) => {
    if (fresh && fresh.ok) cache.put(req, fresh.clone());
    return fresh;
  }).catch(() => null);

  return cached || (await fetchPromise) || new Response("offline", { status: 503 });
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 同一オリジンのみ（APIは別オリジンなのでここに来ない）
  if (url.origin !== self.location.origin) return;

  // HTML/JS は「更新が命」なので network-first
  const isHTML = req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html");
  const isJS = url.pathname.endsWith(".js");

  if (isHTML || isJS) {
    event.respondWith(networkFirst(req));
    return;
  }

  // その他は cache優先＋裏更新
  event.respondWith(staleWhileRevalidate(req));
});
