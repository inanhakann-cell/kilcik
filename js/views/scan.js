// Harita altindaki mera taramasi: derinlik + dip yapisi + hava + tur uygunlugu.
import * as C from '../core.js';
import * as api from '../api.js';
import { loadGrid, findSpots, coastSpots, describe } from '../seabed.js';
import { habitat, evaluate } from '../region.js';
import { datesOf } from '../planner.js';
import { seenNearby, restrictedAreas, nearRestricted, coastline } from '../places.js';
import { app, $, esc, chips, toast, uid, persist, download, copy, mapsUrl, SAFETY } from '../ui.js';

const opts = { mode: 'kiyi', day: 0 };
let result = null;
let status = '';
let token = 0;
let view = null; // haritadan: () => { center, radius }, mark: (spots) => void, focus: (spot) => void

export const connect = api_ => { view = api_; };

async function run() {
    const mine = ++token;
    const { center, radius } = view.area();
    const say = text => { if (mine === token) { status = text; paint(); } };
    result = null;
    view.mark([]);
    try {
        say('Deniz derinlik haritası indiriliyor (EMODnet)…');
        const grid = await loadGrid(center.lat, center.lng, radius);
        say('Dip yapısı inceleniyor…');
        await new Promise(r => setTimeout(r, 30));
        // "Ulasilamaz" denenler elenir.
        const here = { lat: center.lat, lon: center.lng, radius };
        const ways = opts.mode === 'kiyi' ? await coastline(center.lat, center.lng, Math.ceil(radius / 1000)).catch(() => null) : null;
        const found = (ways ? coastSpots(grid, ways, { center: here, limit: 16, spacing: 300, mainland: false })
            : findSpots(grid, opts.mode, { center: here, limit: 16 }))
            .filter(s => C.markNear(app.state.marks, s.lat, s.lon)?.verdict !== 'ulasilmaz').slice(0, 10);
        if (!found.length) throw new Error(opts.mode === 'kiyi' ? 'Bu alanda kıyıdan atışa uygun deniz noktası bulunamadı. Haritayı bir kıyıya getirin.' : 'Bu alanda tekne için uygun derinlikte nokta bulunamadı.');
        say('Hava, deniz ve rüzgar verisi alınıyor…');
        const pack = await api.loadPack(center.lat, center.lng, true);
        if (!C.dataStatus(pack, Date.now()).ok) throw new Error('Güncel hava verisi yok; tarama yapılamadı.');
        const date = datesOf(pack)[opts.day];
        const month = Number(date.slice(5, 7));
        const seen = await seenNearby(center.lat, center.lng, month).catch(() => ({}));
        say(`Dip tipi ve tür uygunluğu: ${found.length} nokta…`);
        const bottoms = await Promise.all(found.map(s => habitat(s.lat, s.lon)));
        const spots = found.map((s, i) => evaluate({ spot: s, pack, date, mode: opts.mode, bottom: bottoms[i], seen }))
            .sort((a, b) => b.total - a.total).slice(0, 8);
        if (mine !== token) return;
        result = { spots, date, mode: opts.mode, at: Date.now(), checked: 'bekliyor' };
        // Yavas olabilen alan kontrolu sonuclari bekletmez.
        restrictedAreas(center.lat, center.lng, radius / 1000 + 0.5).then(areas => {
            if (mine !== token || !result) return;
            result.spots.forEach(s => { s.near = nearRestricted(areas, s.stand?.lat ?? s.lat, s.stand?.lon ?? s.lon); });
            result.checked = 'tamam';
            paint();
        }, () => { if (mine === token && result) { result.checked = 'yapılamadı'; paint(); } });
        view.mark(spots);
        say('');
    } catch (err) {
        say(err.name === 'AbortError' ? 'Derinlik servisi yanıt vermedi. Tekrar deneyin.' : err.message);
    }
}

