// Saf hesaplar: guvenlik, solunar, puan, pencereler, yorum, kayit temizleme.
import { SPECIES, TECHNIQUES } from './species.js';

export const FRESH_HOURS = 3;
export const DEFAULT_LIMITS = { wind: 22, wave: 1.25 };

export const num = (v, d = 1) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? Number(n.toFixed(d)) : null;
};
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const DIRS = ['K', 'KD', 'D', 'GD', 'G', 'GB', 'B', 'KB'];
const WIND_NAMES = ['Yıldız', 'Poyraz', 'Gündoğusu', 'Keşişleme', 'Kıble', 'Lodos', 'Günbatısı', 'Karayel'];
const sector = deg => Math.round((((deg % 360) + 360) % 360) / 45) % 8;
export const kmh = kt => (isNum(kt) ? `${Math.round(kt * 1.852)} km/sa` : '--');
export const dirCode = deg => (isNum(deg) ? DIRS[sector(deg)] : '--');
export const windName = deg => (isNum(deg) ? WIND_NAMES[sector(deg)] : '--');
export const angleDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

// Yerel saat metni ("2026-11-26T11:00") <-> UTC milisaniye
export const toMs = (time, offsetSec) => Date.parse(`${time}:00Z`) - offsetSec * 1000;
export const localIso = (ms, offsetSec) => new Date(ms + offsetSec * 1000).toISOString().slice(0, 16);
export const hhmm = iso => iso.slice(11, 16);

// Noktanin cevresindeki yukseklik orneklerinden denizin yonunu bulur (0 m ve alti = su).
export function seaBearing(samples) {
    const wet = samples.filter(s => s.elevation <= 0);
    if (!wet.length || wet.length === samples.length) return { bearing: null, wetShare: wet.length / (samples.length || 1) };
    const x = wet.reduce((a, s) => a + Math.sin(s.bearing * Math.PI / 180), 0);
    const y = wet.reduce((a, s) => a + Math.cos(s.bearing * Math.PI / 180), 0);
    const bearing = Math.hypot(x, y) < 0.8 ? null : Math.round((Math.atan2(x, y) * 180 / Math.PI + 360) % 360);
    return { bearing, wetShare: wet.length / samples.length };
}

// Ruzgar "geldigi yon" olarak verilir. Denizden geliyorsa karsidan (onshore).
export function windToShore(windDir, bearing) {
    if (!isNum(windDir) || !isNum(bearing)) return null;
    const d = angleDiff(windDir, bearing);
    return d <= 60 ? 'karşıdan' : d >= 120 ? 'arkadan' : 'yandan';
}

/** Kiyi boyunca esen ruzgarin yuzey suyunu aciga mi kiyiya mi tasidigi (kaba Ekman tahmini). */
export function upwelling(windDir, windKt, bearing, lat) {
    if (!isNum(windDir) || !isNum(windKt) || !isNum(bearing) || !isNum(lat)) return null;
    if (windKt < 8) return 'zayıf';
    const transport = windDir + 180 + (lat >= 0 ? 90 : -90);
    const toSea = Math.cos((transport - bearing) * Math.PI / 180);
    return toSea > 0.6 ? 'dipten su yükselmesi olası' : toSea < -0.6 ? 'kıyıya su yığılması olası' : 'belirgin değil';
}

export function dataStatus(pack, nowMs) {
    if (!pack?.rows?.length) return { ok: false, message: 'Hava verisi yok.' };
    const ageH = (nowMs - Date.parse(pack.updatedAt)) / 3600000;
    if (!(ageH <= FRESH_HOURS)) return { ok: false, message: `Veri ${Number.isFinite(ageH) ? Math.floor(ageH) + ' saat' : 'bilinmeyen süre'} önce alınmış (sınır ${FRESH_HOURS} saat). Yenileyin.` };
    return { ok: true, message: '' };
}

