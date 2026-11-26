// Hava ekrani: secilen noktanin anlik, saatlik, gelgit ve ay verileri; Windy katman haritasi.
import * as C from '../core.js';
import * as api from '../api.js';
import { contextFor, solunarFor, moonFor, datesOf } from '../planner.js';
import { SAMPLE_SPOTS } from '../species.js';
import { cacheGet, cacheSet } from '../store.js';
import { app, $, esc, chips, toast, locate, wind, show, SAFETY } from '../ui.js';

let point = null;   // { lat, lon, name }
let data = null;    // { pack, shore }
let step = 3;
let layer = 'wind';
let chart = null;
let token = 0;
let found_ = '';        // son arama sonuclari

const el = () => document.getElementById('view-hava');
const hm = (ms, pack) => C.localIso(ms, pack.offset).slice(11, 16);
const dayName = d => new Date(`${d}T12:00`).toLocaleDateString('tr-TR', { weekday: 'short', day: 'numeric', month: 'short' });
const sky = c => (c === null ? '' : c >= 95 ? '⛈' : c >= 80 ? '🌦' : c >= 71 && c <= 77 ? '🌨' : c >= 51 ? '🌧' : c >= 45 ? '🌫' : c >= 3 ? '☁' : c >= 1 ? '⛅' : '☀');
// Windy benzeri renk olcegi (km/sa)
const heat = kmh => (kmh === null ? '' : `background:hsl(${Math.max(0, 200 - kmh * 4)} 65% 32%)`);

/** Su seviyesindeki tepe ve dip noktalari. */
export function tideTurns(rows) {
    const out = [];
    for (let i = 1; i < rows.length - 1; i++) {
        const [a, b, c] = [rows[i - 1].level, rows[i].level, rows[i + 1].level];
        if (a === null || b === null || c === null) continue;
        if (b > a && b >= c) out.push({ time: rows[i].time, level: b, type: 'Kabarma' });
        else if (b < a && b <= c) out.push({ time: rows[i].time, level: b, type: 'Çekilme' });
    }
    return out;
}

function moonDay(pack, date) {
    const start = C.toMs(`${date}T00:00`, pack.offset);
    const noon = new Date(start + 43200000);
    const light = window.SunCalc.getMoonIllumination(noon);
    const periods = C.solunar(window.SunCalc, start, point.lat, point.lon);
    // SunCalc gun sinirini cihaz saatine gore alir; yerel gune dusen olaylar secilir.
    const events = key => [-1, 0, 1].map(n => window.SunCalc.getMoonTimes(new Date(noon.getTime() + n * 86400000), point.lat, point.lon)[key])
        .find(t => t && t.getTime() >= start && t.getTime() < start + 86400000);
    const rise = events('rise');
    const set = events('set');
    return {
        name: C.moonName(light.phase), pct: Math.round(light.fraction * 100),
        rise: rise ? hm(rise.getTime(), pack) : '--', set: set ? hm(set.getTime(), pack) : '--',
        major: periods.filter(p => p.type === 'ana').map(p => `${hm(p.at - p.half, pack)}–${hm(p.at + p.half, pack)}`).join(', ') || '--'
    };
}

export async function load(next) {
    if (next) { point = next; found_ = ''; data = null; await cacheSet('weather:point', next); }
    const mine = ++token;
    point ||= (await cacheGet('weather:point')) || (await cacheGet('area')) || app.state.spots[0]
        || { name: SAMPLE_SPOTS[0][0], lat: SAMPLE_SPOTS[0][1], lon: SAMPLE_SPOTS[0][2] };
    draw();
    try {
        const pack = await api.loadPack(point.lat, point.lon, true);
        const shore = await api.shoreInfo(point.lat, point.lon).catch(() => null);
        if (mine !== token) return;
        data = { pack, shore };
        api.modelSpread(point.lat, point.lon).then(models => { if (mine === token) { data.models = models; draw(); } }, () => {});
    } catch (err) {
        if (mine !== token) return;
        data = { error: err.message };
    }
    draw();
}

