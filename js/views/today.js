// Acilis ekrani: bugun nerede, saat kacta, hangi balik.
import * as C from '../core.js';
import * as api from '../api.js';
import { contextFor, planFor, datesOf } from '../planner.js';
import { speciesActivity, ownEvidence } from '../activity.js';
import { findPlaces, cachedPlaces, seenNearby, distanceKm } from '../places.js';
import { SPECIES, SAMPLE_SPOTS } from '../species.js';
import { ruleFor, inClosedSeason, ruleText } from '../legal.js';
import { cacheGet, cacheSet } from '../store.js';
import * as session from '../session.js';
import { app, $, esc, chips, toast, locate, SAFETY } from '../ui.js';

const REFRESH_MS = 30 * 60000;
let area = null;        // { lat, lon, name }
let result = null;      // { items, week, at, day, notes }
let day = 0;            // 0 bugun, 1 yarin
let busy = false;
let queued = false;
let progress = '';
let nowWeather = null;
let places = '';        // son arama sonuclari (yeniden cizimde korunur)
let searching = '';     // yer aramasi suren bolge
let searchFailed = '';

const span = (a, b) => `${C.hhmm(a)}–${C.hhmm(b)}`;
const dayName = date => new Date(`${date}T12:00`).toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' });
const visible = () => !document.getElementById('view-bugun').hidden;
const typing = () => document.activeElement?.closest?.('#view-bugun [data-form="session"]');
const paint = () => { if (visible() && !typing()) draw(document.getElementById('view-bugun')); };

function defaultArea() {
    const s = app.state.spots[0];
    if (s) return { lat: s.lat, lon: s.lon, name: s.name };
    const [name, lat, lon] = SAMPLE_SPOTS[0];
    return { lat, lon, name: `${name} çevresi` };
}

async function compute() {
    if (busy) { queued = true; return; }
    busy = true;
    const wanted = day;
    try {
        area ||= (await cacheGet('area')) || defaultArea();
        const notes = [];
        loadNow();
        // Yer aramasi yavas olabilir: sonuclar beklemeden gosterilir, yerler gelince yeniden hesaplanir.
        const cached = await cachedPlaces(area.lat, area.lon);
        const found = cached?.list || [];
        const key = `${area.lat},${area.lon}`;
        if (!cached?.fresh && searching !== key && searchFailed !== key) {
            searching = key;
            findPlaces(area.lat, area.lon)
                .then(() => { searching = ''; compute(); }, () => { searching = ''; searchFailed = key; paint(); });
        }
        const mine = app.state.spots.map(s => ({ ...s, mine: true, bonus: 0, km: distanceKm(area.lat, area.lon, s.lat, s.lon) })).filter(s => s.km <= 60);
        const places = [...mine, ...found.filter(p => !mine.some(m => distanceKm(m.lat, m.lon, p.lat, p.lon) < 0.5))].slice(0, 14);
        // Secilen nokta yalnizca gercekten kiyidaysa mera sayilir (ilce merkezi gibi ic noktalar degil).
        if (!places.length) {
            const shore = await api.shoreInfo(area.lat, area.lon).catch(() => null);
            if (shore && shore.wetShare > 0 && shore.elevation <= 15) places.push({ id: 'area', name: `${area.name} (seçilen kıyı noktası)`, lat: area.lat, lon: area.lon, water: 'tuzlu', bonus: 0, km: 0 });
        }

        const month = new Date().getMonth() + 1;
        const seen = await seenNearby(area.lat, area.lon, month).catch(() => { notes.push('Gözlem kayıtları alınamadı.'); return {}; });
        const items = [];
        const week = new Map();
        let stale = 0;
        for (const [n, p] of places.entries()) {
            progress = `Canlı hava ve deniz verisi: ${n + 1}/${places.length}`;
            paint();
            try {
                const salt = p.water !== 'tatli';
                const pack = await api.loadPack(p.lat, p.lon, salt);
                const ageH = (Date.now() - Date.parse(pack.updatedAt)) / 3600000;
                const old = C.dataStatus(pack, Date.now()).ok ? 0 : Math.floor(ageH);
                if (old && !(pack.source === 'önbellek' && ageH <= 24)) { stale++; continue; }
                const shore = await api.shoreInfo(p.lat, p.lon).catch(() => null);
                const ctx = contextFor({ ...p, technique: app.draft.technique }, shore?.bearing ?? null);
                const dates = datesOf(pack);
                if (!dates[wanted]) { stale++; continue; }
                const evidence = { seen: salt ? seen : {}, own: ownEvidence(app.state.catches, p.lat, p.lon, month) };
                dates.slice(0, 7).forEach(date => {
                    const plan = planFor(pack, ctx, date);
                    const w = plan.windows[0];
                    if (w && (!week.has(date) || w.score + p.bonus > week.get(date).rank)) week.set(date, { p, date, w, rank: w.score + p.bonus, confidence: plan.confidence });
                });
                const date = dates[wanted];
                const plan = planFor(pack, ctx, date);
                const fish = speciesActivity(pack, plan.hours, { salt, evidence });
                const top = fish.find(f => !f.closed);
                const rank = plan.allUnsafe || !plan.windows.length ? -1 : plan.score * 0.5 + (top?.score || 0) * 0.5 + p.bonus + Math.min(8, Object.values(evidence.own).reduce((a, b) => a + b, 0) * 2) - p.km / 10;
                const now = pack.rows.find(r => r.time.startsWith(C.localIso(Date.now(), pack.offset).slice(0, 13)));
                // Kiyinin yonu ayni havada yerleri ayirir: hafif karsi/yan ruzgar olumlu, sert karsi ruzgar olumsuz.
                const peak = plan.windows[0]?.peak.row;
                const shoreWind = peak ? C.windToShore(peak.dir, ctx.bearing) : null;
                const exposure = !peak || !shoreWind ? 0 : shoreWind === 'karşıdan' ? (peak.wind > 15 ? -6 : peak.wind >= 5 ? 3 : 0) : shoreWind === 'yandan' ? 1 : 0;
                items.push({ p, date, plan, fish, rank: rank < 0 ? rank : rank + exposure, now, shoreWind, old, source: pack.source });
            } catch { stale++; }
        }
        if (stale) notes.push(`${stale} yer için güncel veri alınamadı.`);
        result = { items: items.sort((a, b) => b.rank - a.rank), week: [...week.values()].sort((a, b) => a.date.localeCompare(b.date)), at: Date.now(), day: wanted, notes };
    } finally {
        busy = false;
        progress = '';
        if (queued) { queued = false; compute(); } else paint();
    }
}

