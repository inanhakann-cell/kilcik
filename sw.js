// URETILEN DOSYA (tools/derle.mjs). Elle duzenlemeyin.
const CACHE = 'kilcik-a04a0cadd575';
const FILES = ["./","app.css","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","index.html","js/activity.js","js/ai.js","js/alerts.js","js/api.js","js/core.js","js/legal.js","js/main.js","js/places.js","js/planner.js","js/seabed.js","js/session.js","js/share.js","js/species.js","js/store.js","js/ui.js","js/views/lists.js","js/views/log.js","js/views/map.js","js/views/plan.js","js/views/scan.js","js/views/species.js","js/views/today.js","js/views/weather.js","manifest.webmanifest","vendor/chart.umd.min.js","vendor/leaflet/images/layers-2x.png","vendor/leaflet/images/layers.png","vendor/leaflet/images/marker-icon-2x.png","vendor/leaflet/images/marker-icon.png","vendor/leaflet/images/marker-shadow.png","vendor/leaflet/leaflet.css","vendor/leaflet/leaflet.js","vendor/suncalc.js"];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE)
    .then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('kilcik-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
// Yalnizca uygulama dosyalari onbellekten gelir; hava ve harita her zaman agdan istenir.
self.addEventListener('fetch', e => {
    if (e.request.method !== 'GET' || new URL(e.request.url).origin !== self.location.origin) return;
    e.respondWith(caches.open(CACHE).then(c => c.match(e.request, { ignoreSearch: true })).then(hit => hit || fetch(e.request)));
});
