// Tur bazinda saatlik aktivite tahmini. Olasilik degil, kosullarin ture ne kadar uydugunu gosteren puandir.
import { SPECIES } from './species.js';
import { ruleFor, inClosedSeason } from './legal.js';
import { toMs, localIso } from './core.js';

// [safak, gunduz, aksam, gece] agirliklari ve deniz durumu tercihi
const HABIT = {
    'Levrek': [1, 0.35, 0.95, 0.8, 'dalgali'], 'Lüfer / Çinekop': [1, 0.45, 1, 0.55, 'dalgali'], 'Palamut': [1, 0.65, 0.7, 0.1, ''],
    'İstavrit': [0.65, 0.45, 1, 0.9, 'sakin'], 'Çipura': [0.9, 0.8, 0.75, 0.35, ''], 'Mırmır': [0.6, 0.35, 0.95, 1, ''],
    'Karagöz / Sargoz': [0.95, 0.55, 0.95, 0.6, ''], 'Kalamar': [0.55, 0.15, 1, 0.9, 'sakin'], 'Sübye': [0.7, 0.65, 0.95, 0.5, 'sakin'],
    'Zargana': [0.65, 1, 0.55, 0.1, 'sakin'], 'Kefal': [0.7, 1, 0.6, 0.15, 'sakin'], 'İzmarit': [0.7, 1, 0.6, 0.1, ''],
    'Sazan': [1, 0.45, 0.95, 0.8, 'sakin'], 'Turna': [1, 0.65, 0.9, 0.15, ''], 'Sudak': [1, 0.3, 1, 0.7, ''],
    'Yayın': [0.55, 0.15, 0.85, 1, ''], 'Tatlı su levreği': [0.85, 1, 0.75, 0.15, ''], 'Alabalık': [1, 0.6, 0.8, 0.15, ''], 'Tatlı su kefali': [0.75, 1, 0.65, 0.15, '']
};

// Her turun en verimli aylari (genel balikcilik bilgisi); diger sezon aylari daha dusuk agirlik alir.
export const PEAK = {
    'Levrek': [11, 12, 1, 2], 'Lüfer / Çinekop': [9, 10, 11], 'Palamut': [9, 10], 'İstavrit': [9, 10, 11, 12], 'Çipura': [9, 10], 'Mırmır': [6, 7, 8, 9],
    'Karagöz / Sargoz': [5, 6, 9, 10], 'Kalamar': [11, 12, 1], 'Sübye': [3, 4, 5], 'Zargana': [4, 5, 10], 'Kefal': [6, 7, 8, 9], 'İzmarit': [2, 3, 11],
    'Sazan': [5, 6, 9], 'Turna': [11, 3, 4], 'Sudak': [5, 9, 10], 'Yayın': [6, 7, 8], 'Tatlı su levreği': [4, 9, 10], 'Alabalık': [4, 5], 'Tatlı su kefali': [5, 6, 9]
};

export function dayPart(pack, time) {
    const d = pack.days.find(x => x.date === time.slice(0, 10));
    if (!d?.sunrise || !d?.sunset) return 1;
    const mid = toMs(time, pack.offset) + 1800000;
    const sr = toMs(d.sunrise, pack.offset);
    const ss = toMs(d.sunset, pack.offset);
    if (Math.abs(mid - sr) <= 5400000) return 0;
    if (Math.abs(mid - ss) <= 5400000) return 2;
    return mid > sr && mid < ss ? 1 : 3;
}
export const PART_NAMES = ['şafak', 'gündüz', 'akşam', 'gece'];

/**
 * hours: planDay sonucundaki saatler. evidence: { own: {tur: adet}, seen: {tur: gozlem} }
 * Guvensiz saatler hicbir ture onerilmez.
 */
