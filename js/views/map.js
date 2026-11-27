// Harita: yer arama, konum, nokta secme, kayitli noktalar, av haritasi, yagis radari, ruzgar oklari.
import * as api from '../api.js';
import { validCoord } from '../core.js';
import * as explore from './explore.js';
import * as extras from '../extras.js';
import * as guide from '../guide.js';
import { islandWarning } from '../places.js';
import { dipLine } from '../dip.js';
import { app, $, esc, uid, toast, locate, persist, mapsUrl, mapTabs, pill } from '../ui.js';

let map = null;
let marks, picked, radar, windLayer, host;
let windOn = false;
let windTimer = 0;

function ensureMap() {
    if (map) return;
    const L = window.L;
    host = document.createElement('div');
    host.id = 'map';
    $('#map-slot').append(host);
    map = L.map(host).setView([40.2, 26.8], 8);
    const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 18, attribution: 'Uydu © Esri' }).addTo(map);
    const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' });
    const sea = L.tileLayer('https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenSeaMap' }).addTo(map);
    L.control.layers({ Uydu: sat, Harita: osm }, { 'Deniz işaretleri': sea }).addTo(map);
    marks = L.layerGroup().addTo(map);
    windLayer = L.layerGroup().addTo(map);
    map.on('click', e => select(e.latlng.lat, e.latlng.wrap().lng));
    map.on('dragend zoomend', () => { moved = true; });
    map.on('moveend', () => { if (windOn) { clearTimeout(windTimer); windTimer = setTimeout(drawWind, 700); } });
}

function popupFor(lat, lon, name, extra = '') {
    const box = document.createElement('div');
    box.className = 'popup';
    box.innerHTML = `<b>${esc(name)}</b><br><span class="mono">${lat.toFixed(5)}, ${lon.toFixed(5)}</span>${extra}
        <button class="btn primary" data-p="weather">Hava durumu</button>
        <button class="btn" data-p="guide">Noktaya götür</button>
        <button class="btn" data-p="plan">Burada planla</button>
        <button class="btn" data-p="save">Noktayı kaydet</button>
        <button class="btn" data-p="log">Buraya av ekle</button>
        <button class="btn" data-p="send">Arkadaşıma gönder</button>
        <a class="btn" href="${mapsUrl(lat, lon)}" target="_blank" rel="noopener">Yol tarifi</a>${islandWarning(lat, lon)}${dipLine(lat, lon)}`;
    box.addEventListener('click', async e => {
        const act = e.target.dataset?.p;
        const named = name === 'Seçilen nokta' ? '' : name;
        if (act === 'guide') return guide.open(lat, lon, name);
        if (act === 'send') return extras.share(lat, lon, named || 'Mera');
        if (act === 'weather') app.go('hava', { point: { lat, lon, name: named || 'Seçilen nokta' } });
        if (act === 'plan') app.go('plan', { draft: { lat, lon, name: named } });
        if (act === 'log') app.go('gunluk', { lat, lon, spot: named });
        if (act === 'save') {
            const title = window.prompt('Noktanın adı:', named || 'Yeni mera');
            if (!title?.trim()) return;
            app.state.spots.push({ id: uid('spot'), name: title.trim().slice(0, 80), lat, lon, water: app.draft.water, note: '' });
            await persist();
            map.closePopup();
            drawMarks();
            toast('Nokta kaydedildi.', 'ok');
        }
    });
    return box;
}

function select(lat, lon, name = 'Seçilen nokta') {
    lat = Number(lat.toFixed(5));
    lon = Number(lon.toFixed(5));
    if (!validCoord(lat, lon)) return;
    picked?.remove();
    picked = window.L.circleMarker([lat, lon], { radius: 9, color: '#fff', fillColor: '#14b8a6', fillOpacity: 1 }).addTo(map);
    picked.bindPopup(popupFor(lat, lon, name), { minWidth: 190 }).openPopup();
}

function drawMarks() {
    marks.clearLayers();
    const L = window.L;
    app.state.spots.forEach(s => L.circleMarker([s.lat, s.lon], { radius: 7, color: '#042f2e', fillColor: '#fbbf24', fillOpacity: 1 })
        .bindPopup(popupFor(s.lat, s.lon, s.name), { minWidth: 190 }).addTo(marks));
    app.state.catches.filter(c => !c.blank && c.lat !== null).forEach(c => L.circleMarker([c.lat, c.lon], { radius: 5, color: '#fff', fillColor: '#f43f5e', fillOpacity: 0.9 })
        .bindPopup(`<b>${esc(c.species)}</b><br>${esc(c.at.replace('T', ' '))}<br>${esc(c.lure)}`).addTo(marks));
}

async function drawWind() {
    const b = map.getBounds();
    try {
        const grid = await api.windGrid({ south: b.getSouth(), north: b.getNorth(), west: b.getWest(), east: b.getEast() });
        if (!windOn) return;
        windLayer.clearLayers();
        grid.forEach(p => window.L.marker([p.lat, p.lon], {
            interactive: false,
            icon: window.L.divIcon({ className: 'windmark', iconSize: [64, 44], html: `<i style="transform:rotate(${Number(p.dir) + 180}deg)">↑</i><span>${Math.round(p.wind * 1.852)} km/sa</span>` })
        }).addTo(windLayer));
    } catch { toast('Rüzgar haritası alınamadı.', 'bad'); }
}

let area = null;   // Bugun ekranindan gelen bolge