const fishRow = f => `<div class="species${f.closed ? ' closed' : ''}"><b>${esc(f.name)} <span class="mono">${span(f.from, f.to)}</span></b><span class="pill ${f.closed ? 'bad' : f.level === 'yüksek' ? 'ok' : f.level === 'orta' ? 'warn' : 'mute'}">${f.closed ? 'yasak' : f.score}</span>
    <small>${esc(f.why.join(' · '))}</small><small>Yem: ${esc(f.bait)}${ruleFor(f.name) ? ` · ${esc(ruleText(ruleFor(f.name)))}` : ''}</small></div>`;

// Saat seridi: yukseklik av puani, renk guvenlik
const strip = plan => `<div class="hours" role="img" aria-label="Saatlik av puanı">${plan.hours.map(h => `<div title="${C.hhmm(h.row.time)} · ${h.score ?? '--'}"><i class="${h.safety.level}" style="height:${Math.max(6, h.score ?? 0)}%"></i><small>${h.row.time.slice(11, 13)}</small></div>`).join('')}</div>`;
const VERDICT = { go: ['Gidilir', 'ok'], caution: ['Gidilir, dikkatli ol', 'warn'], nogo: ['Gitme', 'bad'], unknown: ['Karar yok', 'mute'] };

// Eski tahminle asla "gidilir" denmez.
const verdictOf = item => (item.old ? [`${item.old} saatlik eski tahmin: güvenlik kararı yok`, 'mute'] : VERDICT[item.plan.windows[0] ? item.plan.windows[0].peak.safety.level : 'nogo']);

async function offlineDownload() {
    if (!navigator.onLine) return toast('İndirme için internet gerekli.', 'bad');
    toast('Yöre verisi indiriliyor…');
    await compute();
    let saved = result?.items.filter(x => !x.old).length || 0;
    for (const s of app.state.spots.slice(0, 20)) {
        try {
            const pack = await api.loadPack(s.lat, s.lon, s.water !== 'tatli');
            await api.shoreInfo(s.lat, s.lon).catch(() => {});
            if (pack.source === 'canlı') saved++;
        } catch { /* alinamayan nokta atlanir */ }
    }
    toast(saved ? `${saved} yer için tahmin kaydedildi. İnternetsiz 24 saate kadar görülebilir; harita görüntüsü inmez.` : 'Veri indirilemedi.', saved ? 'ok' : 'bad');
}