/** Kiyi guvenligi. level: go | caution | nogo | unknown */
export function shoreSafety(row, { limits = DEFAULT_LIMITS, bearing = null, salt = true, dark = null } = {}) {
    if (!row || !isNum(row.wind) || !isNum(row.gust) || (salt && !isNum(row.wave))) return { level: 'unknown', reasons: ['Rüzgar veya dalga verisi eksik.'] };
    const stop = [];
    const care = [];
    const onshore = windToShore(row.dir, bearing);
    if (isNum(row.code) && row.code >= 95) stop.push('Gök gürültülü fırtına: karbon kamış yıldırım çeker.');
    if (row.wind > limits.wind) stop.push(`Rüzgar ${kmh(row.wind)} (sınır ${kmh(limits.wind)}).`);
    if (row.gust >= 34) stop.push(`Fırtına hamlesi ${kmh(row.gust)}.`);
    else if (row.gust >= 25) care.push(`Sert hamle ${kmh(row.gust)}.`);
    if (salt) {
        if (row.wave > limits.wave) stop.push(`Dalga ${row.wave} m: kayalık ve mendirekte sürüklenme riski.`);
        else if (row.wave > limits.wave * 0.65) care.push(`Dalga ${row.wave} m: ıslak kayalara dikkat.`);
        if (isNum(row.period) && row.period >= 9 && row.wave > 0.6) care.push('Uzun periyotlu ölü dalga: beklenmedik büyük dalga gelebilir.');
        if (onshore === 'karşıdan' && row.wind >= 15) care.push('Sert rüzgar denizden karaya esiyor.');
        if (row.waveEstimated) care.push('Dalga ölçümü yok, tahmin edildi.');
    }
    if (isNum(row.visibility) && row.visibility < 1000) care.push('Yoğun sis.');
    if (isNum(row.air) && row.air <= 1) care.push('Don/buzlanma riski.');
    if (dark) care.push('Karanlık: ışık ve kaymaz ayakkabı.');
    if (!isNum(row.code)) care.push('Yağış/fırtına verisi yok.');
    return { level: stop.length ? 'nogo' : care.length ? 'caution' : 'go', reasons: [...stop, ...care] };
}

/** Ay gecislerinden (ana) ve dogus/batisindan (ara) solunar donemleri. SunCalc disaridan verilir. */
export function solunar(SunCalc, dayStartMs, lat, lon) {
    const step = 10 * 60000;
    const alt = [];
    for (let t = dayStartMs - step; t <= dayStartMs + 86400000 + step; t += step) alt.push({ t, a: SunCalc.getMoonPosition(new Date(t), lat, lon).altitude });
    const periods = [];
    for (let i = 1; i < alt.length - 1; i++) {
        const up = alt[i].a > alt[i - 1].a && alt[i].a >= alt[i + 1].a;
        const down = alt[i].a < alt[i - 1].a && alt[i].a <= alt[i + 1].a;
        if (up || down) periods.push({ type: 'ana', at: alt[i].t, half: 60 * 60000 });
    }
    for (let i = 1; i < alt.length; i++) {
        // ufuk gecisi (ay yaricapi ve kirilma icin ~0.133 derece)
        const h = 0.133 * Math.PI / 180;
        if ((alt[i - 1].a - h) * (alt[i].a - h) < 0) periods.push({ type: 'ara', at: alt[i].t - step / 2, half: 30 * 60000 });
    }
    return periods.filter(p => p.at >= dayStartMs && p.at < dayStartMs + 86400000).sort((a, b) => a.at - b.at);
}

export function moonName(phase) {
    const names = ['Yeni ay', 'Büyüyen hilal', 'İlk dördün', 'Büyüyen şişkin ay', 'Dolunay', 'Küçülen şişkin ay', 'Son dördün', 'Küçülen hilal'];
    return names[Math.round(phase * 8) % 8];
}

const rangeFit = (v, [lo, hi], soft) => (v >= lo && v <= hi ? 1 : clamp(1 - Math.min(Math.abs(v - lo), Math.abs(v - hi)) / soft, 0, 1));

export function speciesFor({ salt, month, seaTemp, technique }) {
    return SPECIES.filter(s => s.ortam === (salt ? 'tuzlu' : 'tatli'))
        .map(s => {
            const season = s.aylar.includes(month);
            const temp = isNum(seaTemp) ? rangeFit(seaTemp, s.su, 4) : null;
            const tech = s.t.includes(technique);
            return { ...s, season, temp, tech, fit: Math.round(100 * ((season ? 0.5 : 0.1) + (temp === null ? 0.15 : temp * 0.3) + (tech ? 0.2 : 0))) };
        })
        .filter(s => s.season || s.temp === 1)
        .sort((a, b) => b.fit - a.fit);
}

