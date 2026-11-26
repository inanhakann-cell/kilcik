// Bolge kesfi: kiyi boyunca aday meralar, dip habitati, derinlik kesiti, sakinlik ve puanlama.
import * as C from './core.js';
import { substrate, habitatFit, CELL } from './seabed.js';
import { contextFor, planFor } from './planner.js';
import { speciesActivity, ownEvidence } from './activity.js';
import { app } from './ui.js';
import { distanceKm } from './places.js';

/** Yaklasik 1.5 km icinde deniz olan yerlesimler. */
export function coastalOnly(g, settlements) {
    const lat0 = g.lat(0), lon0 = g.lon(0);
    return settlements.filter(p => {
        const r = Math.round((lat0 - p.lat) / CELL), c = Math.round((p.lon - lon0) / CELL);
        for (let i = -13; i <= 13; i += 2) for (let j = -17; j <= 17; j += 2) if (g.z[r + i]?.[c + j] < -0.5) return true;
        return false;
    });
}

export const PROFILE_M = [100, 250, 500, 1000];

/** Denize dogru verilen mesafelerdeki derinlik (m); karaya denk gelirse null. */
export function depthProfile(g, spot) {
    const from = spot.stand || spot;
    const bearing = spot.f.seaward;
    if (bearing === null) return PROFILE_M.map(m => ({ m, depth: null }));
    const lat0 = g.lat(0), lon0 = g.lon(0);
    return PROFILE_M.map(m => {
        const lat = from.lat + (m * Math.cos(bearing * Math.PI / 180)) / 111320;
        const lon = from.lon + (m * Math.sin(bearing * Math.PI / 180)) / (111320 * Math.cos(from.lat * Math.PI / 180));
        const z = g.z[Math.round((lat0 - lat) / CELL)]?.[Math.round((lon - lon0) / CELL)];
        return { m, depth: z !== undefined && z < -0.5 ? Math.round(-z) : null };
    });
}

// EMODnet deniz habitat siniflari (kiyi bandi) -> Turkce ad ve elverislilik katkisi
const HABITATS = [[/posidonia|seagrass|meadow/i, 'deniz çayırı (erişte)', 7], [/rock|reef/i, 'kaya / resif', 8], [/mixed/i, 'karışık (taş, çakıl, kum)', 6], [/coarse/i, 'iri taneli (çakıl, iri kum)', 4], [/sand/i, 'kum', 2], [/mud/i, 'çamur', -3]];
export function classifyHabitat(types) {
    const ordered = [...types].sort((a, b) => Number(/infralittoral/i.test(b)) - Number(/infralittoral/i.test(a)));
    for (const type of ordered) {
        const hit = HABITATS.find(([re]) => re.test(type));
        if (hit) return { name: hit[1], bonus: hit[2], scale: 'EMODnet habitat haritası', type };
    }
    return null;
}

export async function habitat(lat, lon) {
    const d = 0.002;
    try {
        const url = `https://ows.emodnet-seabedhabitats.eu/geoserver/emodnet_view/wms?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetFeatureInfo&LAYERS=eusm2025_msfd_full&QUERY_LAYERS=eusm2025_msfd_full&SRS=EPSG:4326&BBOX=${lon - d},${lat - d},${lon + d},${lat + d}&WIDTH=11&HEIGHT=11&X=5&Y=5&INFO_FORMAT=application/json&PROPERTYNAME=msfd_bbht&FEATURE_COUNT=4`;
        const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
        const found = res.ok ? classifyHabitat((await res.json()).features.map(f => f.properties.msfd_bbht || '')) : null;
        if (found) return found;
    } catch { /* habitat servisi yanit vermezse jeoloji haritasina dusulur */ }
    return substrate(lat, lon).catch(() => null);
}

const COMPASS = ['kuzeyinde', 'kuzeydoğusunda', 'doğusunda', 'güneydoğusunda', 'güneyinde', 'güneybatısında', 'batısında', 'kuzeybatısında'];
/** "Kemer'in 1.2 km kuzeybatisinda" gibi okunur yer tarifi. */
export function describePlace(settlements, lat, lon) {
    let best = null;
    for (const p of settlements) {
        const km = distanceKm(lat, lon, p.lat, p.lon);
        if (!best || km < best.km) best = { ...p, km };
    }
    if (!best) return '';
    const bearing = (Math.atan2((lon - best.lon) * Math.cos(lat * Math.PI / 180), lat - best.lat) * 180 / Math.PI + 360) % 360;
    return `${best.name}: ${best.km.toFixed(1)} km ${COMPASS[Math.round(bearing / 45) % 8]}`;
}

// 3.60 m bot sinirlari
const boatOk = r => r.wind <= 14 && r.gust < 17 && r.wave !== null && r.wave <= 0.6 && !(r.code >= 95);

/** Bir aday noktayi secili gunun havasiyla puanlar. */
export function evaluate({ spot: s, pack, date, mode, bottom, seen }) {
    const month = Number(date.slice(5, 7));
    const ctx = contextFor({ lat: s.lat, lon: s.lon, water: 'tuzlu', technique: app.draft.technique }, s.f.seaward);
    const plan = planFor(pack, ctx, date);
    const hours = mode === 'tekne' ? plan.hours.filter(h => h.score !== null && boatOk(h.row)) : plan.hours;
    const evidence = { seen, own: ownEvidence(app.state.catches, s.lat, s.lon, month) };
    const grass = bottom?.name.startsWith('deniz çayırı');
    const fish = speciesActivity(pack, hours, { salt: true, evidence })
        // Habitat uyumu puani toplamsal kaydirir; boylece turler tavanda birikmez.
        .map(f => ({ ...f, score: Math.max(0, Math.min(92, Math.round(f.score - 6 + (habitatFit(f.name, s.f, bottom) - 1) * 70 + (grass && ['Çipura', 'Kalamar', 'Sübye', 'Mırmır'].includes(f.name) ? 6 : 0)))) }))
        .filter(f => !f.closed).sort((a, b) => b.score - a.score).slice(0, 4);
    const best = mode === 'tekne' ? hours.reduce((a, h) => (!a || h.score > a.score ? h : a), null) : plan.windows[0]?.peak;
    const peak = best?.row;
    const shore = peak ? C.windToShore(peak.dir, s.f.seaward) : null;
    const exposure = mode === 'tekne' || !shore || shore !== 'karşıdan' ? 0 : peak.wind > 15 ? -10 : peak.wind >= 5 ? 5 : 0;
    const mark = C.markNear(app.state.marks, s.lat, s.lon)?.verdict || null;
    const total = !best ? 0 : Math.max(0, Math.min(99, Math.round(0.45 * s.structure + 0.25 * best.score + 0.2 * (fish[0]?.score || 0) + (bottom?.bonus || 0) + exposure + (mark === 'iyi' ? 12 : mark === 'kotu' ? -20 : 0))));
    const window = !best ? null : mode === 'tekne' ? { from: peak.time, to: C.localIso(C.toMs(peak.time, pack.offset) + 3600000, pack.offset) } : plan.windows[0];
    const own = Object.values(evidence.own).reduce((a, b) => a + b, 0);
    return { ...s, mark, bottom, fish, shore, safe: best ? (mode === 'tekne' ? 'caution' : best.safety.level) : 'nogo', total, window, own, reasons: best?.safety.reasons || [] };
}
