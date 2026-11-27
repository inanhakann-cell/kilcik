// Av arsivi: kendi avlari tur, ay ve yila gore suzulur; baskalarinin acik paylasimlari ayni haritada gorulur.
import * as C from '../core.js';
import * as guide from '../guide.js';
import * as paylasim from '../paylasim.js';
import { offered } from '../ortak.js';
import { post } from '../push.js';
import { nearLine } from '../places.js';
import { cacheGet, cacheSet } from '../store.js';
import { app, esc, chips, options, toast } from '../ui.js';

const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const HIDDEN = 'acik-gizli';
const hidden = () => { try { return JSON.parse(localStorage.getItem(HIDDEN)) || []; } catch { return []; } };
let tab = 'benim';
const filter = { species: '', month: '', year: '' };
let shared = null;       // { at, list, range, time }
let loading = false;
let map = null, host = null, marks = null;
let shown = [];          // listedeki kayitlar (harita ile ayni sira)

const day = date => new Date(`${date.slice(0, 10)}T12:00`).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });

/** Onceki yillarda bu hafta tutulanlar; yoksa bos. */
export function memoryCard() {
    const list = C.anniversaries(app.state.catches).slice(0, 3);
    if (!list.length) return '';
    return `<section class="card memory"><h2>Geçen yıllarda bu hafta</h2>${list.map(c => `<p><b>${esc(c.species)}</b> · ${esc(day(c.at))}${c.spot ? ` · ${esc(c.spot)}` : ''}${c.lat === null ? '' : ` <button type="button" class="btn" data-guide="${c.lat},${c.lon}" data-name="${esc(c.spot || c.species)}">Götür</button>`}</p>`).join('')}
        <button type="button" class="btn" data-nav="arsiv">Av arşivim</button></section>`;
}

/** Ekrandaki kaynaktan ortak bicimde kayitlar. */
function records() {
    if (tab === 'benim') {
        return app.state.catches.filter(c => !c.blank && c.at).map(c => ({
            species: c.species, date: c.at, lat: c.lat, lon: c.lon, count: c.count,
            line: [c.at.slice(11, 16), c.spot, c.length ? `${c.length} cm` : '', c.weight ? `${c.weight} kg` : '', c.lure, c.conditions].filter(Boolean).join(' · '), photo: c.photo
        }));
    }
    const off = new Set(hidden()), own = paylasim.ownPids();
    return (shared?.list || []).filter(r => !off.has(r.p)).map(r => ({
        species: r.s, date: r.d, lat: r.a, lon: r.o, count: 1, pid: r.p, mine: own.has(r.p), approx: r.y,
        line: [r.g, r.l ? `${r.l} cm` : '', r.y ? 'yaklaşık yer' : 'tam yer', r.n ? `paylaşan: ${r.n}` : ''].filter(Boolean).join(' · ')
    }));
}

function popup(r) {
    const box = document.createElement('div');
    box.className = 'popup';
    box.innerHTML = `<b>${esc(r.species)}</b><br>${esc(day(r.date))}<br><small>${esc(r.line)}</small><button type="button" class="btn primary">Beni oraya götür</button>`;
    box.querySelector('button').addEventListener('click', () => guide.open(r.lat, r.lon, r.species));
    return box;
}

function drawMap(slot, fit) {
    const L = window.L;
    if (!map) {
        host = document.createElement('div');
        host.id = 'arsiv-map';
        slot.append(host);
        map = L.map(host).setView([40.2, 26.8], 7);
        const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
        const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 18, attribution: 'Uydu © Esri' });
        L.control.layers({ Harita: osm, Uydu: sat }).addTo(map);
        marks = L.layerGroup().addTo(map);
    } else slot.append(host);
    marks.clearLayers();
    const points = [];
    shown.forEach(r => {
        r.mark = null;
        if (r.lat === null) return;
        points.push([r.lat, r.lon]);
        r.mark = L.circleMarker([r.lat, r.lon], { radius: r.approx ? 11 : 7, color: '#fff', weight: 2, fillColor: tab === 'benim' || r.mine ? '#f43f5e' : '#14b8a6', fillOpacity: r.approx ? 0.55 : 0.95 }).bindPopup(popup(r), { minWidth: 170 }).addTo(marks);
    });
    setTimeout(() => {
        map.invalidateSize();
        if (fit && points.length) map.fitBounds(points, { maxZoom: 13, padding: [24, 24] });
    }, 60);
}

function list() {
    if (!shown.length) {
        const why = tab === 'benim' ? (app.state.catches.some(c => !c.blank) ? 'Bu seçime uyan av yok.' : 'Henüz av kaydınız yok. Günlük ekranından “Balık tuttum” ile ekleyin.')
            : loading ? 'Yükleniyor…' : !shared ? 'Paylaşımlar alınamadı. İnternet bağlantısını kontrol edin.' : 'Bu bölgede bu seçime uyan paylaşım yok.';
        return `<p class="mute">${why}</p>`;
    }
    let month = '';
    return shown.slice(0, 100).map((r, n) => {
        const head = r.date.slice(0, 7) === month ? '' : `<h3>${MONTHS[Number(r.date.slice(5, 7)) - 1]} ${r.date.slice(0, 4)}</h3>`;
        month = r.date.slice(0, 7);
        return `${head}<section class="card">${r.photo ? `<img class="photo" src="${r.photo}" alt="${esc(r.species)}">` : ''}<div class="row between"><b>${esc(r.species)}${r.count > 1 ? ` ×${r.count}` : ''}</b><span class="mute">${esc(day(r.date))}</span></div>
            <p class="mute">${esc(r.line)}${r.mine ? ' · <b>sizin paylaşımınız</b>' : ''}</p>${r.lat === null ? '' : `${nearLine(r.lat, r.lon)}<div class="row wrap"><button type="button" class="btn" data-act="show" data-v="${n}">Haritada gör</button>
            <button type="button" class="btn" data-guide="${r.lat},${r.lon}" data-name="${esc(r.species)}">Beni götür</button>${r.pid && !r.mine ? `<button type="button" class="btn danger" data-act="report" data-v="${n}">Bildir</button>` : ''}</div>`}</section>`;
    }).join('') + (shown.length > 100 ? `<p class="mute">İlk 100 kayıt listelendi; süzgeçle daraltın. Haritada hepsi görünür.</p>` : '');
}