function hero(item) {
    const { p, plan, fish } = item;
    const w = plan.windows[0];
    const [word, cls] = verdictOf(item);
    const top = fish.filter(f => !f.closed).slice(0, 3);
    const factors = w ? [...w.peak.factors].sort((a, b) => b.points / b.max - a.points / a.max) : [];
    const reason = [...factors.slice(0, 3).map(f => ['ok', '✓', f.text]), ...factors.slice(-2).filter(f => f.points / f.max < 0.6).map(f => ['warn', '△', f.text])];
    return `<section class="card hero"><div class="score">
        <div class="ring" style="--p:${plan.score ?? 0}"><b>${plan.score ?? '--'}</b></div>
        <div><p class="verdict ${cls}">${day ? 'Yarın' : 'Bugün'}: ${word}</p><h1>${esc(p.name)}</h1><p class="mono">${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}</p><p class="mute">${p.km.toFixed(1)} km${item.shoreWind ? ` · rüzgar ${item.shoreWind}` : ''}</p></div></div>
        ${w ? `<p class="best">En iyi saat <b>${span(w.from, w.to)}</b>${plan.windows[1] ? ` <span class="mute">· ikinci ${span(plan.windows[1].from, plan.windows[1].to)}</span>` : ''}</p>` : `<p class="bad">${plan.allUnsafe ? 'Güvenli saat yok.' : 'Bugün için saat kalmadı; Yarın’a bakın.'}</p>`}
        ${w?.peak.safety.reasons.length ? `<p class="${cls}">${esc(w.peak.safety.reasons.join(' '))}</p>` : ''}
        ${strip(plan)}
        <div class="chips">${top.map(f => `<span class="chip"><b>${esc(f.name)}</b> ${span(f.from, f.to)} · ${f.score}</span>`).join('')}</div>
        <div class="row wrap"><button class="btn primary" data-act="plan" data-v="${p.id}">Ayrıntılı plan</button><button class="btn" data-act="show" data-v="${p.id}">Haritada</button>${p.mine ? '' : `<button class="btn" data-act="save" data-v="${p.id}">Kaydet</button>`}</div>
        ${reason.length ? `<details><summary>Neden bu puan?</summary>${reason.map(([c, icon, text]) => `<p class="${c}">${icon} ${esc(text)}</p>`).join('')}</details>` : ''}
        ${fish.length ? `<details><summary>Tüm balıklar ve yemler</summary>${fish.slice(0, 8).map(fishRow).join('')}</details>` : ''}</section>`;
}

function placeCard(item, n) {
    const { p, plan, fish } = item;
    const w = plan.windows[0];
    const [word, cls] = verdictOf(item);
    const best = fish.find(f => !f.closed);
    return `<details class="card place"><summary><span><b>${n + 1}. ${esc(p.name)}</b><small>${p.km.toFixed(1)} km · ${w ? span(w.from, w.to) : 'saat yok'}${best ? ` · ${esc(best.name)}` : ''}</small></span><span class="pill ${cls}">${plan.score ?? '--'}</span></summary>
        <p class="${cls}">${word}${w?.peak.safety.reasons.length ? ` — ${esc(w.peak.safety.reasons.join(' '))}` : ''}</p>${strip(plan)}${fish.slice(0, 3).map(fishRow).join('')}
        <div class="row wrap"><button class="btn primary" data-act="plan" data-v="${p.id}">Ayrıntılı plan</button><button class="btn" data-act="show" data-v="${p.id}">Haritada</button>${p.mine ? '' : `<button class="btn" data-act="save" data-v="${p.id}">Kaydet</button>`}</div></details>`;
}

