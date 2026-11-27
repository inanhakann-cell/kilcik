// Av bildirimi aboneligi: yarin gitmeye degerse aksam telefona bildirim gelir (uygulama kapaliyken de).
import * as api from './api.js';
import * as ses from './ses.js';
import { cacheGet } from './store.js';
import { SAMPLE_SPOTS } from './species.js';
import { app, esc, chips, toast } from './ui.js';

// Bildirim sunucusunun adresi. Bos oldugu surece menude bu bolum gorunmez.
export const SERVER = 'https://kilcik-bildirim.kilcik-araclar.workers.dev';
const KEY = 'bildirim';
const ASKED = 'bildirim-soruldu';

const saved = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } };
const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const iosBrowser = () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !(navigator.standalone || matchMedia('(display-mode: standalone)').matches);
let level = null;
const soundPart = () => `<h3>Bildirim sesi: kalama (3 sn)</h3>
    <label class="check"><input type="checkbox" data-field="pushsound" ${ses.wanted() ? 'checked' : ''}> Bildirimlerde kalama sesi çalsın</label>
    <p class="mute">${ses.inApp() ? 'İşaretliyse av bildirimleri kalama sesiyle gelir.' : 'Bildirime dokununca veya uygulama açıkken bildirim gelince çalar. Uygulama kapalıyken bildirim telefonun kendi sesiyle gelir.'}</p>
    <div class="row wrap"><button type="button" class="btn" data-act="pushsound">Sesi dinle</button></div>`;

