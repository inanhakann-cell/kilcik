// Ortak arayuz yardimcilari ve uygulama durumu.
export const app = { state: null, draft: null, go: () => {} };

export const $ = (sel, root = document) => root.querySelector(sel);
export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const uid = p => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
export const show = (v, unit = '') => (v === null || v === undefined ? '--' : `${v}${unit}`);
export const wind = kt => (kt === null || kt === undefined ? '--' : `${Math.round(kt * 1.852)} km/s (${Math.round(kt)} kt)`);
export const options = (items, selected) => items.map(([v, label]) => `<option value="${esc(v)}"${String(v) === String(selected) ? ' selected' : ''}>${esc(label)}</option>`).join('');
export const chips = (act, items, selected) => `<div class="chips">${items.map(([v, label]) => `<button type="button" class="chip${v === selected ? ' on' : ''}" data-act="${act}" data-v="${esc(v)}" aria-pressed="${v === selected}">${esc(label)}</button>`).join('')}</div>`;
export const mapsUrl = (lat, lon) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
export const SAFETY = { go: ['Güvenlik: sorun görünmüyor', 'ok'], caution: ['Güvenlik: dikkat', 'warn'], nogo: ['Güvenlik: gitme', 'bad'], unknown: ['Güvenlik: bilinmiyor', 'mute'] };

export function toast(text, kind = '') {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = text;
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

export const locate = () => new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Bu cihazda konum desteklenmiyor.'));
    navigator.geolocation.getCurrentPosition(
        p => resolve({ lat: Number(p.coords.latitude.toFixed(5)), lon: Number(p.coords.longitude.toFixed(5)), accuracy: Math.round(p.coords.accuracy) }),
        () => reject(new Error('Konum alınamadı. Konum iznini kontrol edin.')),
        { enableHighAccuracy: true, timeout: 12000 });
});

export async function persist() {
    const { saveState } = await import('./store.js');
    try { await saveState(app.state); } catch { toast('Cihaza kaydedilemedi (depolama dolu olabilir).', 'bad'); }
}