/** Saatlik plan puani. Her etken puani ve gerekceyi birlikte dondurur. */
export function scoreHour(pack, i, ctx) {
    const row = pack.rows[i];
    const safety = shoreSafety(row, { limits: ctx.limits, bearing: ctx.bearing, salt: ctx.salt, dark: isDark(pack, row) });
    if (safety.level === 'unknown') return { row, safety, score: null, factors: [] };
    const tech = TECHNIQUES.find(t => t.id === ctx.technique) || TECHNIQUES[0];
    const ms = toMs(row.time, pack.offset);
    const factors = [];
    // ctx.weights: kullanicinin av/bos kayitlarindan ogrenilen carpanlar
    const add = (key, points, max, text) => { const k = ctx.weights?.[key] ?? 1; factors.push({ key, points: Math.round(points * k), max: Math.round(max * k), text }); };

    const day = pack.days.find(d => d.date === row.time.slice(0, 10));
    const near = iso => (iso ? Math.abs(ms - toMs(iso, pack.offset)) / 3600000 : 99);
    const dawn = Math.min(near(day?.sunrise), near(day?.sunset));
    add('zaman', dawn <= 1 ? 22 : dawn <= 2 ? 15 : isDark(pack, row) ? 9 : 7, 22, dawn <= 1 ? 'Alacakaranlık saati' : dawn <= 2 ? 'Gün doğumu/batımına yakın' : isDark(pack, row) ? 'Gece saati' : 'Gün ortası');

    const sol = (ctx.solunar || []).find(p => Math.abs(ms + 1800000 - p.at) <= p.half + 900000);
    add('solunar', sol ? (sol.type === 'ana' ? 8 : 6) : 3, 8, sol ? `Solunar ${sol.type} dönem` : 'Solunar dönem dışında');

    const prev = pack.rows[i - 3];
    const dp = prev && isNum(prev.pressure) && isNum(row.pressure) ? Number((row.pressure - prev.pressure).toFixed(1)) : null;
    add('basinc', dp === null ? 4 : dp <= -3.5 ? 4 : dp <= -0.8 ? 8 : dp < 0.8 ? 6 : dp < 2.5 ? 4 : 3, 8, dp === null ? 'Basınç eğilimi bilinmiyor' : dp <= -3.5 ? `Basınç sert düşüyor (${dp} hPa/3sa)` : dp <= -0.8 ? `Basınç düşüyor (${dp} hPa/3sa)` : dp < 0.8 ? 'Basınç dengeli' : `Basınç yükseliyor (+${dp} hPa/3sa)`);

    add('ruzgar', 18 * rangeFit(row.wind, tech.wind, 7), 18, `${windName(row.dir)} ${kmh(row.wind)}, ${tech.ad} için ${rangeFit(row.wind, tech.wind, 7) >= 0.99 ? 'uygun' : row.wind > tech.wind[1] ? 'fazla' : 'çok sakin'}`);
    if (ctx.salt) {
        add('dalga', 14 * rangeFit(row.wave, tech.wave, 0.4), 14, `Dalga ${row.wave} m, ${rangeFit(row.wave, tech.wave, 0.4) >= 0.99 ? 'uygun' : row.wave > tech.wave[1] ? 'yüksek' : 'çarşaf'}`);
        // Dalga yatisiyorsa su hala karisiktir; kiyi yirticilari icin olumlu sayilir.
        const past = pack.rows.slice(Math.max(0, i - 36), Math.max(0, i - 5)).map(r => r.wave).filter(isNum);
        if (past.length >= 12 && isNum(row.wave)) {
            const peakWave = Math.max(...past);
            const settling = peakWave >= 0.6 && row.wave <= peakWave * 0.7 && row.wave >= 0.15;
            add('deniz_gecmisi', settling ? 6 : 3, 6, settling ? `Sert deniz yatışıyor (önce ${peakWave} m)` : 'Son bir günde belirgin deniz değişimi yok');
        }
        const a = pack.rows[i - 1]?.level;
        const b = pack.rows[i + 1]?.level;
        const move = isNum(a) && isNum(b) ? Math.abs(b - a) / 2 : null;
        add('gelgit', move === null ? 3 : move >= 0.03 ? 6 : move >= 0.012 ? 5 : 2, 6, move === null ? 'Su seviyesi verisi yok' : move >= 0.012 ? `Su ${b > a ? 'yükseliyor' : 'alçalıyor'}` : 'Su seviyesi durgun');
    }
    add('gokyuzu', isNum(row.rain) && row.rain > 4 ? 2 : isNum(row.cloud) ? (row.cloud >= 40 ? 8 : 5) : 4, 8, isNum(row.rain) && row.rain > 4 ? 'Kuvvetli yağış' : row.cloud >= 40 ? 'Bulutlu, loş ışık' : 'Açık gökyüzü');

    // Su sicakligi degisimi (2 gun): ani soguma beslenmeyi yavaslatir.
    const before = pack.rows[i - 48]?.sea ?? pack.rows[i - 24]?.sea;
    if (isNum(row.sea) && isNum(before)) {
        const dt = Number((row.sea - before).toFixed(1));
        add('su_egilimi', dt <= -1.5 ? 1 : dt <= -0.6 ? 5 : dt < 1.5 ? 10 : 7, 10, dt <= -0.6 ? `Su soğuyor (${dt}°C)` : dt >= 0.6 ? `Su ısınıyor (+${dt}°C)` : 'Su sıcaklığı dengeli');
    }
    if (isNum(ctx.moon)) {
        const edge = Math.abs(Math.cos(ctx.moon * 2 * Math.PI)); // yeni ay ve dolunayda 1
        add('ay', 2 + 2 * edge, 4, edge > 0.7 ? 'Yeni ay / dolunay dönemi' : 'Ara ay evresi');
    }
    if (ctx.salt || isNum(row.sea)) {
        const target = SPECIES.find(s => s.ad === ctx.species);
        if (target && isNum(row.sea)) add('tur', 18 * rangeFit(row.sea, target.su, 3) * (target.aylar.includes(Number(row.time.slice(5, 7))) ? 1 : 0.35), 18, `${target.ad}: su ${row.sea}°C, ${target.aylar.includes(Number(row.time.slice(5, 7))) ? 'mevsiminde' : 'mevsim dışı'}`);
    }
    // Kendi av gecmisi: ayni saat diliminde yakindaki avlar
    const hour = Number(row.time.slice(11, 13));
    const mine = (ctx.history || []).filter(h => Math.min(Math.abs(h - hour), 24 - Math.abs(h - hour)) <= 1).length;
    if ((ctx.history || []).length >= 5) add('gecmis', 8 * Math.min(1, mine / (ctx.history.length * 0.4)), 8, mine ? `Kendi günlüğünüzde bu saatlerde ${mine} av` : 'Kendi günlüğünüzde bu saatlerde av yok');

    const total = factors.reduce((s, f) => s + f.points, 0);
    const max = factors.reduce((s, f) => s + f.max, 0);
    let score = Math.round((total / max) * 100);
    if (safety.level === 'nogo') score = Math.min(score, 15);
    return { row, safety, score, factors, dp };
}

