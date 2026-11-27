// Uygulamayla gelen dip bilgisi: kiyi turu (OpenStreetMap) ve acikta tortu (EMODnet 1:100.000).
// Ikisi de yaklasiktir; tek kaya, batik ve yosun lekesi gorunmez.
import { getJson } from './api.js';

const SHORE_M = 150;   // kiyi turu en fazla bu uzakliktaki noktaya yakistirilir
const SHORE = {
    bare_rock: ['kayalık', 'kaya / blok (kıyı kayalık)', 8], rock: ['kayalık', 'kaya / blok (kıyı kayalık)', 8], reef: ['resif', 'kaya / blok (resif)', 8],
    cliff: ['falez (dik kayalık)', 'kaya / blok (falez dibi)', 6], shingle: ['çakıl', 'iri taneli (çakıl kıyı)', 4], beach: ['kumsal', 'kum', 2]
};
// Sira onemli: "Mud to muddy Sand" icinde "Sand" da gecer.
const SEDIMENT = [[/rock|boulder/i, 'kaya / blok', 8], [/mixed/i, 'karışık (taş, çakıl, kum)', 6], [/coarse/i, 'iri taneli (çakıl, iri kum)', 4], [/^(\d+\.\s*)?mud/i, 'çamur', -3], [/sand/i, 'kum', 2]];

export function sedimentKind(text) {
    const hit = SEDIMENT.find(([re]) => re.test(text || ''));
    return hit ? { name: hit[1], bonus: hit[2] } : null;
}

let data = null, loading = null;
export function loadDip() {
    loading ||= getJson('data/biga-dip.json').then(d => { data = d; return d; }).catch(() => { loading = null; return null; });
    return loading;
}

const inRing = (ring, lat, lon) => ring.reduce((inside, [aLat, aLon], i) => {
    const [bLat, bLon] = ring[(i + ring.length - 1) % ring.length];
    return (aLat > lat) !== (bLat > lat) && lon < aLon + ((lat - aLat) / (bLat - aLat)) * (bLon - aLon) ? !inside : inside;
}, false);

export function sedimentAt(d, lat, lon) {
    // Cift-tek kurali: ic halkalar (delikler) alandan sayilmaz.
    const hit = d.sediment.find(a => a.r.filter(ring => inRing(ring, lat, lon)).length % 2 === 1);
    return hit ? sedimentKind(hit.t) : null;
}

export function shoreAt(d, lat, lon, max = SHORE_M) {
    const kx = 111320 * Math.cos(lat * Math.PI / 180), ky = 111320;
    let best = max, found = null;
    for (const s of d.shore) {
        if (Math.abs(s.p[0][0] - lat) > 0.05) continue;
        for (let i = 0; i < s.p.length; i++) {
            const a = s.p[i], b = s.p[i + 1] || a;
            const ax = (a[1] - lon) * kx, ay = (a[0] - lat) * ky, dx = (b[1] - a[1]) * kx, dy = (b[0] - a[0]) * ky;
            const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
            const m = Math.hypot(ax + t * dx, ay + t * dy);
            if (m <= best && SHORE[s.t]) { best = m; found = s.t; }
        }
    }
    if (!found) return null;
    const [label, name, bonus] = SHORE[found];
    return { label, name, bonus, metres: Math.round(best) };
}

/** Acikta (kiyidan ~400 m) tortu: noktanin kendisi kiyida ise cevresindeki ilk deniz alani. */
export function offshoreAt(d, lat, lon) {
    const direct = sedimentAt(d, lat, lon);
    if (direct) return direct;
    for (const r of [0.002, 0.004]) {
        for (const [dy, dx] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
            const hit = sedimentAt(d, lat + dy * r, lon + dx * r * 1.3);
            if (hit) return hit;
        }
    }
    return null;
}

/** Puanlamada kullanilan dip: once kiyida gorulen yapi; yoksa null (cagiran diger kaynaklara bakar). */
export function shoreBottom(lat, lon) {
    const s = data && shoreAt(data, lat, lon);
    return s ? { name: s.name, bonus: s.bonus, scale: `kıyıda ${s.label}, OpenStreetMap` } : null;
}
export function sedimentBottom(lat, lon) {
    const s = data && offshoreAt(data, lat, lon);
    return s ? { name: s.name, bonus: s.bonus, scale: '1:100.000 örnekleme haritası' } : null;
}

/** Ekranlarda gosterilen tek satir; veri yoksa bos. */
export function dipText(lat, lon) {
    if (!data) return '';
    const shore = shoreAt(data, lat, lon), sea = offshoreAt(data, lat, lon);
    return [shore && `kıyı ${shore.label}`, sea && `açıkta ${sea.name}`].filter(Boolean).join(' · ');
}
export const dipLine = (lat, lon) => {
    const text = dipText(lat, lon);
    return text ? `<p class="dip">Dip (yaklaşık): <b>${text}</b></p>` : '';
};
