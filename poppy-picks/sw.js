/* Poppy's Picks — app-shell cache. Event data and favorites always come
   from the network (the /api/ routes are never cached), so listings are
   fresh every morning; the shell itself is cached for fast opens and
   offline resilience. */
const CACHE = "poppy-v14";
const CORE = [
  "/poppy-picks/",
  "/poppy-picks/index.html",
  "/poppy-picks/icons/icon-192.png",
  "/poppy-picks/manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/api/")) return; // account data: network only
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("/poppy-picks/index.html", copy));
          return res;
        })
        .catch(() => caches.match("/poppy-picks/index.html"))
    );
    return;
  }
  event.respondWith(
    caches.match(event.request).then((hit) => hit || fetch(event.request).then((res) => {
      if (res.ok && url.origin === location.origin) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(event.request, copy));
      }
      return res;
    }))
  );
});