function draw(root, fit = true) {
    const all = records();
    const years = [...new Set(all.map(r => r.date.slice(0, 4)))].sort().reverse();
    const species = [...new Set([...all.map(r => r.species), filter.species].filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr'));
    shown = C.filterCatches(all, filter, r => r.date).sort((a, b) => b.date.localeCompare(a.date));
    const fish = shown.reduce((a, r) => a + r.count, 0);
    root.innerHTML = `<h2>Av arşivi</h2>
        ${offered() ? chips('arsivtab', [['benim', 'Benim avlarım'], ['paylasilan', 'Paylaşılanlar']], tab) : ''}
        <div class="grid3"><label>Tür<select data-field="species">${options([['', 'Hepsi'], ...species.map(s => [s, s])], filter.species)}</select></label>
        <label>Ay<select data-field="month">${options([['', 'Hepsi'], ...MONTHS.map((m, i) => [String(i + 1).padStart(2, '0'), m])], filter.month)}</select></label>
        <label>Yıl<select data-field="year">${options([['', 'Hepsi'], ...[...new Set([...years, filter.year].filter(Boolean))].map(y => [y, y])], filter.year)}</select></label></div>
        <p><b>${shown.length}</b> kayıt · ${fish} balık${tab === 'paylasilan' && shared ? ` · seçilen bölgenin ${shared.range} km çevresi` : ''}</p>
        <div id="arsiv-slot"></div>
        ${tab === 'paylasilan' ? `<div class="row wrap"><button type="button" class="btn primary" data-act="search" ${loading ? 'disabled' : ''}>${loading ? 'Yükleniyor…' : 'Haritanın ortasını ara'}</button></div>
        <p class="mute">Kullanıcıların kendi seçimiyle paylaştığı avlardır; doğrulanmamıştır. Av yasaklarına ve boy sınırlarına uyun. Kendi avınızı Günlük’te kaydı düzenleyip “Haritada paylaş” bölümünden paylaşırsınız.</p>` : '<p class="mute">Bu kayıtlar yalnızca telefonunuzda durur. Kaybolmaması için Günlük ekranından yedek alın.</p>'}
        <div id="arsiv-list">${list()}</div>`;
    drawMap(root.querySelector('#arsiv-slot'), fit);
}

async function load(root, at, fit) {
    loading = true;
    draw(root, false);
    try {
        const out = await post('/av-liste', at);
        shared = { at, list: out.list, range: out.range };
        await cacheSet('acik-liste', shared);
    } catch (err) {
        shared = (await cacheGet('acik-liste')) || null;
        toast(shared ? 'Yeni paylaşımlar alınamadı; son indirilenler gösteriliyor.' : `Paylaşımlar alınamadı: ${err.message}`, 'bad');
    }
    loading = false;
    if (!root.hidden && tab === 'paylasilan') {
        draw(root, fit);
        if (fit && !shown.some(r => r.lat !== null)) setTimeout(() => map.setView([at.lat, at.lon], 10), 80);
    }
}

async function home() {
    const area = (await cacheGet('area')) || app.state.spots[0] || { lat: 40.4, lon: 27.3 };
    return { lat: area.lat, lon: area.lon };
}

export function render(root) {
    if (!offered()) tab = 'benim';
    draw(root);
    if (tab === 'paylasilan') home().then(at => load(root, shared?.at || at, true));
}

export const actions = {
    arsivtab: (v, root) => {
        tab = v;
        Object.assign(filter, { species: '', month: '', year: '' });
        render(root);
    },
    search: (v, root) => { const c = map.getCenter().wrap(); load(root, { lat: Number(c.lat.toFixed(2)), lon: Number(c.lng.toFixed(2)) }, false); },
    show: v => {
        const r = shown[Number(v)];
        host.scrollIntoView({ block: 'center', behavior: 'smooth' });
        map.setView([r.lat, r.lon], r.approx ? 13 : 15);
        r.mark?.openPopup();
    },
    report: async (v, root) => {
        const r = shown[Number(v)];
        if (!window.confirm(`“${r.species}” paylaşımı yanlış veya uygunsuz diye bildirilsin mi? Sizin ekranınızdan da kalkar.`)) return;
        try {
            await post('/av-bildir', { pid: r.pid, lat: r.lat, lon: r.lon });
            localStorage.setItem(HIDDEN, JSON.stringify([...hidden(), r.pid].slice(-200)));
            toast('Bildirildi. Teşekkürler.', 'ok');
            draw(root, false);
        } catch (err) { toast(`Bildirilemedi: ${err.message}`, 'bad'); }
    }
};

export function change(field, value, root) {
    filter[field] = value;
    draw(root);
}
