// build 2026-11-07
// The Archives — Sarah's Library: offline cache for the shell.
// /api/ is never cached; covers + texture assets are cache-first but
// only successful (res.ok) responses are stored, so a cover that
// lands later is never masked by a cached 404; pages are
// network-first with the cache as the offline fallback.
const CACHE = "library-v4";
const SHELL = [
  ".",
  "index.html",
  "app.js",
  "theme.css",
  "manifest.webmanifest",
  "icons/icon-192.png?v=2",
  "icons/icon-512.png?v=2",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith("/api/")) return; // never cache account APIs
  if (e.request.method !== "GET") return;
  const isCoverOrAsset =
    url.origin === self.location.origin &&
    (url.pathname.includes("/covers/") || url.pathname.includes("/assets/"));
  if (isCoverOrAsset) {
    // Covers + photographic assets: cache-first (they never change
    // once published), and ONLY cache res.ok so an early 404 for a
    // not-yet-uploaded cover can never poison the cache.
    e.respondWith(
      caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      }))
    );
    return;
  }
  // Pages & shell: network-first so updates land, cache as fallback.
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok && url.origin === self.location.origin) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
