// Av bildirimi aboneligi: yarin gitmeye degerse aksam telefona bildirim gelir (uygulama kapaliyken de).
import * as api from './api.js';
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

const post = async (path, body) => {
    const res = await fetch(`${SERVER}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || `Sunucu ${res.status}`);
};

async function currentArea() {
    const spot = app.state.spots[0];
    const [name, lat, lon] = SAMPLE_SPOTS[0];
    return (await cacheGet('area')) || (spot ? { name: spot.name, lat: spot.lat, lon: spot.lon } : { name: `${name} çevresi`, lat, lon });
}

// Bilgisayar surumu (127.0.0.1) telefon bildirimi almaz.
const offered = () => Boolean(SERVER) && !['127.0.0.1', 'localhost'].includes(location.hostname);

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
        <p class="mute">Sunucuya yalnızca bildirim adresi, bölgenin yaklaşık konumu, hedef balık ve bu ayar gider.</p>`;
}

const keyBytes = s => Uint8Array.from(atob(s.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));

async function subscribe(wanted) {
    try {
        // iPhone izni yalnizca dokunustan hemen sonra sorulabilir.
        if ((await Notification.requestPermission()) !== 'granted') return toast('Bildirim izni verilmedi.', 'bad');
        const reg = await navigator.serviceWorker.ready;
        const res = await fetch(`${SERVER}/anahtar`);
        if (!res.ok) throw new Error('Sunucuya ulaşılamadı.');
        const { key } = await res.json();
        const sub = await reg.pushManager.getSubscription() || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
        const area = await currentArea();
        const shore = await api.shoreInfo(area.lat, area.lon).catch(() => null);
        await post('/abone', { sub: sub.toJSON(), area: { ...area, bearing: shore?.bearing ?? null }, species: app.pref.species || '', level: wanted, technique: app.draft.technique });
        localStorage.setItem(KEY, JSON.stringify({ level: wanted, name: area.name }));
        toast('Bildirimler açık.', 'ok');
    } catch (err) { toast(`Bildirim açılamadı: ${err.message}`, 'bad'); }
}

/** Acilista bir kez sorar; tanisma veya guncelleme notu aciksa kapanmasini bekler. */
export function prompt() {
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
            const sub = await (await navigator.serviceWorker?.getRegistration())?.pushManager?.getSubscription();
            if (sub) { await post('/sil', { endpoint: sub.endpoint }); await sub.unsubscribe(); }
            localStorage.removeItem(KEY);
            toast('Bildirim gönderilmeyecek.', 'ok');
        } catch (err) { toast(`Kapatılamadı: ${err.message}`, 'bad'); }
        paint(root);
    }
};
