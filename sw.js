// URETILEN DOSYA (tools/derle.mjs). Elle duzenlemeyin.
const CACHE = 'kilcik-05d1960a3364';
const FILES = ["./","app.css","data/biga-dip.json","data/biga-kiyi.json","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","index.html","js/activity.js","js/ai.js","js/alerts.js","js/api.js","js/core.js","js/dip.js","js/donus.js","js/extras.js","js/geo.js","js/guide.js","js/install.js","js/islands.js","js/kur.js","js/legal.js","js/main.js","js/news.js","js/nobet.js","js/ortak.js","js/places.js","js/planner.js","js/push.js","js/qr.js","js/region.js","js/seabed.js","js/ses.js","js/session.js","js/share.js","js/species.js","js/store.js","js/ui.js","js/views/explore.js","js/views/lists.js","js/views/log.js","js/views/map.js","js/views/more.js","js/views/plan.js","js/views/rehber.js","js/views/species.js","js/views/today.js","js/views/weather.js","js/welcome.js","kilavuz.html","kilavuz/bugun.jpg","kilavuz/daha.jpg","kilavuz/gotur.jpg","kilavuz/gunluk.jpg","kilavuz/harita.jpg","kilavuz/hava.jpg","kilavuz/liste.jpg","kilavuz/mera.jpg","kilavuz/plan.jpg","kilavuz/seans.jpg","kur.html","manifest.webmanifest","qr.html","qr.svg","ses/bildirim.mp3","vendor/chart.umd.min.js","vendor/leaflet/images/layers-2x.png","vendor/leaflet/images/layers.png","vendor/leaflet/images/marker-icon-2x.png","vendor/leaflet/images/marker-icon.png","vendor/leaflet/images/marker-shadow.png","vendor/leaflet/leaflet.css","vendor/leaflet/leaflet.js","vendor/suncalc.js"];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE)
    .then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('kilcik-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
// Yalnizca uygulama dosyalari onbellekten gelir; hava ve harita her zaman agdan istenir.
self.addEventListener('fetch', e => {
    if (e.request.method !== 'GET' || new URL(e.request.url).origin !== self.location.origin) return;
    e.respondWith(caches.open(CACHE).then(c => c.match(e.request, { ignoreSearch: true })).then(hit => hit || fetch(e.request)));
});
// Av bildirimi: uygulama kapaliyken sunucudan gelen ileti gosterilir.
self.addEventListener('push', e => {
    let m = {};
    try { m = e.data.json(); } catch { /* iletisiz de bildirim gosterilmek zorunda */ }
    // Firtina ve donus bildirimleri kalama sesi calmaz.
    const storm = m.tag === 'firtina' || String(m.tag).startsWith('donus-');
    // Kalama sesine onay verildiyse etiket degisir; Android uygulamasi sesi bu etiketten anlar.
    const consent = caches.open('ses-isareti').then(c => c.match('kalama-onayi')).then(Boolean).catch(() => false);
    e.waitUntil(Promise.all([
        consent.then(yes => self.registration.showNotification(m.title || 'KILÇIK',
            { body: m.body || '', icon: 'icons/icon-192.png', tag: storm ? m.tag : yes ? 'av-kalama' : 'av', renotify: storm,
                requireInteraction: m.tag === 'donus-haberyok', data: { url: m.url || '' } })),
        storm ? null : tell('bildirim-geldi')
    ]));
});
const windows = () => self.clients.matchAll({ type: 'window', includeUncontrolled: true });
const tell = text => windows().then(list => list.forEach(c => c.postMessage(text)));
self.addEventListener('notificationclick', e => {
    e.notification.close();
    // Uygulama acilinca bildirim sesi calsin diye isaret birakilir (js/ses.js okur).
    const storm = e.notification.tag === 'firtina' || e.notification.tag.startsWith('donus-');
    // "Haber yok" uyarisina dokununca yalnizca harita baglantisi acilir.
    const url = e.notification.data?.url || '';
    if (url.startsWith('https://www.google.com/maps/')) return e.waitUntil(self.clients.openWindow(url));
    const mark = storm ? Promise.resolve() : caches.open('ses-isareti').then(c => c.put('bildirim-dokunuldu', new Response(String(Date.now()))));
    e.waitUntil(mark.catch(() => {}).then(windows)
        .then(list => (list[0] ? list[0].focus() : self.clients.openWindow('./')))
        .then(() => (storm ? null : tell('bildirim-dokunuldu'))));
});
