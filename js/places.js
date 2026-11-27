// Gercek kiyi yapilari (OpenStreetMap) ve bolgedeki balik gozlemleri (iNaturalist).
import { getJson, shoreInfo } from './api.js';
import { cacheGet, cacheSet } from './store.js';
import { LATIN } from './species.js';
import { landmasses, islandAt, sameLand } from './islands.js';

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
    return c ? { list: await onSameLand({ lat, lon }, c.list), fresh: Date.now() - c.at < 7 * 86400000 } : null;
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
    // Arada deniz olan adalar onerilmez; kiyi cizgisi alinamazsa eleme yapilmaz.
    const ways = await coastline(lat, lon, km).catch(() => null);
    const list = [];
    for (const p of ways ? sameLand(landmasses(ways), { lat, lon }, all) : all) {
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

/** Yerlesimler ve insan eliyle kiyi yapilari (OpenStreetMap). */
export async function humanPoints(lat, lon, km) {
    const local = await bundled(lat, lon, km - 3);
    if (local?.structures) return { settlements: local.settlements.map(([name, a, b]) => ({ name, lat: a, lon: b })), structures: local.structures.map(([a, b]) => ({ lat: a, lon: b })) };
    const around = `(around:${Math.round(km * 1000)},${lat},${lon})`;
    const r = await overpass(`[out:json][timeout:30];(node["place"~"^(city|town|village|hamlet|suburb|neighbourhood)$"]${around};nwr["man_made"~"^(pier|breakwater)$"]${around};nwr["leisure"~"^(fishing|marina|beach_resort)$"]${around};nwr["tourism"="camp_site"]${around};);out center 900;`);
    const out = { settlements: [], structures: [] };
    for (const e of r.elements) {
        const p = e.center || e;
        if (!Number.isFinite(p.lat)) continue;
        if (e.tags?.place) { if (e.tags.name) out.settlements.push({ name: e.tags.name, lat: p.lat, lon: p.lon }); }
        else out.structures.push({ lat: p.lat, lon: p.lon });
    }
    return out;
}

/** Bolgedeki fotografli balik ve kafadanbacakli gozlemleri (iNaturalist). */
export async function observations(lat, lon, km) {
    // 47178: isinsal yuzgecli baliklar, 47459: kafadanbacaklilar
    const r = await getJson(`https://api.inaturalist.org/v1/observations?lat=${lat.toFixed(3)}&lng=${lon.toFixed(3)}&radius=${km}&taxon_id=47178,47459&photos=true&per_page=24&order_by=observed_on&locale=tr`);
    return r.results.filter(x => x.photos?.[0]?.url && x.taxon && Object.values(LATIN).some(l => x.taxon.name === l || x.taxon.name.split(' ')[0] === l.split(' ')[0])).map(x => {
        const [a, o] = (x.location || '').split(',').map(Number);
        return { name: x.taxon.preferred_common_name || x.taxon.name, latin: x.taxon.name, date: x.observed_on || '', lat: Number.isFinite(a) ? Number(a.toFixed(4)) : null, lon: Number.isFinite(o) ? Number(o.toFixed(4)) : null, photo: x.photos[0].url.replace('square', 'small'), by: x.photos[0].attribution || '', url: `https://www.inaturalist.org/observations/${x.id}` };
    });
}

/** Koordinata en yakin koy/mahalle adi (OpenStreetMap Nominatim; saniyede en fazla bir istek). */
export async function placeName(lat, lon) {
    const r = await getJson(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=14&accept-language=tr`);
    const a = r.address || {};
    const name = a.village || a.neighbourhood || a.suburb || a.hamlet || a.town || a.city_district || '';
    const district = a.town || a.county || a.city || '';
    return [name && `${name} kıyısı`, district !== name && district].filter(Boolean).join(', ');
}

let bundle;
/** Uygulamayla gelen Biga cevresi verisi; istenen alan tamamen icindeyse dondurur. */
export async function bundled(lat, lon, km) {
    bundle ||= getJson('data/biga-kiyi.json').catch(() => { bundle = null; return null; });
    const data = await bundle;
    if (!data) return null;
    const [south, west, north, east] = data.box;
    const dLat = km / 111.32, dLon = km / (111.32 * Math.cos(lat * Math.PI / 180));
    return lat - dLat >= south && lat + dLat <= north && lon - dLon >= west && lon + dLon <= east ? data : null;
}

let lands = null, box = null;
/** Uygulamayla gelen kiyi cizgisinden ada bilgisini bir kez hazirlar. */
export async function loadLands() {
    if (lands) return;
    bundle ||= getJson('data/biga-kiyi.json').catch(() => { bundle = null; return null; });
    const data = await bundle;
    if (!data) return;
    box = data.box;
    lands = landmasses(data.ways.map(w => w.map(([lat, lon]) => ({ lat, lon }))));
}

/** Ada numarasi, anakara icin null; veri kapsami disinda undefined. */
export function landOf(lat, lon) {
    if (!lands || lat < box[0] || lat > box[2] || lon < box[1] || lon > box[3]) return undefined;
    return islandAt(lands, lat, lon);
}

export const ISLAND_TEXT = 'Adada: karayoluyla gidilemez, feribot veya tekne gerekir.';
export const islandWarning = (lat, lon) => (landOf(lat, lon) > 0 ? `<p class="warn">${ISLAND_TEXT}</p>` : '');

/** Merkezden karayla ulasilamayan ada noktalarini eler (veri kapsami icinde). */
export async function onSameLand(center, list) {
    await loadLands();
    return landOf(center.lat, center.lon) === undefined ? list : sameLand(lands, center, list);
}

/** Harita sunucusu yanit vermese de gosterilebilecek, uygulamayla gelen en yakin kiyi noktalari. */
export async function coastPlaces(lat, lon, km = 25, limit = 6) {
    const data = await bundled(lat, lon, 0);
    if (!data) return [];
    const points = data.ways.flat().map(([a, b]) => ({ lat: a, lon: b, km: distanceKm(lat, lon, a, b) })).filter(p => p.km <= km).sort((a, b) => a.km - b.km);
    await loadLands();
    const home = landOf(lat, lon);
    const out = [];
    for (const p of points) {
        if (out.length >= limit) break;
        if (out.some(o => distanceKm(o.lat, o.lon, p.lat, p.lon) < 3)) continue;
        const land = landOf(p.lat, p.lon);
        if (land && land !== home) continue;
        const [name, a, b] = data.settlements.reduce((best, s) => (distanceKm(p.lat, p.lon, s[1], s[2]) < distanceKm(p.lat, p.lon, best[1], best[2]) ? s : best));
        const near = distanceKm(p.lat, p.lon, a, b) <= 6;
        out.push({ ...p, id: `kiyi_${p.lat}_${p.lon}`, name: near ? `${name} yakını kıyı` : `Kıyı noktası · ${p.km.toFixed(1)} km`, water: 'tuzlu', bonus: 0 });
    }
    return out;
}

/** Kiyi cizgisi parcalari: [[{lat, lon}, ...], ...]. Haftalarca degismez, cihazda saklanir. */
export async function coastline(lat, lon, km) {
    const local = await bundled(lat, lon, km);
    if (local) return local.ways.map(w => w.map(([a, b]) => ({ lat: a, lon: b })));
    const key = `coast:${lat.toFixed(2)},${lon.toFixed(2)},${km}`;
    const cached = await cacheGet(key);
    if (cached) return cached;
    const dLat = km / 111.32, dLon = km / (111.32 * Math.cos(lat * Math.PI / 180));
    const r = await overpass(`[out:json][timeout:60];way["natural"="coastline"](${(lat - dLat).toFixed(3)},${(lon - dLon).toFixed(3)},${(lat + dLat).toFixed(3)},${(lon + dLon).toFixed(3)});out geom;`);
    const ways = r.elements.filter(e => e.geometry?.length > 1).map(e => e.geometry.map(p => ({ lat: p.lat, lon: p.lon })));
    if (!ways.length) throw new Error('Kıyı çizgisi bulunamadı.');
    await cacheSet(key, ways);
    return ways;
}

/** Liman, marina, sanayi ve askeri alanlarin sinir kutulari (OpenStreetMap). */
export async function restrictedAreas(lat, lon, km) {
    const local = await bundled(lat, lon, km - 1);
    const around = `(around:${Math.round(km * 1000)},${lat},${lon})`;
    const r = local?.restricted ? { elements: local.restricted } : await overpass(`[out:json][timeout:25];(nwr["landuse"~"^(industrial|military|harbour|port)$"]${around};nwr["military"]${around};nwr["leisure"="marina"]${around};nwr["seamark:type"="harbour"]${around};nwr["industrial"="port"]${around};);out tags bb 300;`);
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
