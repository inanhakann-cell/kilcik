// Indirilen bolge verisini kucultme: kirpma ve cizgi sadelestirme.

/** Halkayi [guney, bati, kuzey, dogu] kutusuna kirpar (Sutherland-Hodgman). Noktalar [lat, lon]. */
export function clip(ring, [south, west, north, east]) {
    for (const [axis, limit, above] of [[0, south, true], [0, north, false], [1, west, true], [1, east, false]]) {
        const inside = p => (above ? p[axis] >= limit : p[axis] <= limit);
        const out = [];
        ring.forEach((a, i) => {
            const b = ring[(i + 1) % ring.length];
            if (inside(a) !== inside(b)) {
                const t = (limit - a[axis]) / (b[axis] - a[axis]);
                out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
            }
            if (inside(b)) out.push(b);
        });
        ring = out;
        if (!ring.length) break;
    }
    return ring;
}

/** Douglas-Peucker (derece); uc noktalar korunur, koordinatlar 5 haneye yuvarlanir. */
export function simplify(line, tol) {
    const keep = new Set([0, line.length - 1]);
    const stack = [[0, line.length - 1]];
    while (stack.length) {
        const [i, j] = stack.pop();
        const [ay, ax] = line[i], dy = line[j][0] - ay, dx = line[j][1] - ax;
        let worst = tol * tol, at = -1;
        for (let k = i + 1; k < j; k++) {
            const py = line[k][0] - ay, px = line[k][1] - ax;
            const t = dx || dy ? Math.max(0, Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy))) : 0;
            const d = (px - t * dx) ** 2 + (py - t * dy) ** 2;
            if (d > worst) { worst = d; at = k; }
        }
        if (at >= 0) { keep.add(at); stack.push([i, at], [at, j]); }
    }
    return [...keep].sort((a, b) => a - b).map(k => line[k].map(v => Number(v.toFixed(5))));
}