export const post = async (path, body) => {
    const res = await fetch(`${SERVER}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || `Sunucu ${res.status}`);
    return out;
};

async function currentArea() {
    const spot = app.state.spots[0];
    const [name, lat, lon] = SAMPLE_SPOTS[0];
    return (await cacheGet('area')) || (spot ? { name: spot.name, lat: spot.lat, lon: spot.lon } : { name: `${name} çevresi`, lat, lon });
}

// Bilgisayar surumu (127.0.0.1) telefon bildirimi almaz.
export const offered = () => Boolean(SERVER) && !['127.0.0.1', 'localhost'].includes(location.hostname);

export const card = () => (offered() ? '<section class="card" id="push"></section>' : '');

export async function paint(root) {
    const box = root.querySelector('#push');
    if (!box) return;
    const on = saved();
    const area = await currentArea();
    level ||= on?.level || 'iyi';
    const hint = iosBrowser() ? 'iPhone’da bildirim için uygulamayı ana ekrana ekleyip oradan açın.'
        : !supported() ? 'Bu tarayıcı bildirimi desteklemiyor.'
            : Notification.permission === 'denied' ? 'Bildirim izni telefonda kapalı. Telefon ayarlarından KILÇIK için bildirimlere izin verin.' : '';
    box.innerHTML = `<h2>Av bildirimi</h2>
        <p>Yarın balığa değerse akşam 19:00’da sebepleriyle bildirim gelir. En fazla günde bir; güvenli olmayan günlerde gelmez.</p>
        <p>Durum: <b class="${on ? 'ok' : 'mute'}">${on ? 'Açık' : 'Kapalı'}</b></p>
        ${hint ? `<p class="warn">${hint}</p>` : `<p class="mute">Bölge: <b>${esc(on?.name || area.name)}</b>${app.pref.species ? ` · hedef: ${esc(app.pref.species)}` : ''}</p>
        ${chips('pushlevel', [['iyi', 'İyi günler'], ['cokiyi', 'Yalnız çok iyi günler']], level)}
        <div class="row wrap"><button type="button" class="btn${on ? '' : ' primary'}" data-act="pushon">${on ? 'Bölgeyi ve ayarı güncelle' : 'İzin ver'}</button>
        <button type="button" class="btn" data-act="pushoff">${on ? 'İzin verme (kapat)' : 'İzin verme'}</button>
        ${on ? '<button type="button" class="btn" data-act="pushtest">Deneme bildirimi gönder</button>' : ''}</div>`}
        ${on && !hint ? `<label class="check"><input type="checkbox" data-field="pushfollow" ${on.follow ? 'checked' : ''}> Bildirim bölgesi bulunduğum yeri izlesin</label>
        <p class="mute">Açıksa, uygulamayı başka bir yerde açtığınızda yeni bölgenin yaklaşık konumu sunucuya gönderilir.</p>` : ''}
        <p class="mute">Sunucuya yalnızca bildirim adresi, bölgenin yaklaşık konumu, hedef balık ve bu ayar gider. “İzin verme (kapat)” fırtına nöbetini ve yakın uyarısı kodunuzu da kapatır.</p>
        ${soundPart()}`;
}

export async function change(field, root) {
    if (field === 'pushsound') {
        ses.choose(!ses.wanted());
        if (ses.wanted()) ses.play();
        return paint(root);
    }
    const on = saved();
    if (field !== 'pushfollow' || !on) return;
    const follow = !on.follow;
    localStorage.setItem(KEY, JSON.stringify({ ...on, follow }));
    if (follow) { const area = await currentArea(); if (area.gps) { delete on.lat; localStorage.setItem(KEY, JSON.stringify({ ...on, follow })); await areaChanged(area); } }
    paint(root);
}

const keyBytes = s => Uint8Array.from(atob(s.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));

async function send(sub, area, wanted, follow) {
    const shore = await api.shoreInfo(area.lat, area.lon).catch(() => null);
    await post('/abone', { sub: sub.toJSON(), area: { name: area.name, lat: area.lat, lon: area.lon, bearing: shore?.bearing ?? null }, species: app.pref.species || '', level: wanted, technique: app.draft.technique });
    localStorage.setItem(KEY, JSON.stringify({ level: wanted, name: area.name, lat: area.lat, lon: area.lon, follow }));
}

/** Kullanici istediyse bildirimin bolgesi bulunulan yere tasinir (5 km'den fazla yer degisince). */
export async function areaChanged(area) {
    const on = saved();
    if (!on?.follow || !offered() || !supported() || Notification.permission !== 'granted') return;
    if (Number.isFinite(on.lat) && Math.hypot(on.lat - area.lat, (on.lon - area.lon) * 0.76) * 111 < 5) return;
    try {
        const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
        if (sub) await send(sub, area, on.level, true);
    } catch { /* sunucuya ulasilamazsa bir sonraki acilista yeniden denenir */ }
}

/** Varsa bu cihazin bildirim aboneligi. */
export const current = async () => (await navigator.serviceWorker?.getRegistration())?.pushManager?.getSubscription();

/** Izin ister ve aboneligi dondurur; olmazsa sebebiyle hata verir. */
export async function subscription() {
    if (iosBrowser()) throw new Error('iPhone’da bildirim için uygulamayı ana ekrana ekleyip oradan açın.');
    if (!supported()) throw new Error('Bu tarayıcı bildirimi desteklemiyor.');
    // iPhone izni yalnizca dokunustan hemen sonra sorulabilir.
    if ((await Notification.requestPermission()) !== 'granted') throw new Error('Bildirim izni verilmedi.');
    const reg = await navigator.serviceWorker.ready;
    const old = await reg.pushManager.getSubscription();
    if (old) return old;
    const res = await fetch(`${SERVER}/anahtar`);
    if (!res.ok) throw new Error('Sunucuya ulaşılamadı.');
    const { key } = await res.json();
    return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
}

async function subscribe(wanted) {
    try {
        const sub = await subscription();
        await send(sub, await currentArea(), wanted, Boolean(saved()?.follow));
        toast('Bildirimler açık.', 'ok');
        ses.ask();
    } catch (err) { toast(`Bildirim açılamadı: ${err.message}`, 'bad'); }
}

/** Acilista bir kez sorar; tanisma veya guncelleme notu aciksa kapanmasini bekler. */
export function prompt() {
    // Bildirimi zaten acik olan kullaniciya yalnizca ses sorulur (bir kez).
    if (offered() && supported() && saved() && Notification.permission === 'granted') ses.ask();
    if (!offered() || !supported() || iosBrowser() || saved() || localStorage.getItem(ASKED) || Notification.permission === 'denied') return;
    if (document.querySelector('#news,#welcome')) { setTimeout(prompt, 700); return; }
    if (document.getElementById('ask')) return;
    const box = document.createElement('div');
    box.id = 'ask';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Bildirim izni');
    box.innerHTML = `<div class="sheet"><h1>Balık günü gelince haber verelim mi?</h1>
        <section class="card"><p>Yarın balığa değerse akşam 19:00’da saatini ve sebeplerini bildirim olarak göndeririz. En fazla günde bir.</p>
        <p class="mute">Sunucuya yalnızca bildirim adresi, bölgenin yaklaşık konumu, hedef balık ve ayar gider.</p></section>
        <button type="button" class="btn primary big" data-answer="yes">İzin ver</button>
        <button type="button" class="btn big" data-answer="no">İzin verme</button>
        <p class="mute">Sonradan ☰ Menü → Av bildirimi’nden değiştirebilirsiniz.</p></div>`;
    box.addEventListener('click', e => {
        const answer = e.target.closest('[data-answer]')?.dataset.answer;
        if (!answer) return;
        localStorage.setItem(ASKED, answer);
        box.remove();
        if (answer === 'yes') subscribe('iyi');
    });
    document.body.append(box);
}

export const actions = {
    pushsound: () => ses.play(),
    pushlevel: (v, root) => { level = v; paint(root); },
    pushon: async (v, root) => { await subscribe(level); paint(root); },
    pushtest: async () => {
        try {
            const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
            if (!sub) throw new Error('Önce bildirimlere izin verin.');
            await post('/dene', { endpoint: sub.endpoint });
            toast('Deneme gönderildi; birkaç saniye içinde gelir.', 'ok');
        } catch (err) { toast(`Gönderilemedi: ${err.message}`, 'bad'); }
    },
    pushoff: async (v, root) => {
        try {
            localStorage.setItem(ASKED, 'no');
            const sub = await current();
            if (sub) { await post('/sil', { endpoint: sub.endpoint }); await sub.unsubscribe(); }
            localStorage.removeItem(KEY);
            // Abonelik silinince firtina nobeti de kapanir.
            localStorage.removeItem('firtina-nobeti');
            // Yakin kodu da bu abonelige baglidir.
            localStorage.removeItem('yakin-kodum');
            toast('Bildirim gönderilmeyecek.', 'ok');
        } catch (err) { toast(`Kapatılamadı: ${err.message}`, 'bad'); }
        paint(root);
    }
};
