// Bolge kesfi ekrani: koordinatli meralar, derinlik kesiti, dip, tur ve saat; ay takvimi ve gozlemler.
import * as C from '../core.js';
import * as api from '../api.js';
import { loadGrid, findSpots, coastSpots, describe } from '../seabed.js';
import { depthProfile, habitat, describePlace, coastalOnly, evaluate } from '../region.js';
import { humanPoints, restrictedAreas, nearRestricted, seenNearby, observations, placeName, coastline, loadRegion, landPack, distanceKm, islandWarning } from '../places.js';
import { datesOf } from '../planner.js';
import { PEAK } from '../activity.js';
import { SPECIES } from '../species.js';
import { ruleFor, ruleText } from '../legal.js';
import { cacheGet, cacheSet } from '../store.js';
import * as guide from '../guide.js';
import { dipLine } from '../dip.js';
import * as extras from '../extras.js';
import { app, $, esc, chips, toast, locate, uid, persist, download, copy, mapsUrl, mapTabs, pill, grade, opened as openFolds, fold, SAFETY } from '../ui.js';

const opts = { radius: 35, day: 0, mode: 'kiyi', quiet: false, sort: 'puan', islands: false };
// Biga ve cevresinin tum anakara kiyisi bu merkez ve yaricapla kapsanir.
const BIGA_COAST = { name: 'Biga kıyıları', lat: 40.40, lon: 27.28 };
let area = null;
let result = null;
let photos = null;
let status = '';
let places = '';
let token = 0;

const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
// Yayimlanmis yerel anlatimlar (26.11.2026'da okundu). Dogrulanmis av istatistigi degildir.
const LOCAL = {
    center: [40.41, 27.30], km: 45,
    notes: [
        ['Mayıs 2009 forum yazıları (Balıkavi)', 'Karabiga girişindeki fenerler ve dalgakıran, İçdaş liman tarafı ve Aksaz önerilmiş. Bir üye Ekim–Kasım’da Değirmencik tarafında 5 kg üzeri levrek olduğunu iddia etmiş. Karides yemli dip ve şamandıra takımı, 18:00–21:00 ve gün doğumu öncesi at-çek anlatılmış; yosun yoğun.', 'https://www.balikavi.net/konu/canakkale-karabiga-sorunu.26243/'],
        ['Haber, 02.11.2025 (Çanakkale Kalem)', 'Karabiga sahilinde Biga Amatör ve Sportif Balıkçılar Derneği ile geleneksel surf casting yarışması düzenlenmiş. Tür ve nokta ayrıntısı verilmemiş.', 'https://www.canakkalekalem.com/karabigada-oltalar-denize-atildi-kiyasiya-mucadele-yasandi/156380']
    ]
};

const el = () => document.getElementById('view-kesif');
const paint = () => { const r = el(); if (r && !r.hidden) draw(r); };

async function cachedHabitat(lat, lon) {
    const key = `dip:${lat.toFixed(4)},${lon.toFixed(4)}`;
    const hit = await cacheGet(key);
    if (hit) return hit;
    const value = await habitat(lat, lon);
    if (value) await cacheSet(key, value);
    return value;
}

