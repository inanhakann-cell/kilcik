// Acilis ekrani: gidilir mi, nereye, saat kacta, hangi balik.
import * as C from '../core.js';
import * as api from '../api.js';
import { contextFor, planFor, datesOf } from '../planner.js';
import { speciesActivity, ownEvidence } from '../activity.js';
import { findPlaces, cachedPlaces, coastPlaces, onSameLand, seenNearby, distanceKm, nearNames, nearLine } from '../places.js';
import { SPECIES, SAMPLE_SPOTS } from '../species.js';
import { ruleFor, inClosedSeason, ruleText } from '../legal.js';
import { cacheGet, cacheSet } from '../store.js';
import * as session from '../session.js';
import * as install from '../install.js';
import * as extras from '../extras.js';
import { dipLine } from '../dip.js';
import { app, $, esc, chips, toast, locate, persist, uid, grade, pill, opened, fold, WARNINGS_URL } from '../ui.js';

const REFRESH_MS = 30 * 60000;
let area = null;        // { lat, lon, name }
let result = null;      // { items, week, at, day, notes }
let tab = '0';          // '0' bugun, '1' yarin, 'hafta'
let day = 0;
let busy = false;
let queued = false;
let progress = '';
let choosing = false;   // bolge secme kutusu acik mi
let places = '';        // son arama sonuclari (yeniden cizimde korunur)
let searching = '';     // yer aramasi suren bolge
let searchFailed = '';

const span = (a, b) => `${C.hhmm(a)}–${C.hhmm(b)}`;
const dayName = date => new Date(`${date}T12:00`).toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' });
const visible = () => !document.getElementById('view-bugun').hidden;
const typing = () => document.activeElement?.closest?.('#view-bugun [data-form="session"]');
const paint = () => { if (visible() && !typing()) draw(document.getElementById('view-bugun')); };
const wanted = () => app.pref.species || '';

function defaultArea() {
    const s = app.state.spots[0];
    if (s) return { lat: s.lat, lon: s.lon, name: s.name };
    const [name, lat, lon] = SAMPLE_SPOTS[0];
    return { lat, lon, name: `${name} çevresi` };
}

const COMPASS = ['kuzey', 'kuzeydoğu', 'doğu', 'güneydoğu', 'güney', 'güneybatı', 'batı', 'kuzeybatı'];
/** Ayni adi tasiyan yerler yon ve mesafeyle ayirt edilir. */
function distinct(list) {
    const count = list.reduce((m, p) => m.set(p.name, (m.get(p.name) || 0) + 1), new Map());
    return list.map(p => {
        if (count.get(p.name) < 2) return p;
        const bearing = Math.atan2((p.lon - area.lon) * Math.cos(area.lat * Math.PI / 180), p.lat - area.lat) * 180 / Math.PI;
        return { ...p, name: `${p.name} · ${COMPASS[Math.round((bearing + 360) % 360 / 45) % 8]} ${distanceKm(area.lat, area.lon, p.lat, p.lon).toFixed(1)} km` };
    });
}

