// Deniz tabani analizi. Derinlik: EMODnet Bathymetry (~115 m hucre; negatif = su, pozitif = kara).
// Dip tipi: EMODnet Geology (kapsama yer yer yoktur). Sonuc balik olasiligi degil, yapi elverisliligidir.
export const CELL = 0.0010416666666666667;
const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

export function parseGrid(text) {
    const n = name => Number(text.match(new RegExp(`"${name}", (-?[\\d.E]+)`))?.[1]);
    const body = text.split('Band 0:')[1];
    if (!body) throw new Error('Derinlik verisi okunamadı.');
    const z = body.trim().split('\n').map(line => line.trim().split(/\s+/).map(Number));
    const dx = n('elt_0_0'), dy = n('elt_1_1'), x0 = n('elt_0_2'), y0 = n('elt_1_2');
    if (![dx, dy, x0, y0].every(Number.isFinite) || !z.length) throw new Error('Derinlik verisi eksik.');
    // elt_0_2 / elt_1_2: ilk hucrenin merkezi
    return { z, rows: z.length, cols: z[0].length, lat: r => y0 + r * dy, lon: c => x0 + c * dx };
}

const isWater = v => Number.isFinite(v) && v < -0.5;

function around(g, r, c, radius, fn) {
    for (let i = -radius; i <= radius; i++) {
        for (let j = -radius; j <= radius; j++) {
            if (i * i + j * j > radius * radius) continue;
            const v = g.z[r + i]?.[c + j];
            if (v !== undefined) fn(v, i, j);
        }
    }
}

export function analyseCell(g, r, c) {
    const depth = -g.z[r][c];
    let water = 0, total = 0, maxD = depth, minD = depth, sum = 0, shore = null, sx = 0, sy = 0;
    around(g, r, c, 3, (v, i, j) => {
        if (!isWater(v)) return;
        const d = -v;
        maxD = Math.max(maxD, d); minD = Math.min(minD, d); sum += d;
    });
    let near = 0;
    around(g, r, c, 6, (v, i, j) => {
        total++;
        if (isWater(v)) { water++; sx += j; sy -= i; near++; return; }
        const dist = Math.hypot(i * 115, j * 88);
        if (!shore || dist < shore.dist) shore = { dist, r: r + i, c: c + j, elevation: v };
    });
    // Puruzluluk: komsularinin ortalamasindan sapma, egim etkisi cikarilarak.
    let rough = 0, count = 0;
    around(g, r, c, 2, (v, i, j) => {
        const a = g.z[r + i + 1]?.[c + j], b = g.z[r + i - 1]?.[c + j], e = g.z[r + i]?.[c + j + 1], f = g.z[r + i]?.[c + j - 1];
        if (![v, a, b, e, f].every(isWater)) return;
        rough += Math.abs(v - (a + b + e + f) / 4); count++;
    });
    let ring = 0, ringN = 0;
    around(g, r, c, 4, (v, i, j) => { if (isWater(v) && i * i + j * j >= 9) { ring += -v; ringN++; } });
    return {
        depth, maxNear: maxD, change: maxD - minD, rough: count ? rough / count : 0,
        openness: total ? water / total : 0, shore,
        rise: ringN ? ring / ringN - depth : 0, // pozitif: cevresinden sig (su alti tepesi)
        seaward: near && (sx || sy) ? (Math.atan2(sx, sy) * 180 / Math.PI + 360) % 360 : null
    };
}

export function structureScore(f, mode) {
    if (mode === 'tekne') {
        const fit = f.depth >= 8 && f.depth <= 35 ? 1 : clamp(1 - Math.min(Math.abs(f.depth - 8), Math.abs(f.depth - 35)) / 15);
        return Math.round(100 * (0.35 * clamp(f.rise / 5) + 0.3 * clamp(f.change / 15) + 0.2 * clamp(f.rough / 1.5) + 0.15 * fit));
    }
    return Math.round(100 * (0.35 * clamp(f.maxNear / 15) + 0.25 * clamp(f.change / 10) + 0.2 * clamp(f.rough / 1.2) + 0.2 * clamp((f.openness - 0.4) / 0.35)));
}

