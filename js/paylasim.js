// Haritada paylasim: yalnizca "Paylas" secilen avlar gider; secim kalkinca veya av silinince geri alinir.
import { offered } from './ortak.js';
import { post } from './push.js';
import { SPECIES } from './species.js';
import { app, toast } from './ui.js';

const SENT = 'acik-giden';     // { shareId: { hash, lat, lon, date, pid } }
const NAME = 'acik-ad';
export const KEEP_DAYS = 400;
export const MODES = [['', 'Paylaşma'], ['yakin', 'Yaklaşık yeri paylaş (1 km)'], ['tam', 'Tam yeri paylaş']];
const read = (key, empty) => { try { return JSON.parse(localStorage.getItem(key)) || empty; } catch { return empty; } };
export const myName = () => localStorage.getItem(NAME) || '';
export const setName = name => localStorage.setItem(NAME, name.trim().slice(0, 20));
export const shareable = species => SPECIES.some(s => s.ad === species);
export const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, '0')).join('');
const age = date => (Date.now() - Date.parse(date)) / 86400000;
const partOf = hour => (hour < 5 || hour >= 21 ? 'gece' : hour < 11 ? 'sabah' : hour < 16 ? 'öğle' : 'akşam');

/** Sunucuda bulunmasi gereken paylasimlar. Yaklasik secildiyse tam konum telefondan hic cikmaz. */
export function outgoing(catches, name) {
    const out = new Map();
    for (const c of catches) {
        if (!c.share || !c.shareId || c.blank || c.lat === null || !c.at || !shareable(c.species) || age(c.at.slice(0, 10)) >= KEEP_DAYS) continue;
        const round = v => Number(v.toFixed(c.share === 'yakin' ? 2 : 5));
        out.set(c.shareId, {
            id: c.shareId, mode: c.share, date: c.at.slice(0, 10), part: partOf(Number(c.at.slice(11, 13))), species: c.species,
            length: c.length || null, name, lat: round(c.lat), lon: round(c.lon)
        });
    }
    return out;
}

const errors = new Map();
/** Gunluk kartindaki durum satiri. */
export function status(c) {
    if (!c.share || !offered()) return '';
    const how = c.share === 'tam' ? 'tam yer' : 'yaklaşık yer';
    if (errors.has(c.shareId)) return `Paylaşılamadı (${errors.get(c.shareId)}); yeniden denenecek.`;
    return read(SENT, {})[c.shareId] ? `Haritada paylaşılıyor · ${how}` : `Paylaşım bekliyor · ${how}`;
}
export const ownPids = () => new Set(Object.values(read(SENT, {})).map(s => s.pid));

let running = null, again = false;
export function sync() {
    if (!offered() || !app.state) return Promise.resolve();
    if (running) { again = true; return running; }
    running = (async () => {
        const sent = read(SENT, {});
        const want = outgoing(app.state.catches, myName());
        const save = () => localStorage.setItem(SENT, JSON.stringify(sent));
        for (const [id, was] of Object.entries(sent)) {
            const next = want.get(id);
            if (next && next.lat === was.lat && next.lon === was.lon) continue;
            // Suresi dolan kayit sunucuda zaten silinmistir.
            if (!next && age(was.date) >= KEEP_DAYS) { delete sent[id]; save(); continue; }
            try {
                await post('/av-geri', { id, lat: was.lat, lon: was.lon });
                delete sent[id];
                save();
                if (!next) toast('Paylaşımınız haritadan kaldırıldı.', 'ok');
            } catch (err) { console.warn('Paylaşım geri alınamadı:', err.message); }
        }
        for (const [id, data] of want) {
            const hash = JSON.stringify(data);
            const was = sent[id];
            // Eski yeri henuz silinemeyen kayit sonraki turda gonderilir.
            if (was?.hash === hash || (was && (was.lat !== data.lat || was.lon !== data.lon))) continue;
            try {
                const out = await post('/av-paylas', data);
                sent[id] = { hash, lat: data.lat, lon: data.lon, date: data.date, pid: out.pid };
                errors.delete(id);
                save();
                if (!was) toast('Av haritada paylaşıldı.', 'ok');
            } catch (err) {
                errors.set(id, err.message);
                toast('Av şimdi paylaşılamadı; internet gelince yeniden denenecek.', 'bad');
                break;
            }
        }
    })().finally(() => { running = null; window.dispatchEvent(new Event('kilcik:shared')); if (again) { again = false; sync(); } });
    return running;
}

let timer = 0;
export function start() {
    window.addEventListener('kilcik:saved', () => { clearTimeout(timer); timer = setTimeout(sync, 800); });
    window.addEventListener('online', sync);
    sync();
}