export function isDark(pack, row) {
    const d = pack.days.find(x => x.date === row.time.slice(0, 10));
    if (!d?.sunrise || !d?.sunset) return null;
    const t = toMs(row.time, pack.offset) + 1800000;
    return t < toMs(d.sunrise, pack.offset) - 1800000 || t > toMs(d.sunset, pack.offset) + 1800000;
}

export const scoreLabel = s => (s === null ? 'Veri yok' : s >= 75 ? 'Kamışı kap, git' : s >= 60 ? 'İyi bir gün' : s >= 45 ? 'Denemeye değer' : s >= 25 ? 'Zayıf' : 'Evde kal');

/** Secili gunun saatleri; bugun icin gecmis saatler onerilmez. */
export function planDay(pack, date, nowMs, ctx) {
    const hours = [];
    pack.rows.forEach((row, i) => {
        if (row.time.startsWith(date) && toMs(row.time, pack.offset) + 3600000 > nowMs) hours.push(scoreHour(pack, i, ctx));
    });
    const usable = hours.filter(h => h.score !== null);
    const best = usable.filter(h => h.safety.level !== 'nogo').sort((a, b) => b.score - a.score);
    const windows = [];
    const taken = new Set();
    for (const peak of best) {
        if (windows.length === 3) break;
        const p = usable.indexOf(peak);
        if (taken.has(p)) continue;
        let a = p, b = p;
        const ok = k => usable[k] && !taken.has(k) && usable[k].safety.level !== 'nogo' && usable[k].score >= peak.score - 8
            && Math.abs(toMs(usable[k].row.time, pack.offset) - toMs(peak.row.time, pack.offset)) <= 2 * 3600000;
        while (ok(a - 1)) a--;
        while (ok(b + 1)) b++;
        for (let k = a - 1; k <= b + 1; k++) taken.add(k);
        windows.push({ from: usable[a].row.time, to: localIso(toMs(usable[b].row.time, pack.offset) + 3600000, pack.offset), score: peak.score, peak });
    }
    const score = windows.length ? windows[0].score : usable.length ? Math.max(...usable.map(h => h.score)) : null;
    const leadDays = (toMs(`${date}T12:00`, pack.offset) - nowMs) / 86400000;
    const confidence = leadDays <= 2 ? 'yüksek' : leadDays <= 5 ? 'orta' : 'düşük';
    return { hours, windows, score, confidence, allUnsafe: usable.length > 0 && !best.length };
}