async function run() {
    const mine = ++token;
    const say = t => { if (mine === token) { status = t; paint(); } };
    const at = area;
    result = null;
    try {
        say('Bölgenin kıyı, yer adı ve dip bilgisi alınıyor…');
        await loadRegion(at.lat, at.lon).catch(() => {});
        say('Bölgenin derinlik haritası indiriliyor (büyük alanlarda 1 dakika sürebilir)…');
        const grid = await loadGrid(at.lat, at.lon, opts.radius * 1000);
        say('Kıyı boyunca dip yapısı inceleniyor…');
        await new Promise(r => setTimeout(r, 30));
        const around = { lat: at.lat, lon: at.lon, radius: opts.radius * 1000 };
        let ways = null;
        if (opts.mode === 'kiyi') {
            say('Gerçek kıyı çizgisi alınıyor…');
            ways = await coastline(at.lat, at.lon, opts.radius).catch(() => null);
        }
        const approximate = opts.mode === 'kiyi' && !ways;
        // Dar alanda (haritadan tarama) noktalar sik aralikla aranir.
        const near = opts.radius <= 8;
        const candidates = ways ? coastSpots(grid, ways, { center: around, mainland: !near && !opts.islands, spacing: near ? 300 : 1500, ...(near ? { limit: 16 } : {}) })
            : findSpots(grid, opts.mode, { center: around, limit: 80, spacing: near ? 300 : 1800, mainland: !near && !opts.islands });
        const found = candidates
            .filter(s => C.markNear(app.state.marks, s.lat, s.lon)?.verdict !== 'ulasilmaz');
        if (!found.length) throw new Error('Bu yarıçapta uygun kıyı bulunamadı. Yarıçapı büyütün veya kıyıya yakın bir yer seçin.');
        // Eldeki bolge verisindeki yer adlari, harita sunucusu dolu olsa da gorunur.
        const local = landPack(at.lat, at.lon);
        const names = local ? coastalOnly(grid, local.villages.map(([name, lat, lon]) => ({ name, lat, lon }))) : [];
        found.forEach(s => {
            const p = s.stand || s;
            s.profile = depthProfile(grid, s); s.near = []; s.quiet = null;
            s.place = landPack(p.lat, p.lon) === local ? describePlace(names, p.lat, p.lon) : '';
        });
        const month = new Date().getMonth() + 1;
        const seen = await seenNearby(at.lat, at.lon, month).catch(() => ({}));
        // Yakin noktalar ayni hava hucresini paylasir (~8-10 km).
        const packs = new Map();
        const keyOf = s => `${Math.round(s.lat * 12)},${Math.round(s.lon * 10)}`;
        const usable = [];
        for (const [i, s] of found.entries()) {
            say(`Hava ve balık hesabı ${i + 1}/${found.length}…`);
            if (!packs.has(keyOf(s))) packs.set(keyOf(s), await api.loadPack(s.lat, s.lon, true).catch(() => null));
            const pack = packs.get(keyOf(s));
            if (pack && C.dataStatus(pack, Date.now()).ok) usable.push(s);
        }
        if (!usable.length) throw new Error('Hava servisi şu an yanıt vermiyor. Bir iki dakika sonra yeniden tarayın.');
        if (mine !== token) return;
        const bottoms = new Map();
        let checked = 'bekliyor';
        // Once sonuclar gosterilir; yavas servisler geldikce ayni liste zenginlesir.
        const publish = () => {
            const spots = usable.map(s => {
                const pack = packs.get(keyOf(s));
                return evaluate({ spot: s, pack, date: datesOf(pack)[opts.day], mode: opts.mode, bottom: bottoms.get(s) || null, seen });
            }).sort((x, y) => y.total - x.total);
            result = { spots, mode: opts.mode, day: opts.day, at: Date.now(), area: at, checked, approximate };
            paint();
        };
        const source = r => usable.find(x => x.lat === r.lat && x.lon === r.lon);
        publish();
        say('Dip habitatı ve yer adları ekleniyor…');

        const details = Promise.all([
            humanPoints(at.lat, at.lon, opts.radius + 3).catch(() => null),
            restrictedAreas(at.lat, at.lon, opts.radius + 1).catch(() => null)
        ]).then(([people, restricted]) => {
            if (mine !== token) return;
            const coastal = people ? coastalOnly(grid, people.settlements) : [];
            usable.forEach(s => {
                const p = s.stand || s;
                if (restricted) s.near = nearRestricted(restricted, p.lat, p.lon);
                if (!people) return;
                s.place ||= describePlace(coastal, p.lat, p.lon);
                // Bakir adayi: 1.2 km icinde kayitli yerlesim, iskele veya olta yeri yok.
                s.quiet = Boolean(restricted) && !s.near.length && ![...people.settlements, ...people.structures].some(q => distanceKm(p.lat, p.lon, q.lat, q.lon) < 1.2);
            });
            checked = people && restricted ? 'tamam' : 'yapılamadı';
            publish();
        });

        // En yuksek puanli noktalarin habitati once okunur.
        const order = result.spots.map(source);
        for (let i = 0; i < order.length; i += 6) {
            await Promise.all(order.slice(i, i + 6).map(async s => bottoms.set(s, await cachedHabitat(s.lat, s.lon))));
            if (mine !== token) return;
            publish();
            say(`Dip habitatı ${Math.min(i + 6, order.length)}/${order.length}…`);
        }
        await details;
        // Harita servisi doluysa en iyi noktalarin adi tek tek sorulur (saniyede bir istek siniri).
        for (const r of result.spots.slice(0, 12)) {
            const s = source(r);
            if (mine !== token) return;
            if (s.place) continue;
            s.place = await placeName(s.stand?.lat ?? s.lat, s.stand?.lon ?? s.lon).catch(() => '');
            publish();
            await new Promise(res => setTimeout(res, 1100));
        }
        if (mine !== token) return;
        await cacheSet('explore:last', result);
        say('');
    } catch (err) {
        say(err.name === 'AbortError' || err.name === 'TimeoutError' ? 'Veri servisi yanıt vermedi. Daha küçük yarıçapla tekrar deneyin.' : err.message);
    }
}

