// INSPOBOX service worker — cache-first for the app shell and cover art,
// network-only for the gated data API. Bump the cache name on any shell fix.
const CACHE = "inspobox-v86";
const CORE = ["/inspobox/", "/inspobox/index.html", "/inspobox/manifest.webmanifest", "/inspobox/icons/icon.svg", "/inspobox/fonts/anton.woff2", "/inspobox/fonts/unbounded.woff2", "/inspobox/fonts/unbounded700.woff2", "/inspobox/fonts/sg500.woff2", "/inspobox/fonts/sg700.woff2"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.pathname.startsWith("/api/")) return;
  if (e.request.mode === "navigate") {
    // App shell: network-first so a fresh deploy shows on the next open.
    e.respondWith(fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request).then((hit) => hit || caches.match("/inspobox/index.html"))));
    return;
  }
  e.respondWith(
    caches.match(e.request).then((hit) => {
      const net = fetch(e.request).then((res) => {
        if (res.ok && url.origin === location.origin) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