export function commentary(plan, ctx, species) {
    if (plan.score === null) return ['Bu gün için puan hesaplayacak veri yok.'];
    if (plan.allUnsafe) return ['Bu gün güvenli bir saat görünmüyor.', plan.hours.find(h => h.safety.level === 'nogo')?.safety.reasons[0] || ''];
    const w = plan.windows[0];
    const sorted = [...w.peak.factors].sort((a, b) => b.points / b.max - a.points / a.max);
    const low = t => t.charAt(0).toLocaleLowerCase('tr-TR') + t.slice(1);
    const out = [`En güçlü pencere ${hhmm(w.from)}–${hhmm(w.to)} (puan ${w.score}, tahmin güveni ${plan.confidence}).`,
        `Artılar: ${sorted.filter(f => f.points / f.max >= 0.85).map(f => low(f.text)).join(', ') || 'belirgin bir artı yok'}.`];
    const minus = sorted.filter(f => f.points / f.max <= 0.4).map(f => low(f.text));
    if (minus.length) out.push(`Eksiler: ${minus.join(', ')}.`);
    const shore = windToShore(w.peak.row.dir, ctx.bearing);
    if (shore) out.push(shore === 'karşıdan' ? 'Rüzgar karşıdan: kıyı bulanır ve köpürür, levrek için iyi olabilir; ağır ve rüzgarı kesen sahte seçin.' : shore === 'arkadan' ? 'Rüzgar arkadan: uzak atış kolay, su berraklaşabilir; ince misina ve doğal renk deneyin.' : 'Rüzgar yandan: misinada göbek oluşur; ağırlığı artırın, kamışı alçak tutun.');
    if (species.length) out.push(`Öne çıkan türler: ${species.slice(0, 3).map(s => `${s.ad} (${s.yem})`).join('; ')}.`);
    if (w.peak.safety.reasons.length) out.push(`Güvenlik: ${w.peak.safety.reasons.join(' ')}`);
    return out.filter(Boolean);
}

/**
 * Kendi kayitlarindan ogrenme: av cikan ve cikmayan seanslarda etken oranlarini karsilastirir.
 * Her iki gruptan en az `min` kayit olmadan agirlik degistirmez; degisim 0.6-1.4 ile sinirlidir.
 */
