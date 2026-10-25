// Lodge Boys 2026 — offline cache for the shell and the app page.
const CACHE = 'lodge-v1';
const SHELL = ['./', './index.html', './icons/icon.svg'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (u.pathname.startsWith('/api/')) return; // live data: never cache API responses
  if (u.hostname.endsWith('fonts.googleapis.com') || u.hostname.endsWith('fonts.gstatic.com')) {
    e.respondWith(caches.open(CACHE).then(async c => { const hit = await c.match(e.request); if (hit) return hit; const r = await fetch(e.request); if (r.ok) c.put(e.request, r.clone()); return r; }));
    return;
  }
  if (e.request.mode === 'navigate') {
    // Page loads: network first so updates show up immediately; the cache
    // (including the signed-in app page) is the offline fallback.
    e.respondWith(fetch(e.request).then(r => { if (r.ok && u.origin === location.origin) caches.open(CACHE).then(c => c.put(e.request, r.clone())); return r; }).catch(() => caches.match(e.request).then(hit => hit || caches.match('./index.html'))));
    return;
  }
  if (u.origin === location.origin) {
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => { if (r.ok && u.origin === location.origin) caches.open(CACHE).then(c => c.put(e.request, r.clone())); return r; }).catch(() => caches.match('./index.html'))));
  }
});