function weatherStrip() {
    const w = nowWeather;
    if (!w) return '';
    const cells = [['Rüzgar', C.kmh(w.r.wind), C.windName(w.r.dir)], ['Hamle', C.kmh(w.r.gust), ''], ['Hava', `${w.r.air ?? '--'}°C`, `yağış ${w.r.precip ?? '--'} mm`], ['Basınç', `${w.r.pressure ?? '--'} hPa`, w.dp === null ? '' : `${w.dp > 0 ? '+' : ''}${w.dp} / 3 sa`], ['Dalga', `${w.r.wave ?? '--'} m`, `su ${w.r.sea ?? '--'}°C`], ['Gelgit', w.tide, ''], ['Ay', `%${w.moon}`, w.moonName]];
    return `<section class="card"><div class="row between"><h2>Şu anki hava</h2><button class="btn primary" data-act="weather">Detaylı hava</button></div>
        <div class="metrics">${cells.map(([k, v, s]) => `<div class="metric"><small>${k}</small><b>${esc(v)}</b><p>${esc(s)}</p></div>`).join('')}</div>
        <p class="mute">${esc(area?.name || '')} · ${w.source} veri ${new Date(w.at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</p></section>`;
}

async function loadNow() {
    const at = area;
    try {
        const pack = await api.loadPack(at.lat, at.lon, true);
        const i = pack.rows.findIndex(r => r.time.startsWith(C.localIso(Date.now(), pack.offset).slice(0, 13)));
        const r = pack.rows[i];
        if (at !== area || !r || !C.dataStatus(pack, Date.now()).ok) return;
        const prev = pack.rows[i - 3], next = pack.rows[i + 1];
        const light = window.SunCalc.getMoonIllumination(new Date());
        nowWeather = {
            r, source: pack.source, at: pack.updatedAt,
            dp: prev?.pressure != null && r.pressure !== null ? C.num(r.pressure - prev.pressure) : null,
            tide: r.level === null || next?.level == null ? '--' : next.level > r.level + 0.005 ? 'Yükseliyor' : next.level < r.level - 0.005 ? 'Çekiliyor' : 'Durgun',
            moon: Math.round(light.fraction * 100), moonName: C.moonName(light.phase)
        };
        paint();
    } catch { /* ana hesap hatayi zaten bildirir */ }
}

