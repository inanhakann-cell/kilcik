// Ortak isimsiz kayitlar (istege bagli) ve "sorun bildir". Paylasim varsayilan olarak kapalidir.
import { SERVER } from './push.js';
import { NOTES } from './news.js';
import { FLOORS } from './core.js';
import { cacheGet, cacheSet } from './store.js';
import { app, esc, toast } from './ui.js';

const PREF = 'ortak';          // { av: bool, dip: bool }
const SENT = 'ortak-giden';    // { anahtar: { id, kind, lat, lon, hash } }
const read = (key, empty) => { try { return JSON.parse(localStorage.getItem(key)) || empty; } catch { return empty; } };
const write = (key, value) => localStorage.setItem(key, JSON.stringify(value));
export const choice = () => read(PREF, {});

// Bilgisayar surumunde (127.0.0.1) sunucu islemleri kapalidir.
export const offered = () => Boolean(SERVER) && !['127.0.0.1', 'localhost'].includes(location.hostname);

async function post(path, body) {
    const res = await fetch(`${SERVER}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || `Sunucu ${res.status}`);
    return out;
}

const partOf = hour => (hour < 5 || hour >= 21 ? 'gece' : hour < 11 ? 'sabah' : hour < 16 ? 'öğle' : 'akşam');
const daysAgo = date => (Date.now() - Date.parse(date)) / 86400000;

/** Paylasilacak kayitlar: ayni gun ve yerdeki avlar tek "av" sayilir. */
export function outgoing(state, pref) {
    const out = new Map();
    if (pref.av) {
        for (const c of state.catches) {
            if (!c.at || c.lat === null || daysAgo(c.at.slice(0, 10)) > 14) continue;
            const key = `av|${c.at.slice(0, 10)}|${c.lat.toFixed(2)},${c.lon.toFixed(2)}`;
            const trip = out.get(key) || { kind: 'av', date: c.at.slice(0, 10), part: partOf(Number(c.at.slice(11, 13))), lat: Number(c.lat.toFixed(2)), lon: Number(c.lon.toFixed(2)), fish: false, species: [], score: c.score ?? null };
            if (!c.blank) {
                trip.fish = true;
                if (!trip.species.includes(c.species)) trip.species.push(c.species);
            }
            out.set(key, trip);
        }
    }
    if (pref.dip) {
        for (const f of state.floors) {
            const date = (f.at || '').slice(0, 10);
            if (!date || daysAgo(date) > 89) continue;
            out.set(`dip|${f.id}`, { kind: 'dip', date, lat: Number(f.lat.toFixed(3)), lon: Number(f.lon.toFixed(3)), tags: f.tags });
        }
    }
    return out;
}

const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, '0')).join('');

let running = null, again = false;
/** Sunucudaki paylasimlari cihazdaki duruma esitler: yeni ve degisenler gider, silinenler geri alinir. */
export function sync() {
    if (!offered() || !app.state) return Promise.resolve();
    if (running) { again = true; return running; }
    running = (async () => {
        const sent = read(SENT, {});
        const want = outgoing(app.state, choice());
        try {
            for (const [key, was] of Object.entries(sent)) {
                // Suresi dolan kayit cihaz listesinden duser; yalnizca kapatilan veya silinen geri alinir.
                const [kind, date] = key.split('|');
                const expired = kind === 'av' && choice().av && daysAgo(date) > 14;
                if (want.has(key)) continue;
                if (!expired) await post('/geri-al', { id: was.id, lat: was.lat, lon: was.lon });
                delete sent[key];
                write(SENT, sent);
            }
            for (const [key, data] of want) {
                const hash = JSON.stringify(data);
                if (sent[key]?.hash === hash) continue;
                const id = sent[key]?.id || newId();
                await post('/paylas', { ...data, id });
                sent[key] = { id, lat: data.lat, lon: data.lon, hash };
                write(SENT, sent);
            }
        } catch (err) { console.warn('Ortak kayıt gönderilemedi:', err.message); }
    })().finally(() => { running = null; if (again) { again = false; sync(); } });
    return running;
}

let timer = 0;
export function start() {
    window.addEventListener('kilcik:saved', () => { clearTimeout(timer); timer = setTimeout(sync, 1500); });
    window.addEventListener('online', sync);
    sync();
}

let latest = null;   // son okunan bolge ozeti
/** Cevredeki ortak ozet; bir saat cihazda tutulur. */
export async function summary(lat, lon) {
    if (!offered()) return null;
    const at = { lat: Math.round(lat * 20) / 20, lon: Math.round(lon * 20) / 20 };
    const key = `ortak:${at.lat},${at.lon}`;
    const cached = await cacheGet(key);
    if (cached && Date.now() - cached.at < 3600000) return (latest = cached.data);
    try {
        const data = await post('/ozet', at);
        await cacheSet(key, { at: Date.now(), data });
        return (latest = data);
    } catch { return (latest = cached?.data || null); }
}

export function summaryCard(data) {
    if (!data) return '';
    const body = data.trips
        ? `<p>${data.trips} avın <b>${data.fish}</b> tanesinde balık çıktı.</p>${data.species.length ? `<p>${data.species.map(([name, n]) => `${esc(name)} (${n})`).join(' · ')}</p>` : ''}`
        : '<p class="mute">Henüz paylaşılan av yok.</p>';
    return `<section class="card"><h2>Çevrede son ${data.days} gün</h2>${body}<p class="mute">Kullanıcıların isimsiz paylaşımı, yaklaşık 25 km. Doğrulanmamıştır.${choice().av ? '' : ' Siz de Günlük ekranından paylaşabilirsiniz.'}</p></section>`;
}

/** Baskalarinin bu noktaya yakin (~600 m) dip isaretleri. */
export function floorsNear(lat, lon) {
    const total = {};
    for (const c of latest?.floors || []) {
        if (Math.hypot(c.a - lat, (c.o - lon) * 0.76) > 0.0055) continue;
        for (const [tag, n] of Object.entries(c.t)) total[tag] = (total[tag] || 0) + n;
    }
    return Object.entries(total).sort((a, b) => b[1] - a[1]).map(([tag, n]) => `${FLOORS[tag]} (${n})`).join(', ');
}

export function shareCard() {
    if (!offered()) return '';
    const on = choice();
    return `<section class="card"><h2>Ortak kayıt (isteğe bağlı)</h2>
        <label class="check"><input type="checkbox" data-field="share-av" ${on.av ? 'checked' : ''}> Av sonuçlarımı isimsiz paylaş</label>
        <label class="check"><input type="checkbox" data-field="share-dip" ${on.dip ? 'checked' : ''}> Dip işaretlerimi isimsiz paylaş</label>
        <p class="mute">Gider: tarih, günün bölümü, çıkan türler, tahmin puanı ve yaklaşık 5 km hassasiyetle yer. Dip işaretinde yer yaklaşık 500 m hassasiyettedir. İsim, fotoğraf ve not gitmez. Kutuyu kapatınca paylaştıklarınız silinir.</p></section>`;
}

export function toggle(field) {
    const key = field === 'share-av' ? 'av' : field === 'share-dip' ? 'dip' : null;
    if (!key) return false;
    const on = { ...choice(), [key]: !choice()[key] };
    write(PREF, on);
    toast(on[key] ? 'Paylaşım açık. Teşekkürler.' : 'Paylaşım kapatıldı, gönderdikleriniz siliniyor.', 'ok');
    sync();
    return true;
}

export const feedbackCard = () => (offered() ? `<section class="card"><h2>Sorun bildir / öneri gönder</h2>
    <form data-form="feedback"><label>Ne oldu veya ne olsun?<textarea name="text" rows="3" maxlength="1500" required></textarea></label><button class="btn primary">Gönder</button></form>
    <p class="mute">Uygulamanın yöneticisine isimsiz gider. Cevap isterseniz adınızı yazın.</p></section>` : '');

export async function sendFeedback(form) {
    const text = form.elements.text.value.trim();
    if (text.length < 5) return toast('Biraz daha ayrıntı yazın.', 'bad');
    const button = form.querySelector('button');
    button.disabled = true;
    try {
        const device = /iphone|ipad|ipod/i.test(navigator.userAgent) ? 'iPhone' : /android/i.test(navigator.userAgent) ? 'Android' : 'Bilgisayar';
        await post('/geri', { text, version: `v${NOTES[0].v}`, device });
        form.reset();
        toast('Gönderildi. Teşekkürler.', 'ok');
    } catch (err) { toast(`Gönderilemedi: ${err.message}`, 'bad'); }
    button.disabled = false;
}