function nowCards() {
    const { pack, shore } = data;
    const key = C.localIso(Date.now(), pack.offset).slice(0, 13);
    const i = pack.rows.findIndex(r => r.time.startsWith(key));
    const r = pack.rows[i];
    if (!r) return '<p class="banner bad">Kayıtlı veri bu saati kapsamıyor. Yenileyin.</p>';
    const status = C.dataStatus(pack, Date.now());
    const prev = pack.rows[i - 3];
    const dp = prev && prev.pressure !== null && r.pressure !== null ? C.num(r.pressure - prev.pressure) : null;
    const next = pack.rows[i + 1];
    const tide = r.level !== null && next?.level != null ? (next.level > r.level + 0.005 ? 'Su yükseliyor' : next.level < r.level - 0.005 ? 'Su çekiliyor' : 'Su durgun') : '--';
    const turn = tideTurns(pack.rows).find(t => t.time > r.time);
    const moon = moonDay(pack, r.time.slice(0, 10));
    const day = pack.days.find(d => d.date === r.time.slice(0, 10));
    const cards = [
        ['Rüzgar', wind(r.wind), `${C.windName(r.dir)} (${show(r.dir, '°')})`],
        ['Hamle', wind(r.gust), ''],
        ['Basınç', show(r.pressure, ' hPa'), dp === null ? '' : `${dp > 0 ? '+' : ''}${dp} hPa / 3 saat`],
        ['Hava', `${sky(r.code)} ${show(r.air, '°C')}`, `Nem %${show(r.humidity)} · bulut %${show(r.cloud)}`],
        ['Yağış', show(r.precip, ' mm'), `48 saatte ${show(r.rain, ' mm')}`],
        ['Görüş', r.visibility === null ? '--' : `${(r.visibility / 1000).toFixed(0)} km`, ''],
        ['Dalga', show(r.wave, ' m'), `Periyot ${show(r.period, ' sn')}${r.waveEstimated ? ' · tahmin' : ''}`],
        ['Ölü dalga', show(r.swell, ' m'), ''],
        ['Su sıcaklığı', show(r.sea, '°C'), ''],
        ['Akıntı', r.current === null ? '--' : `${(r.current * 1.852).toFixed(1)} km/s`, r.currentDir === null ? '' : `${C.dirCode(r.currentDir)} yönüne`],
        ['Gelgit', tide, turn ? `${turn.type}: ${turn.time.slice(11, 16)} (${turn.level} m)` : ''],
        ['Ay', `${moon.name} %${moon.pct}`, `Doğuş ${moon.rise} · batış ${moon.set}`],
        ['Güneş', day ? `${C.hhmm(day.sunrise)} / ${C.hhmm(day.sunset)}` : '--', 'doğuş / batış']
    ];
    const ctx = contextFor({ ...point, water: 'tuzlu', technique: app.draft.technique }, shore?.bearing ?? null);
    ctx.solunar = solunarFor(pack, ctx, r.time.slice(0, 10));
    ctx.moon = moonFor(pack, r.time.slice(0, 10));
    const scored = C.scoreHour(pack, i, ctx);
    const [safeText, safeClass] = SAFETY[status.ok ? scored.safety.level : 'unknown'];
    // 3.60 m bot icin temkinli sinirlar
    const boatBad = [r.wind > 14 ? 'rüzgar' : '', r.gust >= 17 ? 'hamle' : '', r.wave > 0.6 ? 'dalga' : '', r.code >= 95 ? 'fırtına' : ''].filter(Boolean);
    return `${status.ok ? '' : `<p class="banner bad">${esc(status.message)}</p>`}
    <section class="card"><h2>Şu an ${r.time.slice(11, 13)}:00</h2><div class="metrics">${cards.map(([k, v, sub]) => `<div class="metric"><small>${k}</small><b>${esc(v)}</b><p>${esc(sub)}</p></div>`).join('')}</div></section>
    <section class="card"><h2>Balık için koşullar · ${scored.score ?? '--'}/100</h2>
        ${scored.factors.map(f => { const q = f.points / f.max; return `<div class="factor"><span class="${q >= 0.75 ? 'ok' : q >= 0.45 ? 'warn' : 'bad'}">${q >= 0.75 ? '✓' : q >= 0.45 ? '△' : '✕'} ${esc(f.text)}</span><meter min="0" max="${f.max}" value="${f.points}"></meter></div>`; }).join('')}
        <p class="${safeClass}"><b>Kıyıdan:</b> ${esc(safeText)} ${esc(scored.safety.reasons.join(' '))}</p>
        <p class="${!status.ok ? 'mute' : boatBad.length ? 'bad' : 'ok'}"><b>Küçük botla (3.60 m):</b> ${!status.ok ? 'güncel veri yok' : boatBad.length ? `çıkmayın (${boatBad.join(', ')} sınır üstü)` : 'rüzgar ve dalga sınırların altında; resmi uyarıları kontrol edin'}</p>
        <p class="mute">Kural tabanlı tahmindir. Basınç ve ay etkisinin bilimsel kanıtı sınırlıdır; isabeti Günlük ekranında kendi avlarınızla sınayın.</p></section>`;
}