function card(s, n) {
    const go = s.stand || s;
    const [safeText, safeClass] = result.mode === 'tekne'
        ? (s.window ? ['Tahmine göre bot sınırları içinde; resmi uyarıları kontrol edin', 'warn'] : ['Bot için uygun saat yok', 'bad'])
        : SAFETY[s.safe];
    const text = `${s.lat}, ${s.lon}`;
    return `<section class="card" id="scan-${n}"><div class="row between"><h2>${n + 1}. ${result.mode === 'tekne' ? 'Tekne noktası' : 'Kıyı atış noktası'}</h2><span class="pill ${s.total >= 65 ? 'ok' : s.total >= 45 ? 'warn' : 'mute'}">${s.total}</span></div>
        <p class="mono">Balık noktası: <b>${text}</b>${s.stand ? `<br>Durma noktası (yaklaşık): ${s.stand.lat}, ${s.stand.lon} · atış ~${s.stand.cast} m` : ''}</p>
        <p>Derinlik <b>${s.f.depth.toFixed(0)} m</b> · dip: ${s.bottom ? `${esc(s.bottom.name)} <span class="mute">(${s.bottom.scale})</span>` : '<span class="mute">tip verisi yok</span>'}</p>
        <p class="mute">${esc(describe(s.f, result.mode === 'tekne' ? 'tekne' : 'kiyi').join(' · '))} · yapı puanı ${s.structure}${s.shore ? ` · rüzgar ${s.shore}` : ''}${s.own ? ` · yakında ${s.own} av kaydınız` : ''}</p>
        ${s.near?.length ? `<p class="bad">Yakında ${esc(s.near.join(', '))} kaydı var: av yasak veya erişime kapalı olabilir.</p>` : ''}
        ${s.stand && s.stand.elevation > 15 ? '<p class="warn">Kıyının arkası dik görünüyor; ulaşım zor veya tehlikeli olabilir.</p>' : ''}
        <p class="${safeClass}">${esc(safeText)}${s.reasons.length ? ` — ${esc(s.reasons.join(' '))}` : ''}${s.window ? ` · en iyi saat <b>${C.hhmm(s.window.from)}–${C.hhmm(s.window.to)}</b>` : ''}</p>
        <div class="chips">${s.fish.map(f => `<span class="chip"><b>${esc(f.name)}</b> ${C.hhmm(f.from)}–${C.hhmm(f.to)} · ${f.score}</span>`).join('')}</div>
        <div class="row wrap"><a class="btn primary" href="${mapsUrl(go.lat, go.lon)}" target="_blank" rel="noopener">Yol tarifi</a><button class="btn" data-act="sfocus" data-v="${n}">Haritada</button><button class="btn" data-act="scopy" data-v="${n}">Koordinatı kopyala</button><button class="btn" data-act="sweather" data-v="${n}">Hava</button><button class="btn" data-act="ssave" data-v="${n}">Kaydet</button><button class="btn" data-act="slog" data-v="${n}">Av ekle</button></div>
        <div class="row wrap"><span class="mute">Gittiniz mi?</span>${[['iyi', '👍 İyi'], ['kotu', '👎 Kötü'], ['ulasilmaz', '⛔ Ulaşılamıyor']].map(([v, t]) => `<button class="chip${s.mark === v ? ' on' : ''}" data-act="smark" data-v="${n}|${v}">${t}</button>`).join('')}</div></section>`;
}

