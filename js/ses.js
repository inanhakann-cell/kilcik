// Bildirim sesi (3 sn kalama): bildirime dokunulunca veya uygulama acikken bildirim gelince calar.
// Uygulama kapaliyken gelen bildirimin sesini telefon belirler; web uygulamasi degistiremez.
// Android uygulamasinda (APK) onay verenlerin bildirimi her zaman bu sesle gelir.
const FILE = 'ses/bildirim.mp3';
// sw.js ile ayni adlar. 'kilcik-' ile baslamaz; yeni surumde eski onbelleklerle silinmez.
const MARK_CACHE = 'ses-isareti';
const MARK = 'bildirim-dokunuldu';
// Kullanicinin cevabi: 'yes' | 'no' | yok (henuz sorulmadi).
const CHOICE = 'bildirim-ses';
const CONSENT = 'kalama-onayi';
// Android uygulamasindan acildiysa ilk sayfanin kaynagi paket adidir; yenilemede kaybolmasin diye saklanir.
if (document.referrer.startsWith('android-app://app.kilcik.av')) sessionStorage.setItem('android-uygulama', '1');
export const inApp = () => sessionStorage.getItem('android-uygulama') === '1';
const audio = new Audio();
let loading = null;
let waiting = false;

// iPhone onbellekten gelen sesi parca parca isteyemedigi icin dosya tumuyle alinir.
const load = () => (loading ||= fetch(FILE)
    .then(r => { if (!r.ok) throw new Error(r.status); return r.blob(); })
    .then(b => { audio.src = URL.createObjectURL(b); })
    .catch(() => { loading = null; }));

const onTouch = () => { waiting = false; audio.currentTime = 0; audio.play().catch(() => {}); };

function playNow() {
    audio.currentTime = 0;
    return audio.play().catch(() => {
        // Telefon dokunussuz ses calmaya izin vermezse ilk dokunusta calinir.
        if (waiting) return;
        waiting = true;
        document.addEventListener('click', onTouch, { once: true, capture: true });
    });
}

export const play = () => (audio.src ? playNow() : load().then(() => audio.src && playNow()));

export const wanted = () => localStorage.getItem(CHOICE) === 'yes';
export const choose = on => {
    localStorage.setItem(CHOICE, on ? 'yes' : 'no');
    share().catch(() => {});
};

// sw.js localStorage okuyamadigi icin onay onbellege de yazilir.
async function share() {
    if (!('caches' in window)) return;
    const cache = await caches.open(MARK_CACHE);
    await (wanted() ? cache.put(CONSENT, new Response('1')) : cache.delete(CONSENT));
}

/** Bildirimi acik olan kullaniciya bir kez sorar; baska bir pencere aciksa kapanmasini bekler. */
export function ask() {
    if (localStorage.getItem(CHOICE)) return;
    if (document.querySelector('#news,#welcome,#ask')) { setTimeout(ask, 700); return; }
    const box = document.createElement('div');
    box.id = 'ask';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Bildirim sesi');
    box.innerHTML = `<div class="sheet"><h1>Bildirimlerde kalama sesi olsun mu?</h1>
        <section class="card">${inApp() ? '<p>Av bildirimleri 3 saniyelik kalama sesiyle gelir.</p>'
            : `<p>Bildirime dokununca ve uygulama açıkken bildirim gelince 3 saniyelik kalama sesi çalar.</p>
        <p class="mute">Uygulama kapalıyken bildirimin geldiği anda telefonun kendi sesi duyulur.</p>`}</section>
        <button type="button" class="btn primary big" data-answer="yes">Evet, sesli olsun</button>
        <button type="button" class="btn big" data-answer="no">Hayır</button>
        <p class="mute">Sonradan ☰ Menü → Av bildirimi’nden değiştirebilirsiniz.</p></div>`;
    box.addEventListener('click', e => {
        const answer = e.target.closest('[data-answer]')?.dataset.answer;
        if (!answer) return;
        choose(answer === 'yes');
        box.remove();
        // Dokunus aninda calinir; hem ornek duyulur hem telefon sese izin verir.
        if (answer === 'yes') play();
    });
    document.body.append(box);
}

async function tapped() {
    if (!('caches' in window) || document.visibilityState !== 'visible') return;
    const cache = await caches.open(MARK_CACHE);
    const mark = await cache.match(MARK);
    if (!mark) return;
    const at = Number(await mark.text());
    // Ayni isareti iki olay birden okursa ses bir kez calsin.
    if (await cache.delete(MARK) && Date.now() - at < 60000 && wanted() && !inApp()) play();
}

export function start() {
    load();
    share().catch(() => {});
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.addEventListener('message', e => {
        // Android uygulamasinda ses bildirimle gelir; ikinci kez calinmaz.
        if (e.data === 'bildirim-geldi' && document.visibilityState === 'visible' && wanted() && !inApp()) play();
        if (e.data === MARK) tapped().catch(() => {});
    });
    navigator.serviceWorker.startMessages?.();
    document.addEventListener('visibilitychange', () => tapped().catch(() => {}));
    tapped().catch(() => {});
}
