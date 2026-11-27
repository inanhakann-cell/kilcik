// Ortak arayuz yardimcilari ve uygulama durumu.
export const app = { state: null, draft: null, pref: {}, go: () => {} };

export const $ = (sel, root = document) => root.querySelector(sel);
export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const uid = p => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
export const show = (v, unit = '') => (v === null || v === undefined ? '--' : `${v}${unit}`);
export const wind = kt => (kt === null || kt === undefined ? '--' : `${Math.round(kt * 1.852)} km/sa (${Math.round(kt)} kt)`);

// Windy'nin ruzgar renk tablosu: [m/s, kirmizi, yesil, mavi]. Aradaki hizlar iki basamak arasinda karistirilir.
const WINDY = [[0, 98, 113, 183], [1, 57, 97, 159], [3, 74, 148, 169], [5, 77, 141, 123], [7, 83, 165, 83], [9, 53, 159, 53],
    [11, 167, 157, 81], [13, 159, 127, 58], [15, 161, 108, 92], [17, 129, 58, 78], [19, 175, 80, 136], [21, 117, 74, 147],
    [24, 109, 97, 163], [27, 68, 105, 141], [29, 92, 144, 152], [36, 125, 68, 165], [46, 231, 215, 215], [51, 219, 212, 135],
    [77, 205, 202, 112], [104, 128, 128, 128]];
/** Knot cinsinden hizin Windy rengi: "rgb(r,g,b)" veya null. */
export function windColor(kt) {
    if (!Number.isFinite(kt)) return null;
    const speed = Math.max(0, kt * 0.514444);
    const next = WINDY.findIndex(step => step[0] > speed);
    if (next < 0) return `rgb(${WINDY[WINDY.length - 1].slice(1)})`;
    const a = WINDY[next - 1], b = WINDY[next], part = (speed - a[0]) / (b[0] - a[0]);
    return `rgb(${[1, 2, 3].map(n => Math.round(a[n] + (b[n] - a[n]) * part))})`;
}
/** Windy rengi zemin, ustunde okunur yazi (cok acik zeminde siyah). */
export function windPaint(kt) {
    const color = windColor(kt);
    if (!color) return '';
    const [r, g, b] = color.match(/\d+/g).map(Number);
    return `background:${color};color:${r * 0.299 + g * 0.587 + b * 0.114 > 165 ? '#000' : '#fff'}`;
}
/** "36 km/sa" yazisi, Windy rengiyle. */
export const toned = kt => `<span class="wchip" style="${windPaint(kt)}">${Number.isFinite(kt) ? `${Math.round(kt * 1.852)} km/sa` : '--'}</span>`;
export const options = (items, selected) => items.map(([v, label]) => `<option value="${esc(v)}"${String(v) === String(selected) ? ' selected' : ''}>${esc(label)}</option>`).join('');
export const chips = (act, items, selected) => `<div class="chips">${items.map(([v, label]) => `<button type="button" class="chip${v === selected ? ' on' : ''}" data-act="${act}" data-v="${esc(v)}" aria-pressed="${v === selected}">${esc(label)}</button>`).join('')}</div>`;
export const mapsUrl = (lat, lon) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
export const SAFETY = { go: ['Güvenlik: sorun görünmüyor', 'ok'], caution: ['Güvenlik: dikkat', 'warn'], nogo: ['Güvenlik: gitme', 'bad'], unknown: ['Güvenlik: bilinmiyor', 'mute'] };

/** Puanin soz karsiligi ve rengi. */
export const grade = s => (s === null || s === undefined || s < 0 ? ['--', 'mute'] : s >= 80 ? ['çok iyi', 'ok'] : s >= 65 ? ['iyi', 'ok'] : s >= 45 ? ['orta', 'warn'] : ['zayıf', 'mute']);
export const pill = s => { const [word, cls] = grade(s); return `<span class="pill ${cls}">${word}</span>`; };
/** Katlanir bolum; yeniden cizimde acik kalmasi icin opened() ile birlikte kullanilir. */
export const opened = root => new Set([...root.querySelectorAll('details[data-keep][open]')].map(d => d.dataset.keep));
export const fold = (key, title, body, open, cls = 'card fold') => `<details class="${cls}" data-keep="${esc(key)}"${open?.has(key) ? ' open' : ''}><summary>${title}</summary>${body}</details>`;
/** Meralar ekraninin ust secicisi. */
export const mapTabs = on => `<div class="seg">${[['harita', 'Harita'], ['kesif', 'Liste'], ['noktalar', 'Noktalarım']].map(([v, t]) => `<button type="button" class="chip${v === on ? ' on' : ''}" data-nav="${v}">${t}</button>`).join('')}</div>`;
export const WARNINGS_URL = 'https://www.mgm.gov.tr/meteouyari/turkiye.aspx';

export function toast(text, kind = '') {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = text;
    while ($('#toasts').childElementCount > 1) $('#toasts').firstElementChild.remove();
    $('#toasts').append(el);
    setTimeout(() => el.remove(), 3800);
}

export function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export async function copy(text, done) {
    try { await navigator.clipboard.writeText(text); toast(done, 'ok'); }
    catch {
        try { window.prompt('Metni kopyalayın:', text); } catch { toast(text); }
    }
}

export const locate = (options = {}) => new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Bu cihazda konum desteklenmiyor.'));
    navigator.geolocation.getCurrentPosition(
        p => resolve({ lat: Number(p.coords.latitude.toFixed(5)), lon: Number(p.coords.longitude.toFixed(5)), accuracy: Math.round(p.coords.accuracy) }),
        () => reject(new Error('Konum alınamadı. Konum iznini kontrol edin.')),
        { enableHighAccuracy: true, timeout: 12000, ...options });
});

export async function persist() {
    const { saveState } = await import('./store.js');
    try { await saveState(app.state); window.dispatchEvent(new Event('kilcik:saved')); } catch { toast('Cihaza kaydedilemedi (depolama dolu olabilir).', 'bad'); }
}