export function speciesActivity(pack, hours, { salt, evidence = {} }) {
    const usable = hours.filter(h => h.score !== null && h.safety.level !== 'nogo');
    if (!usable.length) return [];
    const date = usable[0].row.time.slice(0, 10);
    const month = Number(date.slice(5, 7));
    return SPECIES.filter(s => s.ortam === (salt ? 'tuzlu' : 'tatli') && s.aylar.includes(month)).map(s => {
        const habit = HABIT[s.ad];
        const scored = usable.map(h => {
            const { sea, wave } = h.row;
            const temp = sea === null || sea === undefined ? 0.6 : sea >= s.su[0] && sea <= s.su[1] ? 1 : Math.max(0, 1 - Math.min(Math.abs(sea - s.su[0]), Math.abs(sea - s.su[1])) / 4);
            const part = habit[dayPart(pack, h.row.time)];
            const state = !salt || wave === null || !habit[4] ? 0 : habit[4] === 'dalgali' ? (wave >= 0.3 ? 5 : -4) : (wave <= 0.3 ? 5 : -8);
            // Su sicakligi uymuyorsa diger etkenler telafi edemez.
            const season = PEAK[s.ad].includes(month) ? 1 : 0.55;
            const raw = (0.35 * part + 0.3 * (h.score / 100) + 0.35 * season) * 90 * (0.35 + 0.65 * temp) + state;
            return { h, temp, part, value: raw };
        });
        const own = evidence.own?.[s.ad] || 0;
        const seen = evidence.seen?.[s.ad] || 0;
        const bonus = Math.min(10, own * 3) + Math.min(4, Math.ceil(seen / 3));
        const best = scored.reduce((a, b) => (b.value > a.value ? b : a));
        const score = Math.round(Math.max(0, Math.min(95, best.value + bonus)));
        // En iyi saatin cevresindeki yakin puanli kesintisiz saatler
        let a = scored.indexOf(best), b = a;
        const near = (i, ref) => scored[i] && scored[i].value >= best.value - 7 && Math.abs(toMs(scored[i].h.row.time, pack.offset) - toMs(scored[ref].h.row.time, pack.offset)) === 3600000;
        while (near(a - 1, a) && b - a < 3) a--;
        while (near(b + 1, b) && b - a < 3) b++;
        const why = [`${PART_NAMES[dayPart(pack, best.h.row.time)]} saati`, PEAK[s.ad].includes(month) ? 'en verimli ayları' : 'sezonu ama zirvede değil',
            best.h.row.sea === null || best.h.row.sea === undefined ? '' : `su ${best.h.row.sea}°C ${best.temp >= 0.99 ? 'uygun' : best.temp >= 0.5 ? 'sınırda' : 'uygun değil'}`,
            own ? `yakında ${own} kaydınız var` : '', seen ? `bölgede ${seen} gözlem` : ''].filter(Boolean);
        return {
            name: s.ad, bait: s.yem, techniques: s.t, score, level: score >= 72 ? 'yüksek' : score >= 55 ? 'orta' : 'düşük',
            from: scored[a].h.row.time, to: localIso(toMs(scored[b].h.row.time, pack.offset) + 3600000, pack.offset),
            safety: best.h.safety.level, why, own, seen, closed: inClosedSeason(ruleFor(s.ad), date)
        };
    }).sort((x, y) => Number(x.closed) - Number(y.closed) || y.score - x.score);
}

/** Kullanicinin noktaya yakin (~25 km) av kayitlari ve ayni donemdeki sayilari. */
export function ownEvidence(catches, lat, lon, month) {
    const own = {};
    for (const c of catches) {
        if (c.blank) continue;
        if (c.lat === null || Math.hypot(c.lat - lat, (c.lon - lon) * 0.76) > 0.25) continue;
        const m = Number(c.at.slice(5, 7));
        if (Math.min(Math.abs(m - month), 12 - Math.abs(m - month)) > 1) continue;
        const s = SPECIES.find(x => x.ad.toLocaleLowerCase('tr-TR').split(' / ').includes(c.species.toLocaleLowerCase('tr-TR')) || x.ad.toLocaleLowerCase('tr-TR') === c.species.toLocaleLowerCase('tr-TR'));
        if (s) own[s.ad] = (own[s.ad] || 0) + c.count;
    }
    return own;
}