export function paint() {
    const box = document.getElementById('scan-panel');
    if (!box) return;
    box.innerHTML = `<section class="card hero"><h2>Mera taraması</h2><p>Haritayı bir kıyıya getirin; ekranın ortasından 3–8 km yarıçap derinlik, dip yapısı, rüzgar ve koşullara göre taranır.</p>
        ${chips('smode', [['kiyi', 'Kıyıdan'], ['tekne', 'Tekneden']], opts.mode)}<div class="row">${chips('sday', [['0', 'Bugün'], ['1', 'Yarın']], String(opts.day))}</div>
        <button class="btn primary big" data-act="srun" ${status && !result && status.endsWith('…') ? 'disabled' : ''}>Bu alanı tara</button><p class="${status.endsWith('…') ? 'mute' : 'bad'}">${esc(status)}</p></section>
        ${result ? `<div class="row wrap between"><b>${result.spots.length} nokta · ${new Date(`${result.date}T12:00`).toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' })}</b><button class="btn" data-act="sgpx">GPX indir</button></div>
        <p class="mute">Liman, sanayi ve askeri alan kontrolü: ${result.checked}.</p>
        <div class="cols">${result.spots.map(card).join('')}</div>
        <p class="mute">Puan; dip yapısı, koşullar ve tür uygunluğunun birleşimidir, balık bulunma olasılığı ölçümü değildir. Derinlik hücresi yaklaşık 115 m'dir: tek kaya, batık veya küçük yapı görünmez; seyir için kullanılmaz. Atış mesafesi de bu yüzden yaklaşıktır. Durma noktasına ulaşımın güvenli ve avın serbest olduğunu (liman, askeri alan, korunan alan) yerinde kontrol edin. Kaynak: EMODnet Bathymetry ve Geology.</p>` : ''}`;
}

export const actions = {
    smode: v => { opts.mode = v; token++; result = null; status = ''; view.mark([]); paint(); },
    sday: v => { opts.day = Number(v); token++; result = null; status = ''; view.mark([]); paint(); },
    srun: () => run(),
    sfocus: v => view.focus(result.spots[Number(v)], Number(v)),
    scopy: v => { const s = result.spots[Number(v)]; copy(`${s.lat}, ${s.lon}`, 'Koordinat kopyalandı.'); },
    smark: async v => {
        const [n, verdict] = v.split('|');
        const s = result.spots[Number(n)];
        const same = s.mark === verdict;
        // Ayni noktadaki eski isaret degistirilir; ayni dugme tekrar basilirsa kaldirilir.
        app.state.marks = app.state.marks.filter(m => !C.markNear([m], s.lat, s.lon));
        if (!same) app.state.marks.push({ id: uid('mk'), lat: s.lat, lon: s.lon, verdict, at: new Date().toISOString().slice(0, 16) });
        s.mark = same ? null : verdict;
        await persist();
        paint();
        toast(same ? 'İşaret kaldırıldı.' : 'Kaydedildi; sonraki taramalar bunu dikkate alacak.', 'ok');
    },
    slog: v => { const s = result.spots[Number(v)]; const p = s.stand || s; app.go('gunluk', { lat: p.lat, lon: p.lon, spot: `Tarama noktası ${Number(v) + 1}` }); },
    sweather: v => { const s = result.spots[Number(v)]; app.go('hava', { point: { lat: s.lat, lon: s.lon, name: `Tarama noktası ${Number(v) + 1}` } }); },
    ssave: async v => {
        const s = result.spots[Number(v)];
        app.state.spots.push({ id: uid('spot'), name: `Tarama ${Number(v) + 1} · ${s.f.depth.toFixed(0)} m`, lat: s.lat, lon: s.lon, water: 'tuzlu', note: `${describe(s.f, opts.mode).join(', ')}${s.stand ? ` · durma: ${s.stand.lat}, ${s.stand.lon}` : ''}` });
        await persist();
        toast('Noktalarıma eklendi.', 'ok');
    },
    sgpx: () => {
        const body = result.spots.map((s, i) => `  <wpt lat="${s.lat}" lon="${s.lon}"><name>Tarama ${i + 1}</name><desc>${esc(`${s.f.depth.toFixed(0)} m, puan ${s.total}`)}</desc></wpt>`).join('\n');
        download('kilcik-tarama.gpx', `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="KILCIK" xmlns="http://www.topografix.com/GPX/1/1">\n${body}\n</gpx>`, 'application/gpx+xml');
    }
};