async function compute() {
    if (busy) { queued = true; return; }
    busy = true;
    const asked = day;
    try {
        area ||= (await cacheGet('area')) || defaultArea();
        const notes = [];
        // Yer aramasi yavas olabilir: sonuclar beklemeden gosterilir, yerler gelince yeniden hesaplanir.
        const cached = await cachedPlaces(area.lat, area.lon);
        const found = cached?.list || [];
        const key = `${area.lat},${area.lon}`;
        if (!cached?.fresh && searching !== key && searchFailed !== key) {
            searching = key;
            findPlaces(area.lat, area.lon)
                .then(() => { searching = ''; compute(); }, () => { searching = ''; searchFailed = key; paint(); });
        }
        const saved = app.state.spots.map(s => ({ ...s, mine: true, bonus: 0, km: distanceKm(area.lat, area.lon, s.lat, s.lon) })).filter(s => s.km <= 60);
        const mine = await onSameLand(area, saved);
        const list = [...mine, ...found.filter(p => !mine.some(m => distanceKm(m.lat, m.lon, p.lat, p.lon) < 0.5))].slice(0, 14);
        // Yer listesi bossa uygulamayla gelen kiyi cizgisinden en yakin noktalar kullanilir (ic noktalar mera sayilmaz).
        if (!list.length) list.push(...await coastPlaces(area.lat, area.lon));
        if (!list.length) {
            const shore = await api.shoreInfo(area.lat, area.lon).catch(() => null);
            if (shore && shore.wetShare > 0 && shore.elevation <= 15) list.push({ id: 'area', name: `${area.name} (seçilen kıyı noktası)`, lat: area.lat, lon: area.lon, water: 'tuzlu', bonus: 0, km: 0 });
        }

        const month = new Date().getMonth() + 1;
        const seen = await seenNearby(area.lat, area.lon, month).catch(() => { notes.push('Gözlem kayıtları alınamadı.'); return {}; });
        const items = [];
        const week = new Map();
        let stale = 0;
        for (const [n, p] of distinct(list).entries()) {
            progress = `Canlı hava ve deniz verisi: ${n + 1}/${list.length}`;
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
                if (!dates[asked]) { stale++; continue; }
                const evidence = { seen: salt ? seen : {}, own: ownEvidence(app.state.catches, p.lat, p.lon, month) };
                dates.slice(0, 7).forEach(date => {
                    const plan = planFor(pack, ctx, date);
                    const w = plan.windows[0];
                    if (w && (!week.has(date) || w.score + p.bonus > week.get(date).rank)) week.set(date, { p, date, w, rank: w.score + p.bonus, confidence: plan.confidence });
                });
                const date = dates[asked];
                const plan = planFor(pack, ctx, date);
                const fish = speciesActivity(pack, plan.hours, { salt, evidence });
                // Hedef balik secildiyse siralama ve ana kart ona gore yapilir.
                const top = fish.find(f => !f.closed && (!wanted() || f.name === wanted()));
                const rank = plan.allUnsafe || !plan.windows.length ? -1 : plan.score * 0.5 + (top?.score || 0) * 0.5 + p.bonus + Math.min(8, Object.values(evidence.own).reduce((a, b) => a + b, 0) * 2) - p.km / 10;
                const now = pack.rows.find(r => r.time.startsWith(C.localIso(Date.now(), pack.offset).slice(0, 13)));
                // Kiyinin yonu ayni havada yerleri ayirir: hafif karsi/yan ruzgar olumlu, sert karsi ruzgar olumsuz.
                const peak = plan.windows[0]?.peak.row;
                const shoreWind = peak ? C.windToShore(peak.dir, ctx.bearing) : null;
                const exposure = !peak || !shoreWind ? 0 : shoreWind === 'karşıdan' ? (peak.wind > 15 ? -6 : peak.wind >= 5 ? 3 : 0) : shoreWind === 'yandan' ? 1 : 0;
                items.push({ p, date, plan, fish, rank: rank < 0 ? rank : rank + exposure, now, shoreWind, old });
            } catch { stale++; }
        }
        if (stale) notes.push(`${stale} yer için güncel veri alınamadı.`);
        result = { items: items.sort((a, b) => b.rank - a.rank), week: [...week.values()].sort((a, b) => a.date.localeCompare(b.date)), at: Date.now(), day: asked, notes };
    } finally {
        busy = false;
        progress = '';
        if (queued) { queued = false; compute(); } else paint();
    }
}

const fishRow = f => `<div class="species${f.closed ? ' closed' : ''}"><b>${esc(f.name)} <span class="mono">${span(f.from, f.to)}</span></b>${f.closed ? '<span class="pill bad">yasak</span>' : pill(f.score)}
    <small>${esc(f.why.join(' · '))}</small><small>Yem: ${esc(f.bait)}${ruleFor(f.name) ? ` · ${esc(ruleText(ruleFor(f.name)))}` : ''}</small></div>`;

// Saat seridi: yukseklik av puani, renk guvenlik
const strip = plan => `<div class="hours" role="img" aria-label="Saatlik av puanı">${plan.hours.map(h => `<div title="${C.hhmm(h.row.time)} · ${h.score ?? '--'}"><i class="${h.safety.level}" style="height:${Math.max(6, h.score ?? 0)}%"></i><small>${Number(h.row.time.slice(11, 13)) % 3 ? '' : h.row.time.slice(11, 13)}</small></div>`).join('')}</div>`;
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

const actionsFor = p => `<button class="btn" data-act="plan" data-v="${p.id}">Ayrıntılı plan</button><button class="btn" data-act="show" data-v="${p.id}">Haritada</button>${p.mine ? '' : `<button class="btn" data-act="save" data-v="${p.id}">Kaydet</button>`}${extras.shareButton(p.lat, p.lon, p.name)}`;

