// Gercek veri kaynaklari: Open-Meteo (hava, deniz, yukseklik, yer arama), iNaturalist, RainViewer.
import { num, toMs, seaBearing } from './core.js';
import { cacheGet, cacheSet } from './store.js';

export async function getJson(url, ms = 15000, retry = true) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
        const res = await fetch(url, { signal: ctrl.signal });
        // Open-Meteo art arda istekte kisa sure "cok istek" der; bir kez bekleyip yeniden denenir.
        if (res.status === 429 && retry && url.includes('open-meteo.com')) {
            await new Promise(done => setTimeout(done, 4000));
            return await getJson(url, ms, false);
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    } finally { clearTimeout(timer); }
}

const at = (lat, lon) => `latitude=${lat}&longitude=${lon}`;
const WX = 'temperature_2m,relative_humidity_2m,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,weather_code,visibility,precipitation,cloud_cover';
const SEA = 'wave_height,wave_period,swell_wave_height,sea_surface_temperature,ocean_current_velocity,ocean_current_direction,sea_level_height_msl';

function build(w, m) {
    const hw = w.hourly;
    const hm = m?.hourly || {};
    const marine = new Map((hm.time || []).map((t, i) => [t, i]));
    const rows = hw.time.map((time, i) => {
        const j = marine.get(time);
        const s = k => (j === undefined ? null : hm[k]?.[j]);
        const wind = num(hw.wind_speed_10m?.[i]);
        let wave = num(s('wave_height'), 2);
        let waveEstimated = false;
        if (wave === null && m !== undefined && wind !== null) { wave = Number(Math.min(2.4, Math.max(0.05, wind ** 1.15 * 0.038)).toFixed(2)); waveEstimated = true; }
        const cur = num(s('ocean_current_velocity'), 3);
        return {
            time, wind, wave, waveEstimated,
            gust: num(hw.wind_gusts_10m?.[i]), dir: num(hw.wind_direction_10m?.[i], 0), air: num(hw.temperature_2m?.[i]),
            humidity: num(hw.relative_humidity_2m?.[i], 0), pressure: num(hw.pressure_msl?.[i]), code: num(hw.weather_code?.[i], 0),
            visibility: num(hw.visibility?.[i], 0), precip: num(hw.precipitation?.[i]), cloud: num(hw.cloud_cover?.[i], 0),
            period: num(s('wave_period')), swell: num(s('swell_wave_height'), 2), sea: num(s('sea_surface_temperature')),
            current: cur === null ? null : num(cur * 0.539957, 2), currentDir: num(s('ocean_current_direction'), 0), level: num(s('sea_level_height_msl'), 2)
        };
    });
    // son 48 saatin toplam yagisi
    rows.forEach((r, i) => { r.rain = num(rows.slice(Math.max(0, i - 47), i + 1).reduce((a, x) => a + (x.precip || 0), 0)); });
    const days = (w.daily?.time || []).map((date, i) => ({ date, sunrise: w.daily.sunrise?.[i], sunset: w.daily.sunset?.[i] }));
    return { offset: w.utc_offset_seconds || 0, rows, days, updatedAt: new Date().toISOString() };
}

// Kiyi havalimani olcumleriyle (2026 ilkbahar ve sonbahar) karsilastirmada ortalama tek tahminden daha isabetli cikti.
const WIND_MODELS = ['ecmwf_ifs025', 'icon_seamless', 'gfs_seamless', 'meteofrance_seamless'];

/** Ruzgar hizi ve yonunu modellerin ortalamasiyla degistirir; hamle guvenlik icin dusurulmez.
    En az iki modelin verisi olmayan saatte varsayilan tahmin kalir. */
export function blendWind(w, spread) {
    const base = w.hourly, m = spread?.hourly;
    if (!m) return w;
    const index = new Map(m.time.map((t, i) => [t, i]));
    const hourly = { ...base, wind_speed_10m: [...base.wind_speed_10m], wind_direction_10m: [...base.wind_direction_10m], wind_gusts_10m: [...base.wind_gusts_10m] };
    const mean = v => v.reduce((a, b) => a + b, 0) / v.length;
    let used = 0;
    base.time.forEach((time, i) => {
        const j = index.get(time);
        const rows = WIND_MODELS.map(name => ({ s: m[`wind_speed_10m_${name}`]?.[j], d: m[`wind_direction_10m_${name}`]?.[j], g: m[`wind_gusts_10m_${name}`]?.[j] }))
            .filter(r => Number.isFinite(r.s) && Number.isFinite(r.d));
        if (rows.length < 2) return;
        used++;
        hourly.wind_speed_10m[i] = mean(rows.map(r => r.s));
        const x = mean(rows.map(r => r.s * Math.cos(r.d * Math.PI / 180))), y = mean(rows.map(r => r.s * Math.sin(r.d * Math.PI / 180)));
        if (Math.hypot(x, y) > 0.1) hourly.wind_direction_10m[i] = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
        const gusts = rows.map(r => r.g).filter(Number.isFinite);
        const own = base.wind_gusts_10m[i];
        if (gusts.length) hourly.wind_gusts_10m[i] = Math.max(Number.isFinite(own) ? own : 0, mean(gusts), hourly.wind_speed_10m[i]);
    });
    return used ? { ...w, hourly, blended: true } : w;
}

