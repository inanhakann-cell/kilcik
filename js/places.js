// Gercek kiyi yapilari (OpenStreetMap) ve bolgedeki balik gozlemleri (iNaturalist).
import { getJson, shoreInfo } from './api.js';
import { cacheGet, cacheSet } from './store.js';
import { LATIN } from './species.js';

// Ucretsiz sunucular sik sik dolu olur; ilk yanit veren kullanilir.
const SERVERS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
// bonus: yapinin kiyi avi icin genel elverisliligi
const KINDS = {
    breakwater: ['Mendirek', 6], groyne: ['Mahmuz', 5], pier: ['İskele', 4], cape: ['Burun', 5], fishing: ['İşaretli olta yeri', 6]
};
export const distanceKm = (a, b, c, d) => {
    const r = x => x * Math.PI / 180;
    return 12742 * Math.asin(Math.sqrt(Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2));
};

const overpass = query => Promise.any(SERVERS.map(server => getJson(`${server}?data=${encodeURIComponent(query)}`, 40000)));

const placeKey = (lat, lon, km) => `places:${lat.toFixed(2)},${lon.toFixed(2)},${km}`;
/** Kayitli arama sonucu: { list, fresh } veya null. */
export async function cachedPlaces(lat, lon, km = 25) {
    const c = await cacheGet(placeKey(lat, lon, km));
    return c ? { list: c.list, fresh: Date.now() - c.at < 7 * 86400000 } : null;
}

/** Deniz kiyisindaki mendirek, iskele, burun ve olta yerleri; en elverisli ve yakin olanlar. */
export async function findPlaces(lat, lon, km = 25, limit = 10) {
    const around = `(around:${km * 1000},${lat},${lon})`;
    const r = await overpass(`[out:json][timeout:25];(nwr["man_made"~"^(pier|breakwater|groyne)$"]${around};node["natural"="cape"]${around};nwr["leisure"="fishing"]${around};);out center 200;`);
    const all = r.elements.map(e => {
        const t = e.tags || {};
        const kind = t.leisure === 'fishing' ? 'fishing' : t.natural === 'cape' ? 'cape' : t.man_made;
        const p = e.center || e;
        if (!KINDS[kind] || !Number.isFinite(p.lat) || t.access === 'private') return null;
        const [label, bonus] = KINDS[kind];
        return { id: `osm_${e.type}_${e.id}`, name: t.name ? `${t.name} (${label.toLocaleLowerCase('tr-TR')})` : label, kind: label, bonus, lat: Number(p.lat.toFixed(5)), lon: Number(p.lon.toFixed(5)), named: Boolean(t.name), water: 'tuzlu', km: distanceKm(lat, lon, p.lat, p.lon) };
    }).filter(Boolean).sort((a, b) => (b.bonus + b.named * 3 - b.km / 5) - (a.bonus + a.named * 3 - a.km / 5));
    const list = [];
    for (const p of all) {
        if (list.length >= limit) break;
        if (list.some(q => distanceKm(p.lat, p.lon, q.lat, q.lon) < 0.8) || list.filter(q => q.kind === p.kind).length >= 6) continue;
        // Ic sulardaki yapilari ele: cevresinde deniz seviyesinde su olmali.
        const shore = await shoreInfo(p.lat, p.lon).catch(() => null);
        if (shore && !shore.wetShare) continue;
        if (!p.named) p.name = `${p.kind} · ${p.km.toFixed(1)} km`;
        list.push(p);
    }
    await cacheSet(placeKey(lat, lon, km), { at: Date.now(), list });
    return list;
}

/** Liman, marina, sanayi ve askeri alanlarin sinir kutulari (OpenStreetMap). */
export async function restrictedAreas(lat, lon, km) {
    const around = `(around:${Math.round(km * 1000)},${lat},${lon})`;
    const r = await overpass(`[out:json][timeout:25];(nwr["landuse"~"^(industrial|military|harbour|port)$"]${around};nwr["military"]${around};nwr["leisure"="marina"]${around};nwr["seamark:type"="harbour"]${around};nwr["industrial"="port"]${around};);out tags bb 300;`);
    const kind = t => (t.military || t.landuse === 'military' ? 'askeri alan' : t.leisure === 'marina' ? 'marina' : /harbour|port/.test(`${t.landuse} ${t.industrial} ${t['seamark:type']}`) ? 'liman' : 'sanayi alanı');
    return r.elements.map(e => {
        const b = e.bounds || (e.lat !== undefined ? { minlat: e.lat, maxlat: e.lat, minlon: e.lon, maxlon: e.lon } : null);
        return b && { ...b, kind: kind(e.tags || {}) };
    }).filter(Boolean);
}

/** Noktaya yaklasik 250 m icindeki kayitli alan turleri. */
export function nearRestricted(areas, lat, lon, pad = 0.0023) {
    return [...new Set(areas.filter(a => lat >= a.minlat - pad && lat <= a.maxlat + pad && lon >= a.minlon - pad * 1.3 && lon <= a.maxlon + pad * 1.3).map(a => a.kind))];
}

/** Bolgede (40 km) bu ay ve komsu aylarda kayda girmis balik/yumusakca gozlemleri. */
export async function seenNearby(lat, lon, month) {
    const key = `seen:${lat.toFixed(1)},${lon.toFixed(1)},${month}`;
    const cached = await cacheGet(key);
    if (cached && Date.now() - cached.at < 86400000) return cached.seen;
    const months = [(month + 10) % 12 + 1, month, month % 12 + 1];
    const r = await getJson(`https://api.inaturalist.org/v1/observations/species_counts?lat=${lat.toFixed(2)}&lng=${lon.toFixed(2)}&radius=40&month=${months}&iconic_taxa=Actinopterygii,Mollusca&per_page=200`);
    const seen = {};
    for (const x of r.results) {
        const hit = Object.entries(LATIN).find(([, latin]) => x.taxon.name === latin || x.taxon.name.split(' ')[0] === latin);
        if (hit) seen[hit[0]] = (seen[hit[0]] || 0) + x.count;
    }
    await cacheSet(key, { at: Date.now(), seen });
    return seen;
}