export function calibrate(catches, min = 8) {
    const rows = catches.filter(c => c.factors);
    const good = rows.filter(c => !c.blank);
    const blank = rows.filter(c => c.blank);
    const out = { good: good.length, blank: blank.length, min, ready: good.length >= min && blank.length >= min, weights: {}, effects: [] };
    if (!out.ready) return out;
    for (const key of FACTOR_KEYS) {
        const a = good.map(c => c.factors[key]).filter(isNum);
        const b = blank.map(c => c.factors[key]).filter(isNum);
        if (a.length < min || b.length < min) continue;
        const mean = v => v.reduce((x, y) => x + y, 0) / v.length;
        const diff = mean(a) - mean(b);
        // Az kayitta etki kucultulur.
        const trust = Math.min(1, Math.min(a.length, b.length) / 30);
        out.weights[key] = Number(clamp(1 + diff * 1.5 * trust, 0.6, 1.4).toFixed(2));
        out.effects.push({ key, diff: Number(diff.toFixed(2)), weight: out.weights[key] });
    }
    out.effects.sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff));
    return out;
}
/**
 * Isabet karnesi: ayni gun ve yerdeki kayitlar tek av sayilir; tahmin puani yuksek ve dusuk
 * avlarda balik cikma orani karsilastirilir. Her grupta `min` av olmadan yorum yapilmaz.
 */
export function scorecard(catches, min = 5, line = 65) {
    const trips = new Map();
    for (const c of catches) {
        if (!isNum(c.score) || !c.at) continue;
        const key = `${c.at.slice(0, 10)}|${c.lat?.toFixed(2)},${c.lon?.toFixed(2)}`;
        const t = trips.get(key) || { scores: [], fish: false };
        t.scores.push(c.score);
        t.fish ||= !c.blank;
        trips.set(key, t);
    }
    const group = () => ({ trips: 0, fish: 0 });
    const high = group(), low = group();
    for (const t of trips.values()) {
        const g = t.scores.reduce((a, b) => a + b, 0) / t.scores.length >= line ? high : low;
        g.trips++;
        if (t.fish) g.fish++;
    }
    for (const g of [high, low]) g.rate = g.trips ? Math.round((g.fish / g.trips) * 100) : null;
    return { high, low, total: trips.size, min, line, ready: high.trips >= min && low.trips >= min };
}

/** Onumuzdeki `hours` saatte firtina duzeyinde ruzgar, dalga veya oraj: { from, to, wind, gust, wave, thunder } | null. */
export function stormAhead(pack, nowMs = Date.now(), hours = 48) {
    const bad = pack.rows.filter(r => {
        const ms = toMs(r.time, pack.offset);
        return ms + 3600000 > nowMs && ms < nowMs + hours * 3600000 && (r.wind >= 22 || r.gust >= 34 || r.code >= 95 || (r.wave >= 1.5 && !r.waveEstimated));
    });
    if (!bad.length) return null;
    const top = key => bad.reduce((a, r) => (isNum(r[key]) && r[key] > a ? r[key] : a), 0);
    return { from: bad[0].time, to: bad[bad.length - 1].time, wind: top('wind'), gust: top('gust'), wave: top('wave') || null, thunder: bad.some(r => r.code >= 95) };
}

/** stormAhead sonucunun sozlu parcalari. */
export const stormParts = s => [`rüzgar ${kmh(s.wind)}`, `hamle ${kmh(s.gust)}`, s.wave >= 1.5 ? `dalga ${s.wave} m` : '', s.thunder ? 'gök gürültülü fırtına' : ''].filter(Boolean);
/** 0: sakin, 1: sert hava, 2: gok gurultulu firtina. */
export const stormLevel = s => (!s ? 0 : s.thunder ? 2 : 1);

/** Arsiv suzgeci: bos birakilan olcut hepsini kabul eder. Tarih "YYYY-AA-GG..." bicimindedir. */
export const filterCatches = (list, { species = '', month = '', year = '' } = {}, date = c => c.at, name = c => c.species) => list.filter(c =>
    (!species || name(c) === species) && (!month || date(c).slice(5, 7) === month) && (!year || date(c).slice(0, 4) === year));