/** salt=false ise deniz verisi istenmez ve dalga tahmin edilmez. */
export async function loadPack(lat, lon, salt) {
    const key = `wx:${lat.toFixed(3)},${lon.toFixed(3)},${salt ? 1 : 0}`;
    try {
        const base = `${at(lat, lon)}&timezone=auto&forecast_days=14&past_days=2`;
        const [w, m, spread] = await Promise.all([
            getJson(`https://api.open-meteo.com/v1/forecast?${base}&hourly=${WX}&daily=sunrise,sunset&wind_speed_unit=kn`),
            salt ? getJson(`https://marine-api.open-meteo.com/v1/marine?${base}&hourly=${SEA}`).catch(() => null) : undefined,
            getJson(`https://api.open-meteo.com/v1/forecast?${base}&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m&models=${WIND_MODELS}&wind_speed_unit=kn`).catch(() => null)
        ]);
        const pack = build(blendWind(w, spread), m);
        await cacheSet(key, pack);
        return { ...pack, source: 'canlı' };
    } catch (err) {
        const cached = await cacheGet(key);
        if (cached) return { ...cached, source: 'önbellek' };
        throw new Error('Hava verisi alınamadı ve bu nokta için kayıt yok.');
    }
}

/** Belirli bir andaki kosullar (yaklasik son 90 gun ve onumuzdeki gunler). */
export async function conditionsAt(lat, lon, localTime) {
    const pack = await dayPack(lat, lon, localTime.slice(0, 10));
    return pack.rows.find(r => r.time.slice(0, 13) === localTime.slice(0, 13)) || null;
}

/** Bir gunun tum saatleri (gecmis veya yakin gelecek). */
export async function dayPack(lat, lon, date) {
    const from = new Date(Date.parse(date) - 2 * 86400000).toISOString().slice(0, 10);
    const base = `${at(lat, lon)}&timezone=auto&start_date=${from}&end_date=${date}`;
    // Eski tarihler tahmin servisinde yok; yeniden analiz arsivi kullanilir (gorus verisi icermez).
    const old = Date.now() - Date.parse(date) > 80 * 86400000;
    const host = old ? 'https://archive-api.open-meteo.com/v1/archive' : 'https://api.open-meteo.com/v1/forecast';
    const [w, m] = await Promise.all([
        getJson(`${host}?${base}&hourly=${old ? WX.replace(',visibility', '') : WX}&daily=sunrise,sunset&wind_speed_unit=kn`),
        getJson(`https://marine-api.open-meteo.com/v1/marine?${base}&hourly=${SEA}`).catch(() => null)
    ]);
    return build(w, m);
}

const offsetPoint = (lat, lon, bearing, meters) => {
    const b = bearing * Math.PI / 180;
    return [lat + (meters * Math.cos(b)) / 111320, lon + (meters * Math.sin(b)) / (111320 * Math.cos(lat * Math.PI / 180))];
};

/** Kiyinin baktigi yon ve noktanin yuksekligi (~90 m cozunurluklu yukseklik modeli). */
export async function shoreInfo(lat, lon) {
    const key = `shore:${lat.toFixed(4)},${lon.toFixed(4)}`;
    const cached = await cacheGet(key);
    if (cached) return cached;
    const bearings = Array.from({ length: 16 }, (_, i) => i * 22.5);
    const pts = [[lat, lon], ...bearings.map(b => offsetPoint(lat, lon, b, 450))];
    const r = await getJson(`https://api.open-meteo.com/v1/elevation?latitude=${pts.map(p => p[0].toFixed(5))}&longitude=${pts.map(p => p[1].toFixed(5))}`);
    const info = { elevation: r.elevation[0], ...seaBearing(bearings.map((bearing, i) => ({ bearing, elevation: r.elevation[i + 1] }))) };
    await cacheSet(key, info);
    return info;
}

