// 6/2 Numarali Amator Avcilik Tebligi (2024-2028), Cizelge 5 ve 7; degisiklik RG 16/9/2026-33372.
// Kaynak metin 26.11.2026'da mevzuat.gov.tr PDF'inden okundu. Degisebilir: resmi metni kontrol edin.
export const LEGAL_DATE = '26.11.2026';
const KG = 'toplam en fazla 5 kg';
// min: asgari boy (cm); adet: alikonulabilir; yasak: [baslangic, bitis] "AA-GG"
const R = (min, adet, yasak, not = '') => ({ min, adet, yasak, not });
const INLAND = 'Zaman yasağı ile bölgeye göre değişir (Çanakkale, Balıkesir, İstanbul, Ankara grubunda 15 Mart – 15 Haziran).';

export const RULES = {
    'Levrek': R(25, KG),
    'Lüfer / Çinekop': R(18, KG),
    'Palamut': R(25, KG, ['04-01', '08-14']),
    'İstavrit': R(12, KG),
    'Çipura': R(20, KG),
    'Mırmır': R(null, KG, null, 'Tebliğde ayrı satır yok (“Diğer türler”).'),
    'Karagöz / Sargoz': R(21, KG, null, 'Karagöz 18 cm, sargos 21 cm. Tür ayırt edilemiyorsa 21 cm esas alın.'),
    'Kalamar': R(null, KG, null, 'Tebliğde ayrı satır yok (“Diğer türler”).'),
    'Sübye': R(null, KG, null, 'Tebliğde ayrı satır yok (“Diğer türler”).'),
    'Zargana': R(null, KG, null, 'Tebliğde ayrı satır yok (“Diğer türler”).'),
    'Kefal': R(30, KG, null, 'Has ve sarıkulak kefal 30 cm, diğer kefaller 20 cm, Amuderya kefali 35 cm.'),
    'İzmarit': R(null, KG, null, 'Tebliğde ayrı satır yok (“Diğer türler”).'),
    'Sazan': R(40, '5 adet', null, INLAND),
    'Turna': R(40, '5 adet', ['12-15', '03-31']),
    'Sudak': R(26, '10 adet', ['03-15', '04-30']),
    'Yayın': R(90, '1 adet', null, INLAND),
    'Tatlı su levreği': R(18, KG, ['03-15', '04-30']),
    'Alabalık': R(25, '3 adet (doğal alabalık)', ['10-01', '02-28'], 'Gökkuşağı alabalığında boy sınırı yok, 10 adet.'),
    'Tatlı su kefali': R(20, KG, null, 'Akarsularda (orman içi hariç) zaman yasağı yok; göllerde bölgeye göre değişir.')
};

export function ruleFor(name) {
    const q = String(name || '').trim().toLocaleLowerCase('tr-TR');
    if (!q) return null;
    const key = Object.keys(RULES).find(k => k.toLocaleLowerCase('tr-TR').split(' / ').includes(q) || k.toLocaleLowerCase('tr-TR') === q);
    return key ? { name: key, ...RULES[key] } : null;
}

export function inClosedSeason(rule, date) {
    if (!rule?.yasak) return false;
    const md = String(date).slice(5, 10);
    const [a, b] = rule.yasak;
    const end = b === '02-28' ? '02-29' : b;
    return a <= end ? md >= a && md <= end : md >= a || md <= end;
}

const day = md => { const [m, d] = md.split('-').map(Number); return `${d} ${['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'][m - 1]}`; };
export const ruleText = r => [r.min ? `En az ${r.min} cm` : 'Boy sınırı belirtilmemiş', r.adet, r.yasak ? `Yasak: ${day(r.yasak[0])} – ${day(r.yasak[1])}` : ''].filter(Boolean).join(' · ');

/** Kaydedilecek av icin uyarilar. Tebligde %5 kucuk boy toleransi vardir. */
export function catchWarnings(species, length, date) {
    const r = ruleFor(species);
    if (!r) return [];
    const out = [];
    if (r.min && length && length < r.min * 0.95) out.push(`${r.name}: ${length} cm yasal asgari ${r.min} cm'nin altında. Balığı geri bırakın.`);
    if (inClosedSeason(r, date)) out.push(`${r.name}: bu tarih av yasağı döneminde.`);
    return out;
}