export function describe(f, mode) {
    const out = [];
    if (mode === 'tekne') {
        if (f.rise >= 2) out.push(`su altı tepesi (çevresinden ${f.rise.toFixed(0)} m sığ)`);
        if (f.change >= 8) out.push(`keskin derinlik kırığı (${f.change.toFixed(0)} m fark)`);
    } else {
        if (f.maxNear >= 8) out.push(`250-350 m içinde ${f.maxNear.toFixed(0)} m derinliğe iniyor`);
        if (f.change >= 5) out.push(`derinlik kırığı (${f.change.toFixed(0)} m fark)`);
        if (f.openness >= 0.65) out.push('burun / açık suya çıkıntı');
        else if (f.openness <= 0.4) out.push('koy içi, korunaklı');
    }
    if (f.rough >= 0.6) out.push('engebeli dip (taşlık olabilir)');
    else if (f.rough < 0.2) out.push('düz dip (kumluk/çamur olabilir)');
    return out;
}

/**
 * Merkeze en yakin buyuk kara parcasi (anakara). Adalar ve karsi kiyi disarida kalir.
 * Izgara disina tasmayan, birbirine degen kara hucreleri tek parca sayilir.
 */
function components(g, wanted) {
    const size = g.rows * g.cols;
    const label = new Int32Array(size);
    const counts = [0];
    const stack = [];
    for (let start = 0; start < size; start++) {
        if (label[start] || !wanted(g.z[Math.floor(start / g.cols)][start % g.cols])) continue;
        const id = counts.length;
        let n = 0;
        label[start] = id;
        stack.push(start);
        while (stack.length) {
            const k = stack.pop();
            const r = Math.floor(k / g.cols), c = k % g.cols;
            n++;
            for (let i = -1; i <= 1; i++) {
                for (let j = -1; j <= 1; j++) {
                    const y = r + i, x = c + j;
                    if (y < 0 || x < 0 || y >= g.rows || x >= g.cols) continue;
                    const next = y * g.cols + x;
                    if (!label[next] && wanted(g.z[y][x])) { label[next] = id; stack.push(next); }
                }
            }
        }
        counts.push(n);
    }
    return { label, counts };
}

/** En buyuk su parcasi deniz sayilir; ic sulardaki golet ve cukurlar disarida kalir. */
export function seaMask(g) {
    const { label, counts } = components(g, isWater);
    const big = counts.indexOf(Math.max(...counts));
    return (r, c) => label[r * g.cols + c] === big;
}

export function mainlandMask(g, center) {
    const size = g.rows * g.cols;
    const { label, counts } = components(g, v => !isWater(v));
    // Kucuk adaciklar sayilmaz: en buyuk parcanin onda birinden buyuk, merkeze en yakin parca secilir.
    const big = Math.max(...counts) / 10;
    let best = 0, bestD = Infinity;
    for (let k = 0; k < size; k++) {
        if (!label[k] || counts[label[k]] < big) continue;
        const d = (g.lat(Math.floor(k / g.cols)) - center.lat) ** 2 + ((g.lon(k % g.cols) - center.lon) * 0.76) ** 2;
        if (d < bestD) { bestD = d; best = label[k]; }
    }
    return (r, c) => label[r * g.cols + c] === best;
}

/** Aday hucreler: kiyidan atis mesafesi veya tekne icin acik su; birbirinden ayrik en iyiler. */
export function findSpots(g, mode, { center, limit = 8, spacing = 300, mainland = false } = {}) {
    const onMain = mainland && center ? mainlandMask(g, center) : null;
    const atSea = mainland ? seaMask(g) : null;
    const all = [];
    for (let r = 6; r < g.rows - 6; r++) {
        for (let c = 6; c < g.cols - 6; c++) {
            if (!isWater(g.z[r][c]) || (atSea && !atSea(r, c))) continue;
            // Hizli on eleme: kiyi modunda 2 hucre icinde kara olmali.
            if (mode !== 'tekne' && ![-1, 0, 1].some(i => [-2, -1, 0, 1, 2].some(j => !isWater(g.z[r + i][c + j])))) continue;
            const f = analyseCell(g, r, c);
            const d = f.shore?.dist;
            // Anakara taramasi: en yakin karasi ada veya karsi kiyi olan noktalar atlanir.
            if (onMain && mode !== 'tekne' && f.shore && !onMain(f.shore.r, f.shore.c)) continue;
            if (mode === 'tekne' ? (d !== undefined && d < 250) || f.depth < 5 || f.depth > 45 : d === undefined || d > 150 || f.maxNear < 2) continue;
            all.push({ r, c, lat: Number(g.lat(r).toFixed(5)), lon: Number(g.lon(c).toFixed(5)), f, structure: structureScore(f, mode) });
        }
    }
    all.sort((a, b) => b.structure - a.structure);
    const out = [];
    const metres = (a, b) => Math.hypot((a.lat - b.lat) * 111320, (a.lon - b.lon) * 111320 * Math.cos(a.lat * Math.PI / 180));
    for (const s of all) {
        if (out.length >= limit) break;
        if (center && metres(s, center) > center.radius) continue;
        if (out.some(o => metres(o, s) < spacing)) continue;
        if (s.f.shore && mode !== 'tekne') s.stand = { lat: Number(g.lat(s.f.shore.r).toFixed(5)), lon: Number(g.lon(s.f.shore.c).toFixed(5)), elevation: s.f.shore.elevation, cast: Math.round(s.f.shore.dist) };
        out.push(s);
    }
    return out;
}