/** Konuma en yakin deniz noktasi (yukseklik modelinde 0 m): { lat, lon, km }; 160 km icinde yoksa null. */
export async function nearestSea(lat, lon) {
    const key = `sea:${lat.toFixed(2)},${lon.toFixed(2)}`;
    const cached = await cacheGet(key);
    if (cached) return cached.sea;
    let sea = null;
    for (const rings of [[0, 3, 6, 10, 15, 20], [28, 38, 50, 65, 80, 100], [120, 140, 160]]) {
        const pts = rings.flatMap(km => (km ? Array.from({ length: 16 }, (_, i) => [...offsetPoint(lat, lon, i * 22.5, km * 1000), km]) : [[lat, lon, 0]]));
        const r = await getJson(`https://api.open-meteo.com/v1/elevation?latitude=${pts.map(p => p[0].toFixed(4))}&longitude=${pts.map(p => p[1].toFixed(4))}`);
        const i = r.elevation.findIndex(e => e <= 0);
        if (i >= 0) { sea = { lat: Number(pts[i][0].toFixed(4)), lon: Number(pts[i][1].toFixed(4)), km: pts[i][2] }; break; }
    }
    await cacheSet(key, { sea });
    return sea;
}

/** Mera aramasinin merkezi: deniz yakinsa konumun kendisi, uzaksa en yakin kiyi. */
export async function searchHub(lat, lon) {
    const sea = await nearestSea(lat, lon).catch(() => undefined);
    return sea && sea.km > 10 ? { lat: sea.lat, lon: sea.lon, far: sea.km } : { lat, lon, none: sea === null };
}

/** Cevredeki (~15 km) deniz sicakligi farki. */
export async function sstFront(lat, lon) {
    const pts = [0, 90, 180, 270].map(b => offsetPoint(lat, lon, b, 15000));
    const r = await getJson(`https://marine-api.open-meteo.com/v1/marine?latitude=${pts.map(p => p[0].toFixed(3))}&longitude=${pts.map(p => p[1].toFixed(3))}&current=sea_surface_temperature`);
    const t = [].concat(r).map(x => x.current?.sea_surface_temperature).filter(Number.isFinite);
    return t.length >= 2 ? num(Math.max(...t) - Math.min(...t)) : null;
}

/** NOAA uydu klorofili. NOAA tarayiciya izin vermedigi icin yalnizca bilgisayar baslaticisi uzerinden gelir. */
export async function chlorophyll(lat, lon) {
    const r = await getJson(`klorofil?lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}`, 30000);
    return Number.isFinite(r.value) ? r : null;
}

export async function nearbyFish(lat, lon) {
    const r = await getJson(`https://api.inaturalist.org/v1/observations/species_counts?lat=${lat.toFixed(2)}&lng=${lon.toFixed(2)}&radius=40&iconic_taxa=Actinopterygii&locale=tr&per_page=12`);
    return r.results.map(x => ({ name: x.taxon.preferred_common_name || x.taxon.name, latin: x.taxon.name, count: x.count, url: `https://www.inaturalist.org/taxa/${x.taxon.id}` }));
}

const MODELS = [['ecmwf_ifs025', 'ECMWF'], ['gfs_seamless', 'GFS'], ['icon_seamless', 'ICON']];
/** Uc bagimsiz hava modelinin ruzgar tahmini. */
export async function modelSpread(lat, lon) {
    const r = await getJson(`https://api.open-meteo.com/v1/forecast?${at(lat, lon)}&timezone=auto&forecast_days=7&wind_speed_unit=kn&hourly=wind_speed_10m&models=${MODELS.map(m => m[0])}`);
    return { time: r.hourly.time, models: MODELS.map(([id, name]) => ({ name, wind: r.hourly[`wind_speed_10m_${id}`] || [] })) };
}

export async function searchPlace(q) {
    const r = await getJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=tr`);
    return (r.results || []).map(p => ({ name: [p.name, p.admin1, p.country].filter(Boolean).join(', '), lat: p.latitude, lon: p.longitude }));
}

export async function radarTiles() {
    const r = await getJson('https://api.rainviewer.com/public/weather-maps.json');
    const last = r.radar?.past?.at(-1);
    return last ? { url: `${r.host}${last.path}/256/{z}/{x}/{y}/2/1_1.png`, time: new Date(last.time * 1000) } : null;
}

export async function windGrid({ south, north, west, east }) {
    const pts = [];
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) pts.push([south + (north - south) * (i + 0.5) / 4, west + (east - west) * (j + 0.5) / 4]);
    const wrap = lon => ((((lon + 180) % 360) + 360) % 360) - 180;
    const r = await getJson(`https://api.open-meteo.com/v1/forecast?latitude=${pts.map(p => Math.max(-89, Math.min(89, p[0])).toFixed(3))}&longitude=${pts.map(p => wrap(p[1]).toFixed(3))}&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=kn`);
    return [].concat(r).map((x, i) => ({ lat: pts[i][0], lon: pts[i][1], wind: x.current.wind_speed_10m, dir: x.current.wind_direction_10m }));
}

export { toMs };