function hero(item, open) {
    const { p, plan, fish, now } = item;
    const w = plan.windows[0];
    const [word, cls] = verdictOf(item);
    const open_ = fish.filter(f => !f.closed);
    const target = wanted() && open_.find(f => f.name === wanted());
    const top = target ? [target, ...open_.filter(f => f !== target)].slice(0, 3) : open_.slice(0, 3);
    const best = target || w;
    const factors = w ? [...w.peak.factors].sort((a, b) => b.points / b.max - a.points / a.max) : [];
    const reason = [...factors.slice(0, 3).map(f => ['ok', '✓', f.text]), ...factors.slice(-2).filter(f => f.points / f.max < 0.6).map(f => ['warn', '△', f.text])];
    const floor = extras.floorText(p.lat, p.lon);
    return `<section class="card hero"><p class="verdict ${cls}">${day ? 'Yarın' : 'Bugün'}: ${word}</p><h1>${esc(p.name)}</h1>
        ${nearLine(p.lat, p.lon)}
        <p class="mute">${p.km.toFixed(1)} km · şans: <b class="${grade(plan.score)[1]}">${grade(plan.score)[0]}</b>${floor ? ` · dip: ${esc(floor)}` : ''}</p>
        ${best ? `<p class="best"><span class="when">${span(best.from, best.to)}</span>${target ? `<span class="mute">${esc(target.name)} için en iyi saat</span>` : ''}</p>` : `<p class="bad">${plan.allUnsafe ? 'Güvenli saat yok.' : 'Bugün için saat kalmadı; Yarın’a bakın.'}</p>`}
        ${wanted() && !target ? `<p class="warn">${esc(wanted())} bu gün için uygun görünmüyor.</p>` : ''}
        ${top.length ? `<p class="fish">${top.map(f => esc(f.name)).join(' · ')}</p><p class="mute">Yem: ${esc(top[0].bait)}</p>` : ''}
        ${dipLine(p.lat, p.lon)}
        ${now ? `<p class="weather">Şu an: rüzgar ${C.kmh(now.wind)} ${esc(C.windName(now.dir))}${now.wave == null ? '' : ` · dalga ${now.wave} m`} · ${now.air ?? '--'}°C</p>` : ''}
        ${w?.peak.safety.reasons.length ? `<p class="${cls}">${esc(w.peak.safety.reasons.join(' '))} <a href="${WARNINGS_URL}" target="_blank" rel="noopener">Resmi uyarılar</a></p>` : ''}
        <button type="button" class="btn primary big" data-guide="${p.lat},${p.lon}" data-name="${esc(p.name)}">Beni oraya götür</button>
        ${session.active() ? '' : '<button type="button" class="btn big" data-act="sesstart">● Ava başladım</button>'}
        ${fold('why', 'Ayrıntı', `<p>Puan <b>${plan.score ?? '--'}/100</b>${plan.windows[1] ? ` · ikinci saat ${span(plan.windows[1].from, plan.windows[1].to)}` : ''}${item.shoreWind ? ` · rüzgar ${item.shoreWind}` : ''}</p><p class="mono">${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}</p>${strip(plan)}
            ${reason.map(([c, icon, text]) => `<p class="${c}">${icon} ${esc(text)}</p>`).join('')}${fish.slice(0, 8).map(fishRow).join('')}
            <div class="row wrap">${actionsFor(p)}</div>${extras.floorChips(p.lat, p.lon)}
            <p class="mute">Puan, koşulların balığa ne kadar uyduğuna dair kural tabanlı tahmindir; balık garantisi değildir. Avın serbest ve ulaşımın güvenli olduğunu yerinde kontrol edin.</p>`, open, 'sub')}</section>`;
}

function placeRow(item, open) {
    const { p, plan, fish } = item;
    const w = plan.windows[0];
    const [word, cls] = verdictOf(item);
    const best = fish.find(f => !f.closed);
    const near = nearNames(p.lat, p.lon, 1)[0];
    return `<details class="card place" data-keep="${esc(p.id)}"${open.has(p.id) ? ' open' : ''}><summary><span><b>${esc(p.name)}</b>${near ? `<small>Yakını: ${esc(near.text)}</small>` : ''}<small>${p.km.toFixed(1)} km · ${w ? span(w.from, w.to) : 'saat yok'}${best ? ` · ${esc(best.name)}` : ''}</small></span>${pill(plan.score)}</summary>
        <p class="${cls}">${word}${w?.peak.safety.reasons.length ? ` — ${esc(w.peak.safety.reasons.join(' '))}` : ''}</p>${strip(plan)}${fish.slice(0, 3).map(fishRow).join('')}
        <div class="row wrap"><button type="button" class="btn primary" data-guide="${p.lat},${p.lon}" data-name="${esc(p.name)}">Beni götür</button>${actionsFor(p)}</div></details>`;
}

const weekCard = () => `<section class="card"><h2>Bu hafta en iyi günler</h2>${result.week.map(x => `<button class="window" data-act="weekday" data-v="${x.p.id}|${x.date}"><b>${esc(dayName(x.date))}</b><span class="pill ${x.w.peak.safety.level === 'go' ? grade(x.w.score)[1] : 'warn'}">${grade(x.w.score)[0]}</span><small>${esc(x.p.name)} · ${span(x.w.from, x.w.to)}${x.w.peak.safety.level === 'go' ? '' : ' · dikkat'}</small></button>`).join('') || '<p>Güvenli pencere yok.</p>'}<p class="mute">İleri günlerin tahmin güveni düşer.</p></section>`;