function table() {
    const { pack } = data;
    const from = C.localIso(Date.now() - 3600000 * step, pack.offset);
    const rows = pack.rows.filter(r => r.time > from && Number(r.time.slice(11, 13)) % step === 0).slice(0, step === 1 ? 72 : 80);
    const km = v => (v === null ? null : Math.round(v * 1.852));
    const line = (label, cell) => `<tr><th>${label}</th>${rows.map(r => { const [v, style = ''] = cell(r); return `<td style="${style}">${v ?? '--'}</td>`; }).join('')}</tr>`;
    return `<table class="meteo"><tbody>
        ${line('Gün', r => [esc(dayName(r.time.slice(0, 10)).split(' ').slice(0, 2).join(' '))])}
        ${line('Saat', r => [r.time.slice(11, 13)])}
        ${line('', r => [sky(r.code)])}
        ${line('Sıcaklık °C', r => [r.air === null ? null : Math.round(r.air)])}
        ${line('Yağış mm', r => [r.precip || '·'])}
        ${line('Rüzgar km/s', r => [km(r.wind), heat(km(r.wind))])}
        ${line('Hamle km/s', r => [km(r.gust), heat(km(r.gust))])}
        ${line('Yön', r => [r.dir === null ? null : `<span class="arrow" style="transform:rotate(${r.dir + 180}deg)">↑</span><br>${C.dirCode(r.dir)}`])}
        ${line('Basınç', r => [r.pressure === null ? null : Math.round(r.pressure)])}
        ${line('Dalga m', r => [r.wave])}
        ${line('Periyot sn', r => [r.period])}
        ${line('Su °C', r => [r.sea])}
        ${line('Su sev. m', r => [r.level])}
        ${line('Bulut %', r => [r.cloud])}
    </tbody></table>`;
}

function windyUrl() {
    const q = new URLSearchParams({ lat: point.lat, lon: point.lon, detailLat: point.lat, detailLon: point.lon, zoom: 8, level: 'surface', overlay: layer, menu: '', message: '', marker: 'true', calendar: 'now', type: 'map', location: 'coordinates', metricWind: 'km/h', metricTemp: '°C' });
    return `https://embed.windy.com/embed2.html?${q}`;
}