/** Onceki yillarda bugune yakin gunlerde (±days) tutulan baliklar, en yakin yil once. */
export function anniversaries(catches, now = new Date(), days = 7) {
    const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    return catches.filter(c => {
        if (c.blank || !c.at) return false;
        const [y, m, d] = c.at.slice(0, 10).split('-').map(Number);
        // Yilbasi iki yandan da yakalansin diye komsu yillar da denenir.
        return y < now.getFullYear() && [-1, 0, 1].some(shift => {
            const same = Date.UTC(now.getFullYear() + shift, m - 1, d);
            return now.getFullYear() + shift > y && Math.abs(same - today) <= days * 86400000;
        });
    }).sort((a, b) => b.at.localeCompare(a.at));
}

export const FACTOR_NAMES = { zaman: 'Günün saati', solunar: 'Solunar', basinc: 'Basınç eğilimi', ruzgar: 'Rüzgar', dalga: 'Dalga', deniz_gecmisi: 'Deniz geçmişi', gelgit: 'Su hareketi', gokyuzu: 'Gökyüzü', su_egilimi: 'Su sıcaklığı değişimi', ay: 'Ay evresi' };
const FACTOR_KEYS = Object.keys(FACTOR_NAMES);
export const factorRatios = factors => Object.fromEntries(factors.filter(f => FACTOR_KEYS.includes(f.key) && f.max).map(f => [f.key, Number((f.points / f.max).toFixed(2))]));

/** Hava modelleri arasindaki ruzgar farkindan tahmin guveni (knot). */
export function modelConfidence(series, date) {
    const diffs = series.time.map((t, i) => {
        if (!t.startsWith(date)) return null;
        const v = series.models.map(m => m.wind[i]).filter(isNum);
        return v.length >= 2 ? Math.max(...v) - Math.min(...v) : null;
    }).filter(isNum);
    if (!diffs.length) return null;
    const spread = diffs.reduce((a, b) => a + b, 0) / diffs.length;
    return { spread: Math.round(spread * 1.852), level: spread < 3 ? 'yüksek' : spread < 6 ? 'orta' : 'düşük' };
}

const MARKS = ['iyi', 'kotu', 'ulasilmaz'];
/** Isaretlenmis noktaya yakinlik (~150 m); en yeni isaret gecerlidir. */
export const markNear = (marks, lat, lon) => [...marks].reverse().find(m => Math.hypot((m.lat - lat) * 111320, (m.lon - lon) * 111320 * Math.cos(lat * Math.PI / 180)) <= 150) || null;

