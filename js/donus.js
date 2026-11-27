// Donus nobeti: "Dondum" denmezse eslesmis yakinin telefonuna bildirim sunucusu haber verir.
import * as push from './push.js';
import { esc, toast, copy, locate } from './ui.js';

const FOLLOW = 'yakin-kodum';   // bu cihaz uyari ALIR
const PAIR = 'yakin';           // uyari GONDERILECEK yakinin kodu ve benim adim
const TRIP = 'donus-nobeti';
const read = key => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } };
const write = (key, value) => localStorage.setItem(key, JSON.stringify(value));
const pretty = code => `${code.slice(0, 5)}-${code.slice(5)}`;
const clock = ms => new Date(ms).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
/** Acik nobet; donus saatinden bir gun sonra sunucudan da silinir. */
export const trip = () => { const t = read(TRIP); return t && Date.now() < t.until + 86400000 ? t : null; };

/** "SS:dd" icin siradaki zaman (gecmisse yarin). */
export function nextTime(time, now = Date.now()) {
    const [h, m] = time.split(':').map(Number);
    const at = new Date(now);
    at.setHours(h, m, 0, 0);
    return at.getTime() > now ? at.getTime() : at.setDate(at.getDate() + 1);
}

export function tripCard() {
    const t = trip();
    if (!t) return '';
    const late = Date.now() >= t.until;
    return `<section class="card nobetim${late ? ' gec' : ''}"><h2>${late ? '⚠ Dönüş saatiniz geçti' : 'Dönüş nöbeti açık'}</h2>
        <p>Dönüş saati <b>${clock(t.until)}</b>. “Döndüm”e basmazsanız <b>${clock(t.until + 30 * 60000)}</b> sonrasında yakınınıza haber gider.</p>
        ${t.pending ? '<p class="banner bad">“Döndüm” henüz gönderilemedi. İnternet gelince yeniden denenecek; gerekirse yakınınızı arayın.</p>' : ''}
        <button type="button" class="btn primary big" data-act="donusbitti">Döndüm</button>
        <button type="button" class="btn big" data-act="donusuzat">1 saat uzat</button></section>`;
}

/** Donus kutusunun otomatik haber bolumu (session.returnBox icinde). */
export function setup() {
    if (!push.offered() || trip()) return '';
    const pair = read(PAIR) || {};
    return `<h3>Dönmezsem haber ver</h3>
        <label>Adım (yakınıma böyle yazılır)<input name="donusad" maxlength="30" autocomplete="name" value="${esc(pair.name || '')}"></label>
        <label>Yakınımın kodu<input name="donuskod" maxlength="14" autocapitalize="characters" autocomplete="off" value="${pair.code ? pretty(pair.code) : ''}" placeholder="ABCDE-FGHJK"></label>
        <button type="button" class="btn primary big" data-act="donuskur">Dönmezsem haber ver</button>
        <p class="mute">Kodu yakınınız kendi telefonunda KILÇIK → ☰ Menü → “Yakınım için uyarı al” bölümünden alır. Dönüş saatinden 30–40 dakika sonra hâlâ “Döndüm” demediyseniz ona bildirim gider. Sunucu; adınızı, şu anki konumunuzu ve saati dönene kadar (en fazla bir gün) saklar. Bildirim gecikebilir veya ulaşmayabilir; tek güvenceniz olmasın.</p>`;
}

export async function start(box, place, refresh) {
    const time = box.querySelector('[name=donus]').value;
    const name = box.querySelector('[name=donusad]').value.trim();
    const code = box.querySelector('[name=donuskod]').value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!time) return toast('Dönüş saatini seçin.', 'bad');
    if (!name) return toast('Adınızı yazın.', 'bad');
    if (code.length !== 10) return toast('Yakınınızın 10 karakterlik kodunu yazın.', 'bad');
    // Hatirlatma icin bildirim izni istenir; verilmese de nobet kurulur.
    const sub = await push.subscription().catch(() => null);
    try {
        const here = place || await locate();
        const until = nextTime(time);
        const out = await push.post('/donus', { code, name, lat: here.lat, lon: here.lon, until, offset: -new Date(until).getTimezoneOffset() * 60, sub: sub?.toJSON() || null });
        write(PAIR, { code, name });
        write(TRIP, { id: out.id, until });
        toast(sub ? 'Nöbet açık. Yakınınıza “ava çıktı” bildirimi gitti.' : 'Nöbet açık. Bildirim izniniz olmadığı için size hatırlatma gelmeyecek.', sub ? 'ok' : 'bad');
        refresh();
    } catch (err) { toast(`Nöbet açılamadı: ${err.message}`, 'bad'); }
}

