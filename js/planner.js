// Plan ve tarama icin ortak hesap: her ekran ayni puani uretir.
import * as C from './core.js';
import * as api from './api.js';
import { app } from './ui.js';

export function contextFor({ lat, lon, water, technique, species = '' }, bearing) {
    const history = app.state.catches
        .filter(c => !c.blank && c.at && c.lat !== null && Math.hypot(c.lat - lat, (c.lon - lon) * 0.76) < 0.3)
        .map(c => Number(c.at.slice(11, 13)));
    return { salt: water === 'tuzlu', technique, species, limits: app.state.settings, bearing, history, lat, lon, weights: C.calibrate(app.state.catches).weights };
}

export const solunarFor = (pack, ctx, date) => C.solunar(window.SunCalc, C.toMs(`${date}T00:00`, pack.offset), ctx.lat, ctx.lon);
export const moonFor = (pack, date) => window.SunCalc.getMoonIllumination(new Date(C.toMs(`${date}T12:00`, pack.offset))).phase;
export const planFor = (pack, ctx, date, now = Date.now()) => C.planDay(pack, date, now, { ...ctx, solunar: solunarFor(pack, ctx, date), moon: moonFor(pack, date) });
export const datesOf = (pack, now = Date.now()) => pack.days.map(d => d.date).filter(d => d >= C.localIso(now, pack.offset).slice(0, 10));

/** Kayitli noktalarda onumuzdeki gunlerin en iyi guvenli pencereleri. */
export async function scanSpots(spots, technique, days = 7, onProgress = () => {}) {
    const found = [];
    let failed = 0;
    for (const [n, s] of spots.entries()) {
        onProgress(n + 1, spots.length);
        try {
            const pack = await api.loadPack(s.lat, s.lon, s.water === 'tuzlu');
            if (!C.dataStatus(pack, Date.now()).ok) { failed++; continue; }
            const shore = await api.shoreInfo(s.lat, s.lon).catch(() => null);
            const ctx = contextFor({ ...s, technique }, shore?.bearing ?? null);
            for (const date of datesOf(pack).slice(0, days)) {
                const p = planFor(pack, ctx, date);
                const w = p.windows[0];
                if (w) found.push({ spot: s, date, score: w.score, from: w.from, to: w.to, level: w.peak.safety.level, confidence: p.confidence, fromMs: C.toMs(w.from, pack.offset), toMs: C.toMs(w.to, pack.offset) });
            }
        } catch { failed++; }
    }
    return { found: found.sort((a, b) => b.score - a.score || a.fromMs - b.fromMs), failed };
}

export function icsFile(events) {
    const stamp = ms => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const clean = s => String(s).replace(/[\\;,]/g, m => `\\${m}`).replace(/\r?\n/g, ' ');
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//KILCIK//TR', ...events.flatMap((e, i) => [
        'BEGIN:VEVENT', `UID:${e.fromMs}-${i}@kilcik`, `DTSTAMP:${stamp(Date.now())}`, `DTSTART:${stamp(e.fromMs)}`, `DTEND:${stamp(e.toMs)}`,
        `SUMMARY:${clean(`Av: ${e.name} (puan ${e.score})`)}`, `DESCRIPTION:${clean('Gitmeden önce planı yenileyip güvenliği kontrol edin.')}`, `GEO:${e.lat};${e.lon}`,
        'BEGIN:VALARM', 'TRIGGER:-PT2H', 'ACTION:DISPLAY', 'DESCRIPTION:Av penceresi yaklaşıyor', 'END:VALARM', 'END:VEVENT'
    ]), 'END:VCALENDAR'].join('\r\n');
}
