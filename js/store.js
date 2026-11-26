// Cihazda kalici kayit (IndexedDB). Sunucu yok; veriler bu cihazdan cikmaz.
import { sanitizeState, mergeState, fromLegacy } from './core.js';

const open = () => new Promise((resolve, reject) => {
    const req = indexedDB.open('kilcik', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
});
let dbPromise;
async function run(mode, fn) {
    const db = await (dbPromise ||= open());
    return new Promise((resolve, reject) => {
        const tx = db.transaction('kv', mode);
        const req = fn(tx.objectStore('kv'));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = tx.onabort = () => reject(tx.error);
    });
}
const get = key => run('readonly', s => s.get(key));
const set = (key, value) => run('readwrite', s => s.put(value, key));

export const cacheGet = key => get(key).catch(() => undefined);
export const cacheSet = (key, value) => set(key, value).catch(() => {});

export const saveState = state => set('state', state);

export async function loadState() {
    const saved = await get('state');
    if (saved) return sanitizeState(saved);
    // Ilk acilis: onceki surumun kayitlarini tasi (silmeden).
    const read = k => { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch { return []; } };
    const state = mergeState(sanitizeState({}), fromLegacy({ customSpots: read('kilcik_v6_custom_spots'), logbook: read('kilcik_v6_logbook') }));
    await saveState(state);
    return state;
}