function draw() {
    const root = el();
    if (!root || root.hidden) return;
    const typed = $('[data-form="wx"] input', root)?.value || '';
    const ready = data?.pack;
    const turns = ready ? tideTurns(data.pack.rows).filter(t => t.time >= C.localIso(Date.now(), data.pack.offset)).slice(0, 8) : [];
    root.innerHTML = `
    <section class="card"><div class="row between"><h1>${esc(point?.name || 'Hava')}</h1><button class="btn" data-act="refresh">Yenile</button></div>
        <p class="mono">${point ? `${point.lat.toFixed(4)}, ${point.lon.toFixed(4)}` : ''}${ready ? ` · ${data.pack.source} veri ${new Date(data.pack.updatedAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}` : ''}</p>
        <form class="row search" data-form="wx"><input name="q" placeholder="Yer ara" aria-label="Yer ara" value="${esc(typed)}"><button class="btn">Ara</button></form><div id="wx-results" class="chips">${found_}</div>
        <div class="row wrap"><button class="btn" data-act="here">Konumum</button><button class="btn" data-act="pick">Haritadan seç</button><button class="btn primary" data-act="plan">Bu nokta için av planı</button></div>
        ${app.state.spots.length ? chips('spot', app.state.spots.slice(0, 8).map(s => [s.id, s.name]), '') : ''}</section>
    ${!data ? '<section class="card">Hava verisi alınıyor…</section>' : data.error ? `<p class="banner bad">${esc(data.error)}</p>` : `
    <div class="cols"><div>${nowCards()}</div><div>
    <section class="card"><h2>Gelgit (su çekilmesi ve kabarma)</h2><div class="chart"><canvas id="tide"></canvas></div>
        ${turns.map(t => `<div class="item"><span>${esc(dayName(t.time.slice(0, 10)))} ${t.time.slice(11, 16)}</span><b>${t.type} ${t.level} m</b></div>`).join('') || '<p>Bu nokta için su seviyesi verisi yok.</p>'}
        <p class="mute">Model değeridir; Marmara ve Ege'de gelgit küçüktür, rüzgar ve basınç su seviyesini daha çok değiştirebilir. Seyir için kullanılmaz.</p></section>
    <section class="card"><h2>Ay durumu</h2><div class="scroll"><table class="moon"><tr><th>Gün</th><th>Evre</th><th>Doğuş</th><th>Batış</th><th>Ana dönem</th></tr>
        ${datesOf(data.pack).slice(0, 7).map(d => { const m = moonDay(data.pack, d); return `<tr><td>${esc(dayName(d))}</td><td>${m.name} %${m.pct}</td><td>${m.rise}</td><td>${m.set}</td><td>${m.major}</td></tr>`; }).join('')}</table></div></section>
    </div></div>
    ${data.models ? modelCard() : ''}
    <section class="card"><div class="row between"><h2>Saatlik tahmin</h2>${chips('step', [['1', 'Saatlik'], ['3', '3 saatlik']], String(step))}</div><div class="scroll">${table()}</div></section>`}
    ${point ? `<section class="card"><h2>Windy katman haritası</h2>${chips('layer', [['wind', 'Rüzgar'], ['gust', 'Hamle'], ['rain', 'Yağış'], ['pressure', 'Basınç'], ['temp', 'Sıcaklık'], ['waves', 'Dalga'], ['sst', 'Su sıcaklığı'], ['clouds', 'Bulut']], layer)}
        <iframe id="windy" title="Windy haritası" loading="lazy" src="${esc(windyUrl())}"></iframe><p class="mute">Harita windy.com tarafından sunulur (internet gerekir; nokta koordinatı Windy'ye gider).</p></section>` : ''}`;
    drawTide();
    drawModels();
}

function modelCard() {
    const days = datesOf(data.pack).slice(0, 6).map(d => [d, C.modelConfidence(data.models, d)]).filter(x => x[1]);
    return `<section class="card"><h2>Model karşılaştırması: tahmine ne kadar güvenilir?</h2>
        <div class="chips">${days.map(([d, c]) => `<span class="chip ${c.level === 'yüksek' ? 'ok' : c.level === 'orta' ? 'warn' : 'bad'}">${esc(dayName(d))}: ${c.level} (±${c.spread} km/s)</span>`).join('')}</div>
        <div class="chart"><canvas id="models"></canvas></div><p class="mute">ECMWF, GFS ve ICON rüzgarı birbirine yakınsa tahmin daha güvenilirdir.</p></section>`;
}

let modelChart = null;
function drawModels() {
    modelChart?.destroy();
    const canvas = $('#models');
    if (!canvas) return;
    const m = data.models;
    const colors = ['#14b8a6', '#fbbf24', '#a78bfa'];
    modelChart = new window.Chart(canvas, {
        type: 'line',
        data: { labels: m.time.map(t => `${t.slice(8, 10)}.${t.slice(5, 7)} ${t.slice(11, 16)}`), datasets: m.models.map((x, i) => ({ label: `${x.name} (km/s)`, data: x.wind.map(v => (v === null ? null : Math.round(v * 1.852))), borderColor: colors[i], backgroundColor: colors[i], pointRadius: 0, borderWidth: 1.5, tension: 0.3 })) },
        options: { maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { labels: { color: '#cbd5e1', boxWidth: 10 } } }, scales: { x: { ticks: { color: '#94a3b8', maxTicksLimit: 7 } }, y: { beginAtZero: true, ticks: { color: '#94a3b8' } } } }
    });
}

function drawTide() {
    chart?.destroy();
    const canvas = $('#tide');
    if (!canvas || !data?.pack) return;
    const key = C.localIso(Date.now(), data.pack.offset).slice(0, 13);
    const start = Math.max(0, data.pack.rows.findIndex(r => r.time.startsWith(key)));
    const rows = data.pack.rows.slice(start, start + 72);
    chart = new window.Chart(canvas, {
        type: 'line',
        data: { labels: rows.map(r => `${r.time.slice(8, 10)}.${r.time.slice(5, 7)} ${r.time.slice(11, 16)}`), datasets: [{ label: 'Su seviyesi (m)', data: rows.map(r => r.level), borderColor: '#14b8a6', backgroundColor: '#14b8a633', fill: true, pointRadius: 0, tension: 0.4 }] },
        options: { maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { labels: { color: '#cbd5e1' } } }, scales: { x: { ticks: { color: '#94a3b8', maxTicksLimit: 6 } }, y: { ticks: { color: '#94a3b8' } } } }
    });
}