function topList(spots) {
    if (!spots) return '<p class="mute">Haritayı bir kıyıya getirip tarayın ya da bir noktaya dokunun. Sarı: noktalarım, kırmızı: avlarım.</p>';
    return `<h3>Son taramada en iyiler</h3>${spots.slice(0, 3).map((s, i) => `<button type="button" class="card window" data-act="top" data-v="${i}"><b>${i + 1}. ${esc(s.place || `${s.lat}, ${s.lon}`)}</b>${pill(s.total)}<small>${s.f.depth.toFixed(0)} m${s.bottom ? ` · ${esc(s.bottom.name)}` : ''}${s.fish[0] ? ` · ${esc(s.fish[0].name)}` : ''}</small></button>`).join('')}<button type="button" class="btn big" data-nav="kesif">Tüm liste</button>`;
}

export async function render(root, params = {}) {
    area = params.area || area;
    root.innerHTML = `${mapTabs('harita')}
    <form class="row search" data-form="search"><input name="q" placeholder="Yer ara (ör. Karabiga)" aria-label="Yer ara"><button class="btn">Ara</button></form>
    <div id="results" class="chips"></div>
    ${params.pick ? '<p class="banner warn">Plan için haritada bir noktaya dokunun.</p>' : ''}
    <div id="map-slot"></div>
    <button type="button" class="btn primary big scan" data-act="explore">⌖ Bu kıyıyı tara</button>
    <div class="row wrap"><button class="btn" data-act="locate">Konumum</button><button class="btn" data-act="radar">Yağış radarı</button><button class="btn" data-act="wind">Rüzgar okları</button></div>
    <div id="map-top"></div>`;
    ensureMap();
    $('#map-slot').append(host);
    drawMarks();
    const last = params.spots || (await explore.latest());
    const box = $('#map-top');
    if (box) box.innerHTML = topList(last);
    mark(last || []);
    setTimeout(() => {
        map.invalidateSize();
        if (params.focus) { map.setView([params.focus.lat, params.focus.lon], 14); select(params.focus.lat, params.focus.lon, params.focus.name); }
        else if (params.pick && app.draft.lat !== null) map.setView([app.draft.lat, app.draft.lon], 12);
        else if (params.spots) { const one = params.spots[params.show]; if (one) map.setView([one.lat, one.lon], 15); else map.fitBounds(params.spots.map(s => [s.lat, s.lon])); }
        else if (params.area) map.setView([params.area.lat, params.area.lon], 11);
        else if (last && !moved) map.fitBounds(last.slice(0, 8).map(s => [s.lat, s.lon]), { maxZoom: 13 });
    }, 80);
}

let found = null;
let shown = [];
let moved = false;   // kullanici haritayi gezdirdiyse konum korunur
function mark(spots) {
    shown = spots;
    found?.remove();
    const L = window.L;
    found = L.layerGroup(spots.flatMap((s, i) => [
        ...(s.stand ? [L.polyline([[s.stand.lat, s.stand.lon], [s.lat, s.lon]], { color: '#fff', weight: 1.5, dashArray: '4 4', interactive: false })] : []),
        L.marker([s.lat, s.lon], { icon: L.divIcon({ className: `spotmark ${s.total >= 65 ? '' : s.total >= 45 ? 'mid' : 'low'}`, iconSize: [28, 28], html: `<b>${i + 1}</b>` }) })
            .bindPopup(popupFor(s.lat, s.lon, s.place || `Tarama ${i + 1}`, `<br>Derinlik ${s.f.depth.toFixed(0)} m`), { minWidth: 190 })
    ])).addTo(map);
}

export const actions = {
    // Ekrandaki alan taranir: yaricap 3-45 km ile sinirli.
    explore: () => {
        const c = map.getCenter().wrap();
        const radius = Math.min(45, Math.max(3, Math.round(map.distance(map.getCenter(), map.getBounds().getNorthEast()) * 0.75 / 1000)));
        app.go('kesif', { area: { lat: c.lat, lon: c.lng, name: area && map.distance(c, [area.lat, area.lon]) < 3000 ? area.name : 'Haritada seçilen alan' }, radius, run: true });
    },
    top: v => { const s = shown[Number(v)]; map.setView([s.lat, s.lon], 15); select(s.lat, s.lon, s.place || `Tarama ${Number(v) + 1}`); $('#map').scrollIntoView({ behavior: 'smooth', block: 'center' }); },
    locate: async () => {
        try { const p = await locate(); map.setView([p.lat, p.lon], 14); select(p.lat, p.lon, `Konumum (±${p.accuracy} m)`); }
        catch (err) { toast(err.message, 'bad'); }
    },
    radar: async () => {
        if (radar) { radar.remove(); radar = null; return; }
        try {
            const t = await api.radarTiles();
            if (!t) throw new Error();
            radar = window.L.tileLayer(t.url, { opacity: 0.65, maxNativeZoom: 7, maxZoom: 19, attribution: 'Radar © RainViewer' }).addTo(map);
            if (map.getZoom() > 8) map.setZoom(7);
            toast(`Radar saati: ${t.time.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}`);
        } catch { toast('Yağış radarı alınamadı.', 'bad'); }
    },
    wind: () => { windOn = !windOn; if (windOn) drawWind(); else windLayer.clearLayers(); },
    goto: v => { const [lat, lon] = v.split(',').map(Number); map.setView([lat, lon], 13); select(lat, lon); }
};

export async function submit(form) {
    const q = form.q.value.trim();
    if (q.length < 2) return;
    try {
        const found = await api.searchPlace(q);
        $('#results').innerHTML = found.map(p => `<button type="button" class="chip" data-act="goto" data-v="${p.lat},${p.lon}">${esc(p.name)}</button>`).join('') || '<span class="mute">Sonuç yok.</span>';
    } catch { toast('Arama yapılamadı.', 'bad'); }
}
