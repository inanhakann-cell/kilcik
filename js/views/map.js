// Harita: yer arama, konum, nokta secme, kayitli noktalar, av haritasi, yagis radari, ruzgar oklari.
import * as api from '../api.js';
import { validCoord } from '../core.js';
import * as scan from './scan.js';
import { app, $, esc, uid, toast, locate, persist, mapsUrl } from '../ui.js';

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
    map.on('moveend', () => { if (windOn) { clearTimeout(windTimer); windTimer = setTimeout(drawWind, 700); } });
}

function popupFor(lat, lon, name, extra = '') {
    const box = document.createElement('div');
    box.className = 'popup';
    box.innerHTML = `<b>${esc(name)}</b><br><span class="mono">${lat.toFixed(5)}, ${lon.toFixed(5)}</span>${extra}
        <button class="btn primary" data-p="weather">Hava durumu</button>
        <button class="btn" data-p="plan">Burada planla</button>
        <button class="btn" data-p="save">Noktayı kaydet</button>
        <button class="btn" data-p="log">Buraya av ekle</button>
        <a class="btn" href="${mapsUrl(lat, lon)}" target="_blank" rel="noopener">Yol tarifi</a>`;
    box.addEventListener('click', async e => {
        const act = e.target.dataset?.p;
        const named = name === 'Seçilen nokta' ? '' : name;
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
            icon: window.L.divIcon({ className: 'windmark', iconSize: [64, 44], html: `<i style="transform:rotate(${Number(p.dir) + 180}deg)">↑</i><span>${Math.round(p.wind * 1.852)} km/s</span>` })
        }).addTo(windLayer));
    } catch { toast('Rüzgar haritası alınamadı.', 'bad'); }
}

export function render(root, params = {}) {
    root.innerHTML = `
    <form class="row search" data-form="search"><input name="q" placeholder="Yer ara (ör. Karabiga)" aria-label="Yer ara"><button class="btn">Ara</button></form>
    <div id="results" class="chips"></div>
    <div class="row wrap"><button class="btn" data-act="locate">Konumum</button><button class="btn" data-act="radar">Yağış radarı</button><button class="btn" data-act="wind">Rüzgar haritası</button></div>
    <p class="mute">${params.pick ? 'Plan için haritada bir noktaya dokunun.' : 'Haritaya dokunun. Sarı: noktalarım, kırmızı: avlarım.'}</p>
    <div id="map-slot"></div>
    <div id="scan-panel"></div>`;
    ensureMap();
    $('#map-slot').append(host);
    scan.connect(scanView);
    scan.paint();
    drawMarks();
    setTimeout(() => map.invalidateSize(), 50);
    if (params.focus) { map.setView([params.focus.lat, params.focus.lon], 14); select(params.focus.lat, params.focus.lon, params.focus.name); }
    else if (app.draft.lat !== null && params.pick) map.setView([app.draft.lat, app.draft.lon], 12);
}

let found = null;
const scanView = {
    // Ekrandaki alanin yaricapi, 1-6 km ile sinirli
    area: () => ({ center: map.getCenter().wrap(), radius: Math.round(Math.min(8000, Math.max(3000, map.distance(map.getCenter(), map.getBounds().getNorthEast()) * 0.75))) }),
    mark: spots => {
        found?.remove();
        const L = window.L;
        found = L.layerGroup(spots.flatMap((s, i) => [
            ...(s.stand ? [L.polyline([[s.stand.lat, s.stand.lon], [s.lat, s.lon]], { color: '#fff', weight: 1.5, dashArray: '4 4', interactive: false })] : []),
            L.marker([s.lat, s.lon], { icon: L.divIcon({ className: 'spotmark', iconSize: [28, 28], html: `<b>${i + 1}</b>` }) })
                .bindPopup(popupFor(s.lat, s.lon, `Tarama ${i + 1}`, `<br>Derinlik ${s.f.depth.toFixed(0)} m · puan ${s.total}`), { minWidth: 190 })
        ])).addTo(map);
    },
    focus: s => { map.setView([s.lat, s.lon], 15); host.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
};

export const actions = {
    ...scan.actions,
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