export const CAST_M = 100;
const move = (lat, lon, bearing, m) => ({ lat: lat + (m * Math.cos(bearing * Math.PI / 180)) / 111320, lon: lon + (m * Math.sin(bearing * Math.PI / 180)) / (111320 * Math.cos(lat * Math.PI / 180)) });
const metresBetween = (a, b) => Math.hypot((a.lat - b.lat) * 111320, (a.lon - b.lon) * 111320 * Math.cos(a.lat * Math.PI / 180));

/**
 * Gercek kiyi cizgisinden (OSM: yurume yonunun sagi denizdir) kiyi noktalari.
 * Durma noktasi cizginin uzerinde, balik noktasi 100 m acikta; derinlik yapisi en yakin su hucresinden.
 */
export function coastSpots(g, ways, { center, limit = 80, spacing = 1800, mainland = true, every = 200 } = {}) {
    const onMain = mainland ? mainlandMask(g, center) : null;
    const lat0 = g.lat(0), lon0 = g.lon(0);
    const cell = p => [Math.round((lat0 - p.lat) / CELL), Math.round((p.lon - lon0) / CELL)];
    const inside = ([r, c]) => r >= 6 && c >= 6 && r < g.rows - 6 && c < g.cols - 6;
    const all = [];
    for (const way of ways) {
        let carry = every;
        for (let i = 1; i < way.length; i++) {
            const a = way[i - 1], b = way[i];
            const length = metresBetween(a, b);
            if (!length) continue;
            const bearing = (Math.atan2((b.lon - a.lon) * Math.cos(a.lat * Math.PI / 180), b.lat - a.lat) * 180 / Math.PI + 360) % 360;
            const sea = Math.round((bearing + 90) % 360);
            for (; carry <= length; carry += every) {
                const stand = { lat: a.lat + (b.lat - a.lat) * (carry / length), lon: a.lon + (b.lon - a.lon) * (carry / length) };
                if (center && metresBetween(stand, center) > center.radius) continue;
                const [sr, sc] = cell(stand);
                if (!inside([sr, sc])) continue;
                let elevation = 0, main = !onMain;
                around(g, sr, sc, 6, (v, y, x) => {
                    if (isWater(v)) return;
                    if (onMain && onMain(sr + y, sc + x)) main = true;
                    if (Math.abs(y) <= 2 && Math.abs(x) <= 2) elevation = Math.max(elevation, v);
                });
                if (!main) continue;
                let water = null;
                for (let d = CAST_M; d <= 900 && !water; d += 100) {
                    const [r, c] = cell(move(stand.lat, stand.lon, sea, d));
                    if (inside([r, c]) && isWater(g.z[r][c])) water = { r, c, d };
                }
                if (!water) continue;
                const f = { ...analyseCell(g, water.r, water.c), seaward: sea };
                const cast = move(stand.lat, stand.lon, sea, CAST_M);
                all.push({
                    lat: Number(cast.lat.toFixed(5)), lon: Number(cast.lon.toFixed(5)), f, dataAt: water.d, structure: structureScore(f, 'kiyi'),
                    stand: { lat: Number(stand.lat.toFixed(5)), lon: Number(stand.lon.toFixed(5)), elevation, cast: CAST_M }
                });
            }
            carry -= length;
        }
    }
    all.sort((a, b) => b.structure - a.structure || a.dataAt - b.dataAt);
    const out = [];
    for (const s of all) {
        if (out.length >= limit) break;
        if (!out.some(o => metresBetween(o.stand, s.stand) < spacing)) out.push(s);
    }
    return out;
}