function card(s, n, open) {
    const go = s.stand || s;
    const name = s.place || 'Mera';
    const key = `${s.lat},${s.lon}`;
    const [safeText, safeClass] = result.mode === 'tekne'
        ? (s.window ? ['Tahmine göre bot sınırları içinde', 'warn'] : ['Bot için uygun saat yok', 'bad'])
        : SAFETY[s.safe];
    return `<section class="card">
        <p class="${safeClass}">${esc(safeText)}${s.reasons.length ? ` — ${esc(s.reasons.join(' '))}` : ''}</p>
        ${s.quiet ? '<p class="ok"><b>Bakir adayı:</b> yakında kayıtlı yerleşim, iskele veya olta yeri yok. Ulaşımı kontrol edin.</p>' : ''}
        ${s.near?.length ? `<p class="bad">Yakında ${esc(s.near.join(', '))} kaydı var: av yasak veya erişime kapalı olabilir.</p>` : ''}
        ${s.fish.slice(0, 3).map(f => `<div class="species"><b>${esc(f.name)} <span class="mono">${C.hhmm(f.from)}–${C.hhmm(f.to)}</span></b>${pill(f.score)}<small>${esc(f.bait)}</small></div>`).join('') || '<p>Güvenli saat yok.</p>'}
        <button type="button" class="btn primary big" data-guide="${go.lat},${go.lon}" data-name="${esc(name)}">Beni oraya götür</button>
        <div class="row wrap"><button class="btn" data-act="map" data-v="${n}">Haritada</button><button class="btn" data-act="save" data-v="${n}">Kaydet</button>${extras.shareButton(go.lat, go.lon, name)}</div>
        ${fold(`dip:${key}`, 'Dip ve derinlik', `${s.dataAt > 150 ? `<p class="warn">Kıyıya yakın bant ölçülmemiş: derinlik ve yapı bilgisi kıyıdan ~${s.dataAt} m açıktan alındı; atış mesafesindeki dibi bilmiyoruz.</p>` : ''}
            <div class="scroll"><table class="moon"><tr><th>Kıyıdan açığa</th>${s.profile.map(p => `<th>${p.m} m</th>`).join('')}</tr><tr><td>Derinlik</td>${s.profile.map(p => `<td><b>${p.depth === null ? '--' : `${p.depth} m`}</b></td>`).join('')}</tr></table></div>
            <p>Noktada <b>${s.f.depth.toFixed(0)} m</b> · dip: <b>${s.bottom ? esc(s.bottom.name) : 'veri yok'}</b>${s.bottom ? ` <span class="mute">(${esc(s.bottom.scale)})</span>` : ''}</p>
            <p class="mute">${esc(describe(s.f, result.mode === 'tekne' ? 'tekne' : 'kiyi').filter(t => !t.includes('kumluk') && !t.includes('taşlık')).join(' · ') || 'belirgin derinlik yapısı yok')}${s.shore ? ` · rüzgar ${s.shore}` : ''}</p>
            ${dipLine(go.lat, go.lon)}${extras.floorChips(go.lat, go.lon)}`, open, 'sub')}
        ${islandWarning(go.lat, go.lon)}
        ${fold(`more:${key}`, 'Diğer', `<p class="mute">Puan ${s.total} · ${esc(result.area.name)} merkezine ${distanceKm(result.area.lat, result.area.lon, s.lat, s.lon).toFixed(1)} km</p>
            <p class="mono">Balık noktası <b>${s.lat}, ${s.lon}</b>${s.stand ? `<br>Durma noktası (kıyı) ${s.stand.lat}, ${s.stand.lon} · atış ~${s.stand.cast} m` : ''}</p>
            <p class="mute">Verimli aylar: ${s.fish.map(f => `${esc(f.name)} (${(PEAK[f.name] || []).map(m => MONTHS[m - 1]).join(', ')})`).join('; ') || '--'}</p>
            <div class="row wrap"><a class="btn" href="${mapsUrl(go.lat, go.lon)}" target="_blank" rel="noopener">Yol tarifi</a><button class="btn" data-act="copy" data-v="${n}">Koordinatı kopyala</button><button class="btn" data-act="weather" data-v="${n}">Hava</button><button class="btn" data-act="log" data-v="${n}">Av ekle</button></div>
            <div class="row wrap"><span class="mute">Gittiniz mi?</span>${[['iyi', '👍 İyi'], ['kotu', '👎 Kötü'], ['ulasilmaz', '⛔ Ulaşılamıyor']].map(([v, t]) => `<button class="chip${s.mark === v ? ' on' : ''}" data-act="mark" data-v="${n}|${v}">${t}</button>`).join('')}</div>`, open, 'sub')}</section>`;
}