function draw(root) {
    const today = new Date().toLocaleDateString('sv-SE');
    const closed = SPECIES.filter(s => inClosedSeason(ruleFor(s.ad), today)).map(s => s.ad);
    const typed = $('[data-form="area"] input', root)?.value || '';
    const open = $('details.area', root)?.open;
    const ready = result && result.day === day;
    root.innerHTML = `
    <div class="row between top"><div><h2>${esc(area?.name || 'Bölge')}</h2><p class="mute">${busy ? esc(progress) : result ? `Güncellendi ${new Date(result.at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}` : ''}</p></div><span class="row"><button class="btn" data-act="download" ${busy ? 'disabled' : ''}>⤓ İndir</button><button class="btn" data-act="refresh" ${busy ? 'disabled' : ''}>Yenile</button></span></div>
    <button class="btn primary big" data-act="explore">⌖ Bölgedeki meraları bul (koordinat, derinlik, dip, balık)</button>
    ${session.card()}
    <div class="row between top">${chips('day', [['0', 'Bugün'], ['1', 'Yarın']], String(day))}</div>
    <details class="card area" ${open || typed ? 'open' : ''}><summary>Bölge değiştir</summary>
        <form class="row search" data-form="area"><input name="q" placeholder="Ör. Bandırma" aria-label="Bölge ara" value="${esc(typed)}"><button class="btn">Ara</button><button type="button" class="btn" data-act="here">Konumum</button></form><div id="areas" class="chips">${places}</div></details>
    ${searching ? '<p class="banner warn">Yakındaki kıyı yerleri aranıyor; sonuçlar hazır olunca genişler.</p>' : ''}
    ${searchFailed ? '<p class="banner warn">Yer arama servisi şu an dolu. Birazdan Yenile deyin.</p>' : ''}
    ${(result?.notes || []).map(n => `<p class="banner warn">${esc(n)}</p>`).join('')}
    ${closed.length ? `<p class="banner bad">Bugün av yasağında: ${esc(closed.join(', '))}</p>` : ''}
    ${!ready || !result.items.length ? `${weatherStrip()}<section class="card">${busy || searching ? 'Hesaplanıyor…' : ready ? 'Seçtiğiniz yer denizden uzakta veya kıyı yeri bulunamadı. Yukarıdaki “Bölgedeki meraları bul” düğmesiyle kıyıyı tarayın.' : 'Henüz veri yok. İnternet bağlantısını kontrol edip Yenile deyin.'}</section>` : `
    <div class="cols"><div>${hero(result.items[0])}${weatherStrip()}</div><div>
    ${result.items.length > 1 ? `<h3>Diğer yerler</h3>${result.items.slice(1, 7).map((x, i) => placeCard(x, i + 1)).join('')}` : ''}
    <section class="card"><h2>Bu hafta en iyi günler</h2>${result.week.map(x => `<button class="window" data-act="weekday" data-v="${x.p.id}|${x.date}"><b>${esc(dayName(x.date))}</b><span class="pill ${SAFETY[x.w.peak.safety.level][1]}">${x.w.score}</span><small>${esc(x.p.name)} · ${span(x.w.from, x.w.to)}</small></button>`).join('') || '<p>Güvenli pencere yok.</p>'}</section></div></div>
    <details class="card"><summary>Bu puanlar ne demek?</summary><p class="mute">Koşulların balığa ve avcılığa ne kadar uyduğuna dair kural tabanlı tahmindir; balık garantisi veya ölçülmüş olasılık değildir. Hava modeli birkaç km çözünürlüklüdür. Yer önerileri OpenStreetMap kayıtlarıdır; avın serbest ve ulaşımın güvenli olduğunu yerinde kontrol edin. Günlüğe av ve boş seans girdikçe puan ağırlıkları size göre ayarlanır.</p></details>`}`;
}

export function render(root) {
    draw(root);
    if (!busy && (!result || result.day !== day || Date.now() - result.at > REFRESH_MS)) compute();
}

/** Uygulama acikken veriyi guncel tutar. */
export function autoRefresh() {
    const tick = () => { if (!document.hidden && navigator.onLine && visible() && !busy && (!result || Date.now() - result.at > REFRESH_MS)) compute(); };
    setInterval(tick, 60000);
    window.addEventListener('online', tick);
    document.addEventListener('visibilitychange', tick);
}

const find = id => result.items.find(x => x.p.id === id)?.p || result.week.find(x => x.p.id === id)?.p;
const draftOf = p => ({ lat: p.lat, lon: p.lon, name: p.name, water: p.water === 'tatli' ? 'tatli' : 'tuzlu', species: '' });

async function setArea(next) {
    area = next;
    places = '';
    result = null;
    nowWeather = null;
    await cacheSet('area', next);
    compute();
}

export const actions = {
    ...session.actions(() => paint()),
    download: () => offlineDownload(),
    explore: () => app.go('kesif', { area: area ? { ...area, name: area.name.replace(/ çevresi$/, '') } : null }),
    weather: () => app.go('hava', { point: area }),
    refresh: () => { searchFailed = ''; compute(); },
    day: v => { day = Number(v); paint(); compute(); },
    here: async () => {
        try { const p = await locate(); await setArea({ lat: p.lat, lon: p.lon, name: 'Konumumun çevresi' }); }
        catch (err) { toast(err.message, 'bad'); }
    },
    goto: v => { const [lat, lon, name] = v.split('|'); setArea({ lat: Number(lat), lon: Number(lon), name: `${name} çevresi` }); },
    plan: v => app.go('plan', { draft: { ...draftOf(find(v)), date: result.items.find(x => x.p.id === v).date } }),
    weekday: v => { const [id, date] = v.split('|'); app.go('plan', { draft: { ...draftOf(find(id)), date } }); },
    show: v => app.go('harita', { focus: find(v) }),
    save: async v => {
        const p = find(v);
        const { persist, uid } = await import('../ui.js');
        const id = uid('spot');
        app.state.spots.push({ id, name: p.name, lat: p.lat, lon: p.lon, water: 'tuzlu', note: 'OpenStreetMap kaydından eklendi.' });
        Object.assign(p, { id, mine: true });
        await persist();
        paint();
        toast('Noktalarıma eklendi.', 'ok');
    }
};

export async function submit(form) {
    const q = form.elements.q.value.trim();
    if (q.length < 2) return;
    try {
        const found = await api.searchPlace(q);
        places = found.map(p => `<button type="button" class="chip" data-act="goto" data-v="${p.lat}|${p.lon}|${esc(p.name.split(',')[0])}">${esc(p.name)}</button>`).join('') || '<span class="mute">Sonuç yok.</span>';
        const box = $('#areas');
        if (box) box.innerHTML = places;
    } catch { toast('Arama yapılamadı.', 'bad'); }
}
