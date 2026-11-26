// Nokta gonderme, dip isaretleme, yedek hatirlatmasi ve gorunum tercihi.
import * as C from './core.js';
import { app, esc, uid, toast, copy, persist, download } from './ui.js';

const PUBLIC = 'https://inanhakann-cell.github.io/kilcik/';

// ---- Nokta gonderme ----
export const shareButton = (lat, lon, name) => `<button type="button" class="btn" data-share="${lat},${lon}" data-name="${esc(name)}">Arkadaşıma gönder</button>`;

export async function share(lat, lon, name) {
    // Koordinat "#" sonrasinda durur: sayfayi sunan sunucuya gitmez.
    const url = `${PUBLIC}#nokta=${lat},${lon},${encodeURIComponent(name)}`;
    const text = `KILÇIK noktası: ${name}`;
    if (navigator.share) return navigator.share({ title: 'KILÇIK', text, url }).catch(() => {});
    copy(`${text}\n${url}`, 'Bağlantı kopyalandı; mesajla gönderin.');
}

/** Baglantidaki noktayi onay alarak kaydeder. Metinde nokta yoksa false doner. */
export async function receive(text) {
    const spot = C.parseShared(text);
    if (!spot) return false;
    const have = app.state.spots.find(s => Math.abs(s.lat - spot.lat) < 0.0002 && Math.abs(s.lon - spot.lon) < 0.0002);
    if (!have) {
        if (!window.confirm(`Size bir nokta gönderildi:\n${spot.name}\n${spot.lat}, ${spot.lon}\n\nNoktalarınıza eklensin mi?`)) return true;
        app.state.spots.push({ id: uid('spot'), ...spot, water: 'tuzlu', note: 'Bağlantıyla alındı. Ulaşımı ve avın serbest olduğunu yerinde kontrol edin.' });
        await persist();
    }
    toast(have ? 'Bu nokta zaten kayıtlı.' : 'Nokta eklendi.', 'ok');
    app.go('harita', { focus: have || spot });
    return true;
}

export async function receiveFromAddress() {
    if (!location.hash.startsWith('#nokta=')) return false;
    const hash = location.hash;
    history.replaceState(history.state, '', location.pathname + location.search);
    return receive(hash);
}

// ---- Dip isaretleme ----
const near = (lat, lon) => app.state.floors.find(f => Math.hypot(f.lat - lat, (f.lon - lon) * 0.76) < 0.0014);
export const floorText = (lat, lon) => near(lat, lon)?.tags.map(t => C.FLOORS[t]).join(', ') || '';
const floorButtons = (lat, lon) => Object.entries(C.FLOORS).map(([key, label]) => {
    const on = near(lat, lon)?.tags.includes(key);
    return `<button type="button" class="chip${on ? ' on' : ''}" data-floor="${key}" data-at="${lat},${lon}" aria-pressed="${Boolean(on)}">${label}</button>`;
}).join('');
export const floorChips = (lat, lon) => `<div class="floors"><p class="mute">Dip nasıl? Gördüğünüzü işaretleyin (yalnızca sizde saklanır).</p><div class="chips">${floorButtons(lat, lon)}</div></div>`;

export async function toggleFloor(button) {
    const [lat, lon] = button.dataset.at.split(',').map(Number);
    const key = button.dataset.floor;
    let mark = near(lat, lon);
    if (!mark) app.state.floors.push(mark = { id: uid('dip'), lat, lon, tags: [], at: '' });
    mark.tags = mark.tags.includes(key) ? mark.tags.filter(t => t !== key) : [...mark.tags, key];
    mark.at = new Date().toISOString().slice(0, 16);
    if (!mark.tags.length) app.state.floors = app.state.floors.filter(f => f !== mark);
    // Sayfa yeniden cizilmez; acik bolumler yerinde kalir.
    button.parentElement.innerHTML = floorButtons(lat, lon);
    await persist();
}

// ---- Yedek ----
const LATER = 14 * 86400000;
export function downloadBackup() {
    localStorage.setItem('yedek', String(Date.now()));
    download(`kilcik-yedek-${new Date().toLocaleDateString('sv-SE')}.json`, JSON.stringify({ app: 'KILCIK', ...app.state }), 'application/json');
}

export function backupCard() {
    const count = app.state.catches.length + app.state.spots.length;
    if (count < 3 || Date.now() - Number(localStorage.getItem('yedek') || 0) < LATER) return '';
    return `<section class="card"><h2>Kayıtlarınızı yedekleyin</h2><p class="mute">${count} kayıt yalnızca bu cihazda duruyor. Telefon değişir veya uygulama silinirse kaybolur.</p><div class="row wrap"><button type="button" class="btn primary" data-backup="indir">Yedek indir</button><button type="button" class="btn" data-backup="sonra">İki hafta sonra hatırlat</button></div></section>`;
}

export async function backup(button) {
    if (button.dataset.backup === 'indir') downloadBackup();
    else localStorage.setItem('yedek', String(Date.now()));
}

// ---- Gorunum ----
export const look = () => ({ theme: localStorage.getItem('theme') || 'koyu', text: localStorage.getItem('text') || 'normal' });
export function applyLook() {
    const { theme, text } = look();
    document.documentElement.dataset.theme = theme === 'acik' ? 'light' : 'dark';
    document.documentElement.dataset.text = text === 'buyuk' ? 'big' : 'normal';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'acik' ? '#eef4f6' : '#06131a');
}
export function setLook(key, value) {
    localStorage.setItem(key, value);
    applyLook();
}
applyLook();