// Tum kiyi tek sayfada okunabilsin: her nokta kapali satir, dokununca ayrinti.
function row(s, n, open, folds) {
    const best = s.fish[0];
    return `<details class="card spotrow" data-spot="${n}"${open ? ' open' : ''}><summary><span><b>${n + 1}. ${esc(s.place || `${s.lat}, ${s.lon}`)}</b><small>${best ? `${esc(best.name)} ${C.hhmm(best.from)} · ` : ''}${s.f.depth.toFixed(0)} m${s.bottom ? ` · ${esc(s.bottom.name)}` : ''}${s.quiet ? ' · bakir adayı' : ''}</small></span>${pill(s.total)}</summary>${card(s, n, folds)}</details>`;
}

function calendar() {
    const now = new Date().getMonth() + 1;
    return `<section class="card"><h2>Hangi ayda hangi balık</h2><div class="scroll"><table class="moon">${MONTHS.map((name, i) => {
        const list = SPECIES.filter(s => s.ortam === 'tuzlu' && s.aylar.includes(i + 1));
        return `<tr${i + 1 === now ? ' class="ok"' : ''}><th>${name}</th><td>${list.map(s => (PEAK[s.ad].includes(i + 1) ? `<b>${esc(s.ad)}</b>` : esc(s.ad))).join(', ')}</td></tr>`;
    }).join('')}</table></div><p class="mute">Kalın: en verimli dönem. Genel balıkçılık bilgisidir, bu bölgenin ölçülmüş av istatistiği değildir.</p>
    <details><summary>Yasal sınırlar</summary>${SPECIES.filter(s => s.ortam === 'tuzlu').map(s => `<p class="mute"><b>${esc(s.ad)}:</b> ${esc(ruleText(ruleFor(s.ad)))}</p>`).join('')}</details></section>`;
}

