// Ada tanima: OSM kiyi cizgisinde kapanan halkalar adadir. Karadan gidilemeyen yer onerilmez.
const MIN_ISLAND_M = 500; // daha kucuk halkalar (kayalik, ayrik mendirek) yok sayilir

const key = p => `${p.lat},${p.lon}`;
const scale = lat => Math.cos(lat * Math.PI / 180);
const span = ring => {
    const lats = ring.map(p => p.lat), lons = ring.map(p => p.lon);
    return Math.hypot((Math.max(...lats) - Math.min(...lats)) * 111320, (Math.max(...lons) - Math.min(...lons)) * 111320 * scale(lats[0]));
};

/** Kiyi parcalarini uc uca ekler: [{ points, island }] (island: ada numarasi veya null). */
export function landmasses(ways) {
    const starts = new Map(ways.map(w => [key(w[0]), w]));
    const ends = new Set(ways.map(w => key(w[w.length - 1])));
    const used = new Set();
    const out = [];
    let islands = 0;
    const follow = first => {
        const points = [];
        for (let w = first; w && !used.has(w); w = starts.get(key(w[w.length - 1]))) {
            used.add(w);
            points.push(...w);
        }
        return points;
    };
    // Once bir ucu bosta kalan zincirler (anakara), kalanlar kapali halkadir.
    for (const w of [...ways.filter(w => !ends.has(key(w[0]))), ...ways]) {
        if (used.has(w)) continue;
        const points = follow(w);
        const closed = key(points[0]) === key(points[points.length - 1]);
        if (closed && span(points) < MIN_ISLAND_M) continue;
        out.push({ points, island: closed ? ++islands : null });
    }
    return out;
}

/** Noktaya en yakin kiyi bir adaya aitse ada numarasi, anakara ise null. */
export function islandAt(lands, lat, lon) {
    const kx = 111320 * scale(lat), ky = 111320;
    let best = Infinity, island = null;
    for (const land of lands) {
        for (let i = 1; i < land.points.length; i++) {
            const a = land.points[i - 1], b = land.points[i];
            const ax = (a.lon - lon) * kx, ay = (a.lat - lat) * ky;
            const dx = (b.lon - a.lon) * kx, dy = (b.lat - a.lat) * ky;
            const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
            const d = (ax + t * dx) ** 2 + (ay + t * dy) ** 2;
            if (d < best) { best = d; island = land.island; }
        }
    }
    return island;
}

/** Merkezden karayla ulasilamayan adadaki noktalari eler. Merkez adadaysa o ada kalir. */
export function sameLand(lands, center, list) {
    const home = islandAt(lands, center.lat, center.lon);
    return list.filter(p => {
        const island = islandAt(lands, p.lat, p.lon);
        return island === null || island === home;
    });
}
