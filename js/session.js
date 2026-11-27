// Tek dokunusla av oturumu: baslat, balik ekle, bitir. Balik cikmazsa bos seans kaydedilir.
import * as C from './core.js';
import * as donus from './donus.js';
import * as api from './api.js';
import { contextFor, solunarFor, moonFor } from './planner.js';
import { SPECIES } from './species.js';
import { catchWarnings } from './legal.js';
import { cacheGet, cacheSet } from './store.js';
import { app, esc, uid, toast, copy, locate, persist } from './ui.js';

let current = null;
let loaded = false;
const KEY = 'session';
const localNow = (ms = Date.now()) => new Date(ms).toLocaleString('sv-SE').slice(0, 16).replace(' ', 'T');

/** O saatin etken degerleri; tahmin bunlardan ogrenir. */
export async function hourFactors(lat, lon, at) {
    const date = at.slice(0, 10);
    const pack = await api.dayPack(lat, lon, date);
    const i = pack.rows.findIndex(r => r.time.slice(0, 13) === at.slice(0, 13));
    if (i < 0) return null;
    const shore = await api.shoreInfo(lat, lon).catch(() => null);
    const ctx = { ...contextFor({ lat, lon, water: 'tuzlu', technique: 'spin' }, shore?.bearing ?? null), history: [], weights: {} };
    ctx.solunar = solunarFor(pack, ctx, date);
    ctx.moon = moonFor(pack, date);
    const row = pack.rows[i];
    const scored = C.scoreHour(pack, i, ctx);
    return {
        score: scored.score,
        factors: C.factorRatios(scored.factors),
        conditions: [row.wind !== null ? `${C.kmh(row.wind)} ${C.dirCode(row.dir)}` : '', row.pressure !== null ? `${row.pressure} hPa` : '', row.air !== null ? `hava ${row.air}°C` : '', row.sea !== null ? `su ${row.sea}°C` : '', row.wave !== null && !row.waveEstimated ? `dalga ${row.wave} m` : ''].filter(Boolean).join(', ')
    };
}

/** Merada internet yokken kaydedilenlerin hava verisini sonradan tamamlar. */
export async function backfill() {
    if (!navigator.onLine) return;
    const missing = app.state.catches.filter(c => (!c.factors || c.score == null) && c.lat !== null && c.at && Date.now() - Date.parse(c.at) < 60 * 86400000).slice(-10);
    let changed = false;
    for (const c of missing) {
        const info = await hourFactors(c.lat, c.lon, c.at).catch(() => null);
        if (!info) continue;
        c.factors = info.factors;
        c.score = info.score;
        c.conditions ||= info.conditions;
        changed = true;
    }
    if (changed) await persist();
}

async function record(fields, at) {
    const [entry] = C.sanitizeState({ catches: [{ id: uid('av'), at, spot: current.spot, lat: current.lat, lon: current.lon, ...fields }] }).catches;
    if (!entry) return false;
    app.state.catches.push(entry);
    await persist();
    backfill().catch(() => {});
    return true;
}

/** Yakina gonderilecek "su saatte donerim" metni. */
export function returnText(place, time, now = new Date()) {
    const tomorrow = time <= now.toTimeString().slice(0, 5);
    return `Kıyıda balık avındayım. Dönüş saatim: ${tomorrow ? 'yarın ' : ''}${time}.\nKonumum: https://www.google.com/maps/search/?api=1&query=${place.lat.toFixed(5)},${place.lon.toFixed(5)}\nO saatten sonra benden haber alamazsan beni ara.`;
}

export const returnBox = () => (donus.trip() ? '' : `<details class="donus"><summary>Yakınıma dönüş saatimi gönder</summary>
    <label>Dönüş saatim<input type="time" name="donus" value="${new Date(Date.now() + 3 * 3600000).toTimeString().slice(0, 2)}:00" required></label>
    <button type="button" class="btn big" data-act="sesshare">Konumumla gönder</button>
    <p class="mute">Telefonun paylaşma ekranı açılır; kişiyi siz seçip gönderirsiniz. Bu mesaj dönmediğinizde kendiliğinden haber vermez.</p>${donus.setup()}</details>`);

// Konum beklenirken telefon paylasma iznini dusurebilir; hazir mesaj ikinci dokunusta gonderilir.
let ready = null;
async function shareReturn() {
    const box = document.querySelector('.view:not([hidden]) .donus');
    const time = box?.querySelector('[name=donus]').value;
    if (!time) return toast('Dönüş saatini seçin.', 'bad');
    let text = ready && ready.time === time && Date.now() - ready.at < 120000 ? ready.text : '';
    if (!text) {
        try { text = returnText(current || await locate(), time); }
        catch (err) { return toast(err.message, 'bad'); }
    }
    if (!navigator.share) return copy(text, 'Mesaj kopyalandı. Yakınınıza yapıştırıp gönderin.');
    try { await navigator.share({ text }); ready = null; }
    catch (err) {
        if (err.name === 'AbortError') return;
        if (err.name !== 'NotAllowedError') return copy(text, 'Mesaj kopyalandı. Yakınınıza yapıştırıp gönderin.');
        ready = { text, time, at: Date.now() };
        box.querySelector('[data-act=sesshare]').textContent = 'Konum hazır: şimdi gönder';
    }
}