function draw(root) {
    const today = new Date().toLocaleDateString('sv-SE');
    const fresh = app.state.spots.some(s => s.water === 'tatli');
    const closed = SPECIES.filter(s => (fresh || s.ortam === 'tuzlu') && inClosedSeason(ruleFor(s.ad), today)).map(s => s.ad);
    const typed = $('[data-form="area"] input', root)?.value || '';
    const open = opened(root);
    const ready = result && result.day === day;
    const first = ready && result.items.length ? result.items[0] : null;
    const rest = first ? result.items.slice(1, 4) : [];
    const body = tab === 'hafta' && result ? weekCard() : `
        ${first ? hero(first, open) : `<section class="card">${busy || searching ? 'Hesaplanıyor…' : ready ? 'Seçtiğiniz yer denizden uzakta veya kıyı yeri bulunamadı. “Tüm meralar” ile kıyıyı tarayın.' : 'Henüz veri yok. İnternet bağlantısını kontrol edip yenileyin.'}</section>${session.active() ? '' : session.card()}`}
        ${closed.length ? `<p class="banner bad">Bugün av yasağında: ${esc(closed.join(', '))}</p>` : ''}
        ${rest.length ? `<h3>Başka yerler</h3>${rest.map(x => placeRow(x, open)).join('')}` : ''}`;
    root.innerHTML = `
    <div class="row between top"><button type="button" class="area-btn" data-act="areas" aria-expanded="${choosing}">${esc((area?.name || 'Bölge').replace(/^Konumumun çevresi$/, 'Konumum').replace(/ çevresi$/, ''))} ▾</button><span class="row"><button class="btn icon" data-act="refresh" aria-label="Yenile" title="Yenile" ${busy ? 'disabled' : ''}>⟳</button><button class="btn only-phone" data-nav="daha">☰ Menü</button></span></div>
    <p class="mute">${busy ? esc(progress) : result ? `Güncellendi ${new Date(result.at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}` : ''}${searching ? ' · yakındaki yer adları aranıyor' : ''}</p>
    ${choosing ? `<section class="card"><h2>Bölge değiştir</h2><form class="row search" data-form="area"><input name="q" placeholder="Ör. Bandırma" aria-label="Bölge ara" value="${esc(typed)}"><button class="btn">Ara</button></form><div id="areas" class="chips">${places}</div>
        <div class="row wrap"><button type="button" class="btn" data-act="here">Konumum</button><button type="button" class="btn" data-act="download" ${busy ? 'disabled' : ''}>İnternetsiz için indir</button></div></section>` : ''}
    ${session.active() ? session.card() : ''}
    <div class="row top">${chips('day', [['0', 'Bugün'], ['1', 'Yarın'], ['hafta', 'Hafta']], tab)}</div>
    ${(result?.notes || []).map(n => `<p class="banner warn">${esc(n)}</p>`).join('')}
    ${searchFailed ? '<p class="banner warn">Yer arama servisi şu an yanıt vermiyor; iskele ve mendirek adları eksik olabilir.</p>' : ''}
    <div class="cols"><div>${body}</div><div>
    <button class="btn big" data-act="explore">⌖ Tüm meralar</button>
    <button class="btn big" data-act="weather">Hava ayrıntısı</button>
    ${extras.backupCard()}${install.card()}</div></div>`;
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

// Baslangic tercihleri degisince yeniden hesaplanir.
window.addEventListener('kilcik:pref', e => {
    if (e.detail.place) area = e.detail.place;
    result = null;
});

const find = id => result.items.find(x => x.p.id === id)?.p || result.week.find(x => x.p.id === id)?.p;
const draftOf = p => ({ lat: p.lat, lon: p.lon, name: p.name, water: p.water === 'tatli' ? 'tatli' : 'tuzlu', species: wanted() });

async function setArea(next) {
    area = next;
    places = '';
    result = null;
    choosing = false;
    await cacheSet('area', next);
    paint();
    compute();
}

export const actions = {
    ...session.actions(() => paint()),
    areas: () => { choosing = !choosing; paint(); },
    download: () => offlineDownload(),
    explore: () => app.go('harita', { area }),
    weather: () => app.go('hava', { point: area }),
    refresh: () => { searchFailed = ''; compute(); },
    day: v => { tab = v; if (v !== 'hafta') day = Number(v); paint(); compute(); },
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