export async function loadGrid(lat, lon, radiusM) {
    const dLat = radiusM / 111320 + 7 * CELL;
    const dLon = radiusM / (111320 * Math.cos(lat * Math.PI / 180)) + 7 * CELL;
    const url = `https://ows.emodnet-bathymetry.eu/wcs?service=WCS&version=2.0.1&request=GetCoverage&coverageId=emodnet__mean&subset=Lat(${(lat - dLat).toFixed(4)},${(lat + dLat).toFixed(4)})&subset=Long(${(lon - dLon).toFixed(4)},${(lon + dLon).toFixed(4)})&format=text/plain`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 90000);
    try {
        const res = await fetch(url, { signal: ctrl.signal });
        if (!res.ok) throw new Error('Bu bölge için derinlik verisi alınamadı (veri yalnızca Avrupa denizlerini kapsar).');
        return parseGrid(await res.text());
    } finally { clearTimeout(timer); }
}

const SUBSTRATE = [[/rock|boulder/i, 'kaya / blok', 8], [/mixed/i, 'karışık (taş, çakıl, kum)', 6], [/coarse/i, 'iri taneli (çakıl, iri kum)', 4], [/muddy sand|sand/i, 'kum', 2], [/mud/i, 'çamur', -3]];
export async function substrate(lat, lon) {
    const d = 0.005;
    for (const layer of ['seabed_substrate_250k', 'seabed_substrate_1m']) {
        const url = `https://drive.emodnet-geology.eu/geoserver/gtk/wms?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetFeatureInfo&LAYERS=${layer}&QUERY_LAYERS=${layer}&SRS=EPSG:4326&BBOX=${lon - d},${lat - d},${lon + d},${lat + d}&WIDTH=11&HEIGHT=11&X=5&Y=5&INFO_FORMAT=application/json&PROPERTYNAME=folk_5cl_txt`;
        const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
        if (!res.ok) continue;
        const text = (await res.json()).features?.[0]?.properties?.folk_5cl_txt;
        if (!text) continue;
        const hit = SUBSTRATE.find(([re]) => re.test(text));
        if (hit) return { name: hit[1], bonus: hit[2], scale: layer.endsWith('1m') ? 'kaba harita (1:1.000.000)' : '1:250.000' };
    }
    return null;
}

/** Turun yasam alani tercihine gore carpan (genel balikcilik bilgisi). */
export function habitatFit(name, f, bottom) {
    const kind = bottom?.name || '';
    const rocky = /kaya|karışık/.test(kind) || (!kind && f.rough >= 0.6);
    const grass = kind.startsWith('deniz çayırı');
    const sandy = kind === 'kum' || (!kind && f.rough < 0.25);
    const mud = kind === 'çamur';
    const coarse = kind.startsWith('iri');
    const deep = f.maxNear >= 14;
    const shallow = f.maxNear < 9;
    // [kosul, carpan] listesi; kosullar carpilir
    const table = {
        'Levrek': [[shallow, 1.1], [rocky || coarse, 1.12], [f.openness >= 0.65, 1.05], [mud, 0.92]],
        'Lüfer / Çinekop': [[deep, 1.15], [shallow, 0.85], [f.openness >= 0.65, 1.08]],
        'Palamut': [[deep && f.openness >= 0.6, 1.12], [!deep, 0.75]],
        'İstavrit': [[deep, 1.1], [shallow, 0.9]],
        'Karagöz / Sargoz': [[rocky, 1.2], [sandy, 0.75], [mud, 0.65], [coarse, 1.05]],
        'Çipura': [[sandy || coarse, 1.12], [grass, 1.1], [mud, 0.92], [deep, 0.92]],
        'Mırmır': [[sandy, 1.2], [shallow, 1.08], [rocky, 0.7], [mud, 0.85]],
        'Kalamar': [[rocky || grass, 1.15], [deep, 1.05], [mud, 0.82], [sandy, 0.92]],
        'Sübye': [[sandy || grass, 1.12], [shallow, 1.05], [rocky, 0.9]],
        'İzmarit': [[rocky || grass, 1.1], [mud, 0.95]],
        'Kefal': [[f.openness <= 0.45, 1.15], [f.openness > 0.65, 0.85], [mud, 1.08]],
        'Zargana': [[f.openness >= 0.6, 1.08], [shallow, 0.95]]
    };
    return (table[name] || []).reduce((x, [when, factor]) => (when ? x * factor : x), 1);
}