export function card() {
    if (!loaded) return '';
    const learn = C.calibrate(app.state.catches);
    const progress = learn.ready ? 'Tahmin ağırlıkları kayıtlarınıza göre ayarlanıyor.' : `Tahminin öğrenmesi için: avlı ${Math.min(learn.good, learn.min)}/${learn.min}, boş ${Math.min(learn.blank, learn.min)}/${learn.min}.`;
    if (!current) {
        return `<section class="card session"><button class="btn primary big" data-act="sesstart">● Ava başladım</button><p class="mute">Konum ve saat otomatik kaydedilir. ${progress}</p>${returnBox()}</section>`;
    }
    const minutes = Math.max(0, Math.round((Date.now() - current.start) / 60000));
    return `<section class="card session on"><h2>● Av sürüyor · ${Math.floor(minutes / 60)} sa ${minutes % 60} dk</h2>
        <p class="mute">${esc(current.spot || `${current.lat.toFixed(4)}, ${current.lon.toFixed(4)}`)} · ${current.fish} balık kaydı</p>
        <form data-form="session"><div class="grid2"><label>Tür<input name="species" list="ses-species" required maxlength="80"></label><label>Boy (cm)<input type="number" name="size" min="0" step="0.5"></label></div>
        <label>Yem / sahte<input name="lure" maxlength="120"></label><label class="check"><input type="checkbox" name="released"> Geri bıraktım</label><button class="btn primary big">Balık tuttum</button></form>
        <datalist id="ses-species">${SPECIES.map(s => `<option value="${esc(s.ad)}">`).join('')}</datalist>
        <div class="row wrap"><button class="btn" data-act="sesend">Avı bitir</button><button class="btn danger" data-act="sescancel">Vazgeç</button></div>${returnBox()}</section>`;
}

export const active = () => Boolean(current);

export async function init() {
    current = (await cacheGet(KEY)) || null;
    loaded = true;
}
const store = async value => { current = value; await cacheSet(KEY, value); };

export const actions = refresh => ({
    sesshare: shareReturn,
    donuskur: () => donus.start(document.querySelector('.view:not([hidden]) .donus'), current, refresh),
    donusbitti: () => donus.finish(refresh),
    donusuzat: () => donus.extend(refresh),
    sesstart: async () => {
        let place;
        try {
            const p = await locate();
            const near = app.state.spots.find(s => Math.hypot(s.lat - p.lat, (s.lon - p.lon) * 0.76) < 0.003);
            place = { lat: p.lat, lon: p.lon, spot: near?.name || '' };
        } catch (err) {
            const d = app.draft;
            if (d.lat === null || !window.confirm(`${err.message} Seçili plan noktası (${d.name || `${d.lat}, ${d.lon}`}) ile başlansın mı?`)) return toast(err.message, 'bad');
            place = { lat: d.lat, lon: d.lon, spot: d.name };
        }
        await store({ ...place, start: Date.now(), fish: 0 });
        toast('Av başladı. Rastgele!', 'ok');
        refresh();
        document.querySelector('.view:not([hidden]) .session.on')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    },
    sesend: async () => {
        const minutes = Math.round((Date.now() - current.start) / 60000);
        if (!current.fish) {
            // Cok kisa ve bos oturum yanlislikla baslatilmis olabilir.
            const keep = window.confirm(`${minutes} dakikalık avda balık kaydı yok. “Av çıkmadı” olarak kaydedilsin mi?\n(İptal: hiç kaydetme)`);
            // Sinanan saat avin ortasidir.
            if (keep) await record({ species: 'Av çıkmadı', blank: true, note: `${minutes} dk` }, localNow((current.start + Date.now()) / 2));
        }
        await store(null);
        toast('Av bitirildi.', 'ok');
        refresh();
    },
    sescancel: async () => {
        if (!window.confirm('Oturum iptal edilsin mi? Kaydedilen balıklar silinmez.')) return;
        await store(null);
        refresh();
    }
});

export async function submit(form, refresh) {
    if (!current) return;
    const f = form.elements;
    const species = f.species.value.trim();
    if (!species) return;
    const size = Number(f.size.value) || null;
    const at = localNow();
    const warnings = catchWarnings(species, f.released.checked ? null : size, at);
    if (warnings.length && !window.confirm(`${warnings.join('\n')}\n\nYine de kaydedilsin mi?`)) return;
    if (!(await record({ species, length: size, lure: f.lure.value.trim(), released: f.released.checked }, at))) return;
    await store({ ...current, fish: current.fish + 1 });
    toast(`${species} kaydedildi.`, 'ok');
    refresh();
}