function localNotes() {
    if (!area || distanceKm(area.lat, area.lon, ...LOCAL.center) > LOCAL.km) return '';
    return `<section class="card"><h2>Yörede paylaşılanlar</h2>${LOCAL.notes.map(([title, text, url]) => `<p><b>${esc(title)}</b><br>${esc(text)}<br><a href="${esc(url)}" target="_blank" rel="noopener">Kaynak</a></p>`).join('')}<p class="mute">Kişisel anlatımlardır; eski olabilir ve doğrulanmamıştır. Bölge için ay ay amatör av raporu bulunamadı.</p></section>`;
}

function gallery() {
    const body = photos === null ? 'Yükleniyor…' : photos.error ? 'Gözlem servisine ulaşılamadı.' : !photos.list.length ? 'Bu yarıçapta av türlerine ait fotoğraflı gözlem yok.'
        : `<div class="photos">${photos.list.map(p => `<figure><a href="${esc(p.url)}" target="_blank" rel="noopener"><img src="${esc(p.photo)}" alt="${esc(p.name)}" loading="lazy"></a><figcaption><b>${esc(p.name)}</b><br>${esc(p.date)}<br><span class="mono">${p.lat === null ? '' : `${p.lat}, ${p.lon}`}</span><br><small>${esc(p.by)}</small></figcaption></figure>`).join('')}</div>`;
    return `<section class="card"><h2>Paylaşılan gözlem fotoğrafları</h2>${body}<p class="mute">iNaturalist'te herkese açık gözlemler (av kaydı olmayabilir; konumlar bazen bilerek bulanıklaştırılır). Sosyal medya paylaşımları taranmıyor.</p></section>`;
}

function draw(root) {
    const typed = $('[data-form="explore"] input', root)?.value || '';
    const list = result ? result.spots.map((s, i) => [s, i]).filter(([s]) => !opts.quiet || s.quiet) : [];
    const km = s => distanceKm(result.area.lat, result.area.lon, s.lat, s.lon);
    if (opts.sort === 'yakin') list.sort((a, b) => km(a[0]) - km(b[0]));
    if (opts.sort === 'sira') list.sort((a, b) => a[0].lon - b[0].lon);
    // Yeniden cizimde acik satirlar ve bolumler acik kalsin.
    const opened = new Set([...root.querySelectorAll('details.spotrow[open]')].map(d => Number(d.dataset.spot)));
    const folds = openFolds(root);
    if (typed) folds.add('ayar');
    const busy = status.endsWith('…');
    root.innerHTML = `${mapTabs('kesif')}
    <section class="card hero"><p><b>${esc(area?.name || '…')}</b></p>
        <button class="btn primary big" data-act="near" ${busy ? 'disabled' : ''}>⌖ Bulunduğum yer: çevre kıyılar</button>
        ${fold('ayar', 'Başka bölge ve ayarlar', `<div class="row wrap">${chips('day', [['0', 'Bugün'], ['1', 'Yarın']], String(opts.day))}${chips('mode', [['kiyi', 'Kıyıdan'], ['tekne', 'Tekneden']], opts.mode)}</div>
        <form class="row search" data-form="explore"><input name="q" placeholder="Başka bölge ara" aria-label="Bölge ara" value="${esc(typed)}"><button class="btn">Ara</button></form><div class="chips">${places}</div>
        <p class="mute">Arama yarıçapı</p>${chips('radius', [['5', '5 km'], ['15', '15 km'], ['25', '25 km'], ['35', '35 km'], ['45', '45 km']], String(opts.radius))}
        <label class="check"><input type="checkbox" data-field="islands" ${opts.islands ? 'checked' : ''}> Adaları ve karşı kıyıyı da tara</label>
        <button class="btn big" data-act="run" ${busy ? 'disabled' : ''}>Seçili bölgede meraları bul</button>
        <button class="btn big" data-act="biga" ${busy ? 'disabled' : ''}>Biga ve çevresi: tüm kıyı</button>`, folds, 'sub')}
        <p class="${busy ? 'mute' : 'bad'}" role="status">${esc(status)}</p></section>
    ${result ? `<p><b>${esc(result.area.name)}: ${result.spots.length} nokta</b> <span class="mute">${new Date(result.at).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}${result.day ? ' · yarın için' : ''}</span></p>
        ${fold('suz', 'Süz ve dışa aktar', `${chips('sort', [['puan', 'En iyiler önce'], ['sira', 'Kıyı sırası (batıdan doğuya)'], ['yakin', 'Yakına göre']], opts.sort)}
            <div class="row wrap"><button class="chip${opts.quiet ? ' on' : ''}" data-act="quiet">Yalnız bakir adayları</button><button class="btn" data-act="allmap">Tümü haritada</button><button class="btn" data-act="gpx">GPX</button></div>`, folds)}
        ${Date.now() - result.at > 3 * 3600000 ? '<p class="banner warn">Bu sonuçlar 3 saatten eski. Güncel saat ve güvenlik için yeniden tarayın.</p>' : ''}
        ${result.approximate ? '<p class="banner bad">Gerçek kıyı çizgisi alınamadı: noktalar derinlik verisine göre yaklaşık ve kıyıdan yüzlerce metre açıkta kalabilir. Biraz sonra yeniden tarayın.</p>' : ''}
        ${result.checked === 'yapılamadı' ? '<p class="banner warn">Harita servisi dolu: bakir ve yasaklı alan kontrolü yapılamadı. Biraz sonra yeniden tarayın.</p>' : result.checked === 'bekliyor' ? '<p class="mute">Bakir ve yasaklı alan kontrolü sürüyor…</p>' : ''}
        ${list.map(([s, i]) => row(s, i, opened.has(i), folds)).join('') || '<section class="card">Bu süzgece uyan nokta yok.</section>'}
        <p class="mute">Değerlendirme dip yapısı, habitat, koşullar ve tür uygunluğunun birleşimidir; balığın orada olduğunun ölçümü değildir. Derinlik hücresi ~115 m: tek kaya ve batıklar görünmez, seyir için kullanılmaz.</p>` : ''}
    ${fold('bilgi', 'Bilgi: aylar, yöre yazıları, fotoğraflar', `<div class="cols"><div>${calendar()}</div><div>${localNotes()}${gallery()}</div></div>`, folds)}`;
}