export function render(root, params = {}) {
    if (params.point) return void load(params.point);
    const old = !data?.pack || Date.now() - Date.parse(data.pack.updatedAt) > 30 * 60000;
    if (old) load(); else draw();
}

export const actions = {
    refresh: () => { data = null; load(); },
    here: async () => {
        try { const p = await locate(); load({ lat: p.lat, lon: p.lon, name: `Konumum (±${p.accuracy} m)` }); }
        catch (err) { toast(err.message, 'bad'); }
    },
    pick: () => app.go('harita'),
    plan: () => app.go('plan', { draft: { lat: point.lat, lon: point.lon, name: point.name, water: 'tuzlu', species: '' } }),
    spot: v => { const s = app.state.spots.find(x => x.id === v); load({ lat: s.lat, lon: s.lon, name: s.name }); },
    goto: v => { const [lat, lon, name] = v.split('|'); load({ lat: Number(lat), lon: Number(lon), name }); },
    step: v => { step = Number(v); draw(); },
    layer: (v, root) => {
        // Yalnizca harita yenilenir; sayfa kaymaz.
        layer = v;
        root.querySelectorAll('[data-act="layer"]').forEach(b => b.classList.toggle('on', b.dataset.v === v));
        $('#windy', root).src = windyUrl();
    }
};

export async function submit(form) {
    const q = form.elements.q.value.trim();
    if (q.length < 2) return;
    try {
        const found = await api.searchPlace(q);
        found_ = found.map(p => `<button type="button" class="chip" data-act="goto" data-v="${p.lat}|${p.lon}|${esc(p.name.split(',')[0])}">${esc(p.name)}</button>`).join('') || '<span class="mute">Sonuç yok.</span>';
        const box = $('#wx-results');
        if (box) box.innerHTML = found_;
    } catch { toast('Arama yapılamadı.', 'bad'); }
}