// ---- Kayit temizleme ----
const SAFE_ID = /^[A-Za-z0-9_-]{1,60}$/;
const str = (v, n = 300) => String(v ?? '').slice(0, n);
export const validCoord = (lat, lon) => isNum(lat) && isNum(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
const coordOf = x => ({ lat: num(x.lat, 5), lon: num(x.lon, 5) });
const list = (v, fn) => (Array.isArray(v) ? v.filter(x => x && typeof x === 'object' && SAFE_ID.test(x.id)).map(fn).filter(Boolean) : []);

export const FLOORS = { kum: 'kum', tas: 'taş / kaya', yosun: 'yosun / erişte', derin: 'derin' };

/** "#nokta=enlem,boylam,ad" bicimindeki baglantidan nokta; gecersizse null. */
export function parseShared(text) {
    const m = String(text ?? '').match(/#nokta=(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)(?:,([^\s#]*))?/);
    if (!m) return null;
    const lat = Number(Number(m[1]).toFixed(5)), lon = Number(Number(m[2]).toFixed(5));
    if (!validCoord(lat, lon)) return null;
    let name = '';
    try { name = decodeURIComponent(m[3] || ''); } catch { /* bozuk ad yok sayilir */ }
    return { lat, lon, name: name.replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, 80) || 'Gönderilen nokta' };
}

export function sanitizeState(s) {
    const o = s && typeof s === 'object' ? s : {};
    return {
        spots: list(o.spots, x => {
            const c = coordOf(x);
            return validCoord(c.lat, c.lon) && str(x.name).trim() ? { id: x.id, name: str(x.name, 80), ...c, water: x.water === 'tatli' ? 'tatli' : 'tuzlu', note: str(x.note) } : null;
        }),
        catches: list(o.catches, x => {
            if (!str(x.species).trim()) return null;
            const c = coordOf(x);
            return {
                id: x.id, at: str(x.at, 16), species: str(x.species, 80), spot: str(x.spot, 80), ...(validCoord(c.lat, c.lon) ? c : { lat: null, lon: null }),
                length: num(x.length), weight: num(x.weight, 2), count: Math.max(1, Math.round(num(x.count) || 1)), lure: str(x.lure, 120),
                share: ['yakin', 'tam'].includes(x.share) ? x.share : '', shareId: /^[a-f0-9]{24}$/.test(x.shareId || '') ? x.shareId : '',
                released: Boolean(x.released), note: str(x.note), conditions: str(x.conditions), blank: Boolean(x.blank), score: Number.isFinite(x.score) ? Math.max(0, Math.min(100, Math.round(x.score))) : null,
                factors: x.factors && typeof x.factors === 'object' ? Object.fromEntries(Object.entries(x.factors).filter(([k, v]) => FACTOR_KEYS.includes(k) && isNum(v) && v >= 0 && v <= 1)) : null,
                photo: /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(x.photo || '') ? x.photo : ''
            };
        }),
        tackle: list(o.tackle, x => (str(x.name).trim() ? { id: x.id, kind: str(x.kind, 30), name: str(x.name, 100), detail: str(x.detail) } : null)),
        plans: list(o.plans, x => {
            const c = coordOf(x);
            return validCoord(c.lat, c.lon) ? { id: x.id, name: str(x.name, 80), ...c, date: str(x.date, 10), water: x.water === 'tatli' ? 'tatli' : 'tuzlu', technique: str(x.technique, 20), species: str(x.species, 80), score: num(x.score, 0), window: str(x.window, 40) } : null;
        }),
        marks: list(o.marks, x => {
            const c = coordOf(x);
            return validCoord(c.lat, c.lon) && MARKS.includes(x.verdict) ? { id: x.id, ...c, verdict: x.verdict, at: str(x.at, 16) } : null;
        }),
        floors: list(o.floors, x => {
            const c = coordOf(x);
            const tags = Array.isArray(x.tags) ? [...new Set(x.tags.filter(t => Object.hasOwn(FLOORS, t)))] : [];
            return validCoord(c.lat, c.lon) && tags.length ? { id: x.id, ...c, tags, at: str(x.at, 16) } : null;
        }),
        settings: {
            wind: clamp(num(o.settings?.wind) ?? DEFAULT_LIMITS.wind, 8, 34),
            wave: clamp(num(o.settings?.wave, 2) ?? DEFAULT_LIMITS.wave, 0.3, 2.5),
            unit: o.settings?.unit === 'kmh' ? 'kmh' : 'kt',
            alerts: Boolean(o.settings?.alerts),
            alertScore: clamp(num(o.settings?.alertScore, 0) ?? 75, 40, 100)
        }
    };
}

export function mergeState(current, incoming) {
    const merge = (a, b) => [...new Map([...a, ...b].map(x => [x.id, x])).values()];
    const next = sanitizeState(incoming);
    return { spots: merge(current.spots, next.spots), catches: merge(current.catches, next.catches), tackle: merge(current.tackle, next.tackle), plans: merge(current.plans, next.plans), marks: merge(current.marks || [], next.marks), floors: merge(current.floors || [], next.floors), settings: current.settings };
}

// v11 / eski surum yedek bicimi
export function fromLegacy({ customSpots = [], logbook = [] }) {
    return {
        spots: (customSpots || []).map(s => ({ id: s.id, name: s.name, lat: s.lat, lon: s.lon, note: s.whyGo })),
        catches: (logbook || []).map(c => {
            const [lat, lon] = String(c.gps || '').split(',').map(Number);
            const m = String(c.date || '').match(/(\d{2})\.(\d{2})\.(\d{4})\D+(\d{2}):(\d{2})/);
            return { id: c.id, at: m ? `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}` : '', species: c.species, spot: c.mera, lat, lon, lure: c.lure, note: [c.size, c.depth].filter(v => v && v !== '-').join(' • '), conditions: c.weather };
        })
    };
}