async function loadPhotos() {
    const at = area;
    photos = null;
    const next = await observations(at.lat, at.lon, opts.radius).then(list => ({ list }), () => ({ error: true }));
    if (at === area) { photos = next; paint(); }
}

/** Son taramanin noktalari (harita ekrani icin). */
export async function latest() {
    result ||= (await cacheGet('explore:last')) || null;
    return result?.spots || null;
}

export async function render(root, params = {}) {
    const wanted = params.area || null;
    if (!area || wanted) {
        const last = await cacheGet('explore:last');
        area = wanted || (await cacheGet('area')) || last?.area || { ...BIGA_COAST };
        // Ilce merkezi aramasi denize uzak kalir; Biga icin kiyi merkezi kullanilir.
        if (/^Biga/.test(area.name) && distanceKm(area.lat, area.lon, 40.228, 27.242) < 6) area = { ...BIGA_COAST };
        if (!result && last && distanceKm(last.area.lat, last.area.lon, area.lat, area.lon) < 5) result = last;
        loadPhotos();
    }
    if (params.run) {
        Object.assign(opts, { radius: params.radius, sort: 'puan' });
        status = '';
        run();
    }
    draw(root);
}

const pick = v => result.spots[Number(v)];
export const actions = {
    near: async () => {
        token++; result = null; places = ''; status = 'Konumunuz alınıyor…'; paint();
        try {
            const p = await locate();
            const hub = await api.searchHub(p.lat, p.lon);
            if (hub.none) throw new Error('160 km içinde deniz kıyısı bulunamadı.');
            area = { lat: hub.lat, lon: hub.lon, name: hub.far ? `En yakın kıyı (~${hub.far} km)` : 'Bulunduğum yer' };
            Object.assign(opts, { radius: 25, mode: 'kiyi', islands: false, sort: 'puan' });
            loadPhotos();
            run();
        } catch (err) { status = err.message; paint(); }
    },
    run: () => run(),
    biga: async () => {
        area = { ...BIGA_COAST };
        Object.assign(opts, { radius: 35, mode: 'kiyi', islands: false, sort: 'puan' });
        places = ''; result = null; token++;
        await cacheSet('area', area);
        loadPhotos();
        run();
    },
    radius: v => { opts.radius = Number(v); paint(); loadPhotos(); },
    mode: v => { opts.mode = v; token++; result = null; status = ''; paint(); },
    day: v => { opts.day = Number(v); token++; result = null; status = ''; paint(); },
    quiet: () => { opts.quiet = !opts.quiet; paint(); },
    sort: v => { opts.sort = v; paint(); },
    goto: async v => {
        const [lat, lon, name] = v.split('|');
        area = { lat: Number(lat), lon: Number(lon), name };
        places = ''; result = null; status = ''; token++;
        await cacheSet('area', { ...area, name: `${name} çevresi` });
        paint(); loadPhotos();
    },
    map: v => app.go('harita', { spots: result.spots, show: Number(v) }),
    allmap: () => app.go('harita', { spots: result.spots }),
    copy: v => { const s = pick(v); copy(`${s.lat}, ${s.lon}`, 'Koordinat kopyalandı.'); },
    weather: v => { const s = pick(v); app.go('hava', { point: { lat: s.lat, lon: s.lon, name: s.place || 'Keşif noktası' } }); },
    log: v => { const s = pick(v); const p = s.stand || s; app.go('gunluk', { lat: p.lat, lon: p.lon, spot: s.place || 'Keşif noktası' }); },
    save: async v => {
        const s = pick(v);
        app.state.spots.push({ id: uid('spot'), name: (s.place || `Keşif ${Number(v) + 1}`).slice(0, 80), lat: s.lat, lon: s.lon, water: 'tuzlu', note: `${s.f.depth.toFixed(0)} m, ${s.bottom?.name || 'dip verisi yok'}${s.stand ? ` · durma: ${s.stand.lat}, ${s.stand.lon}` : ''}` });
        await persist();
        toast('Noktalarıma eklendi.', 'ok');
    },
    mark: async v => {
        const [n, verdict] = v.split('|');
        const s = pick(n);
        const same = s.mark === verdict;
        app.state.marks = app.state.marks.filter(m => !C.markNear([m], s.lat, s.lon));
        if (!same) app.state.marks.push({ id: uid('mk'), lat: s.lat, lon: s.lon, verdict, at: new Date().toISOString().slice(0, 16) });
        s.mark = same ? null : verdict;
        await persist();
        paint();
        toast(same ? 'İşaret kaldırıldı.' : 'Kaydedildi; sonraki taramalar dikkate alacak.', 'ok');
    },
    gpx: () => {
        const body = result.spots.map((s, i) => `  <wpt lat="${s.lat}" lon="${s.lon}"><name>${esc(`${i + 1} ${s.place || ''}`.trim())}</name><desc>${esc(`${s.f.depth.toFixed(0)} m, ${s.bottom?.name || ''}, puan ${s.total}`)}</desc></wpt>`).join('\n');
        download('kilcik-bolge.gpx', `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="KILCIK" xmlns="http://www.topografix.com/GPX/1/1">\n${body}\n</gpx>`, 'application/gpx+xml');
    }
};

export function change(field, value) {
    // onay kutusunun degeri her zaman "on" gelir; durum tersine cevrilir
    if (field === 'islands') { opts.islands = !opts.islands; token++; result = null; status = ''; paint(); }
}

export async function submit(form) {
    const q = form.elements.q.value.trim();
    if (q.length < 2) return;
    try {
        const found = await api.searchPlace(q);
        places = found.map(p => `<button type="button" class="chip" data-act="goto" data-v="${p.lat}|${p.lon}|${esc(p.name.split(',')[0])}">${esc(p.name)}</button>`).join('') || '<span class="mute">Sonuç yok.</span>';
        paint();
    } catch { toast('Arama yapılamadı.', 'bad'); }
}