export async function finish(refresh) {
    const t = trip();
    if (!t) return;
    try {
        const out = await push.post('/donus-bitti', { id: t.id });
        localStorage.removeItem(TRIP);
        toast(out.told ? 'Nöbet kapandı. Yakınınıza haber verildi.' : 'Nöbet kapandı. Yakınınıza haber ulaşmadıysa siz bildirin.', out.told ? 'ok' : 'bad');
    } catch (err) {
        write(TRIP, { ...t, pending: true });
        toast('“Döndüm” gönderilemedi. İnternet gelince yeniden denenecek.', 'bad');
    }
    refresh?.();
}

export async function extend(refresh) {
    const t = trip();
    if (!t) return;
    try {
        const res = await push.post('/donus-uzat', { id: t.id });
        write(TRIP, { id: t.id, until: res.until });
        toast(`Yeni dönüş saati ${clock(res.until)}. Yakınınıza bildirildi.`, 'ok');
    } catch (err) { toast(`Uzatılamadı: ${err.message}`, 'bad'); }
    refresh();
}

/** Gonderilemeyen "Dondum" internet gelince veya uygulama acilinca yeniden denenir. */
export function retry(refresh) {
    if (trip()?.pending && navigator.onLine) finish(refresh);
}

// Uyari alacak kisinin karti (Menu).
export function followCard() {
    if (!push.offered()) return '';
    const mine = read(FOLLOW);
    return `<section class="card" id="yakin"><h2>Yakınım için uyarı al</h2>
        <p>Balığa giden yakınınız dönüş saatinde “Döndüm” demezse telefonunuza bildirim gelir.</p>
        ${mine ? `<p>Kodunuz</p><p class="kod">${pretty(mine.code)}</p><p class="mute">Bu kodu yalnızca takip edeceğiniz kişiye verin. Bildirimlerin sesi açık olsun.</p>
        <div class="row wrap"><button type="button" class="btn primary" data-act="yakingonder">Kodu gönder</button><button type="button" class="btn" data-act="yakinsil">Uyarı almayı bırak</button></div>`
        : `<button type="button" class="btn big" data-act="yakinal">Kod oluştur</button><p class="mute">Bildirim izni istenir (iPhone’da uygulama ana ekrana ekli olmalı). Sunucu yalnızca bildirim adresinizi saklar.</p>`}</section>`;
}

const repaint = root => { const box = root.querySelector('#yakin'); if (box) box.outerHTML = followCard(); };

/** Kod olusturur; kayitli kodu varsa sunucudaki suresini yeniler. */
async function register() {
    const sub = await push.subscription();
    const out = await push.post('/yakin', { sub: sub.toJSON(), code: read(FOLLOW)?.code || '' });
    write(FOLLOW, { code: out.code, at: Date.now() });
}

export function renew() {
    const mine = read(FOLLOW);
    if (mine && push.offered() && window.Notification?.permission === 'granted' && Date.now() - mine.at > 7 * 86400000) register().catch(() => {});
}

export const forgetFollow = () => localStorage.removeItem(FOLLOW);

export const followActions = {
    yakinal: async (v, root) => {
        try { await register(); toast('Kod hazır. Yakınınıza gönderin.', 'ok'); }
        catch (err) { toast(`Kod oluşturulamadı: ${err.message}`, 'bad'); }
        repaint(root);
    },
    yakingonder: () => {
        const text = `KILÇIK dönüş nöbeti kodum: ${pretty(read(FOLLOW).code)}\nAva çıkarken “Yakınıma dönüş saatimi gönder” bölümündeki “Yakınımın kodu” kutusuna yaz.`;
        return navigator.share ? navigator.share({ text }).catch(() => {}) : copy(text, 'Kod kopyalandı.');
    },
    yakinsil: async (v, root) => {
        try {
            const sub = await push.current();
            if (sub) await push.post('/yakin-sil', { code: read(FOLLOW).code, endpoint: sub.endpoint });
            forgetFollow();
            toast('Uyarı almayacaksınız.', 'ok');
        } catch (err) { toast(`Kapatılamadı: ${err.message}`, 'bad'); }
        repaint(root);
    }
};
