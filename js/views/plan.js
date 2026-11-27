// Plan akisi: secim -> gercek verilerle analiz -> sonuc.
import * as C from '../core.js';
import * as api from '../api.js';
import { TECHNIQUES, SPECIES, LEGAL_URL } from '../species.js';
import { contextFor, planFor, datesOf, solunarFor, icsFile } from '../planner.js';
import { ruleFor, ruleText, inClosedSeason } from '../legal.js';
import { ask } from '../ai.js';
import { shareCard } from '../share.js';
import { speciesActivity, ownEvidence } from '../activity.js';
import { seenNearby, islandWarning } from '../places.js';
import * as extras from '../extras.js';
import { app, $, esc, uid, show, wind, options, chips, toast, download, copy, locate, persist, mapsUrl, grade, pill, opened, fold, SAFETY, windPaint } from '../ui.js';

let result = null;
let chart = null;
let run = 0;
let weather = null;
let trend = 'sicaklik';

const CHECK = {
    ortak: ['Telefon şarjlı, yakınlarınız yerinizi biliyor', 'Kaymaz ayakkabı ve kafa lambası', 'Su, yağmurluk, ilk yardım', 'Kerpeten, makas, cetvel (boy kontrolü)', 'Çöp poşeti: misina bırakmayın'],
    spin: ['Rapala / kaşık kutusu', 'FC lider', 'Livar veya askı'], hafif: ['Küçük sahte ve jighead', 'İnce lider'], lrf: ['Mikro silikon, jighead', 'Işıklı nokta planı'],
    shorejig: ['Metal jigler ve assist iğne', 'Kalın lider'], dip: ['Yem ve yem soğutucu', 'Kurşun, köstek, kamış sehpası', 'Zil / ışıklı alarm'], samandira: ['Şamandıra, fırdöndü, yem'], eging: ['Egi çeşitleri', 'Uzun saplı kakıç / kepçe'], fly: ['Sinek kutusu, tippet']
};

const todayIso = (offset = 0) => new Date(Date.now() + offset * 86400000).toLocaleDateString('sv-SE');
const dayLabel = i => new Date(Date.now() + i * 86400000).toLocaleDateString('tr-TR', { weekday: 'short', day: 'numeric', month: 'short' });

export const defaultDraft = () => ({ water: 'tuzlu', technique: 'spin', setup: '', lat: null, lon: null, name: '', date: todayIso(), species: '' });

export function render(root) {
    if (result) return renderResult(root);
    const d = app.draft;
    if (d.date < todayIso()) d.date = todayIso();
    const targets = SPECIES.filter(s => s.ortam === d.water);
    const setups = app.state.tackle.filter(t => t.kind === 'Takım');
    const open = opened(root);
    root.innerHTML = `
    <section class="card"><h2>Nerede?</h2>
        <p class="pick">${d.lat === null ? 'Henüz nokta seçilmedi.' : `<strong>${esc(d.name || 'Seçilen nokta')}</strong><br><span class="mono">${d.lat.toFixed(5)}, ${d.lon.toFixed(5)}</span>`}</p>
        <div class="row"><button class="btn" data-act="here">Konumum</button><button class="btn" data-act="pickmap">Haritadan seç</button></div>
        ${app.state.spots.length ? `<label>Kayıtlı noktalarım<select data-field="spot">${options([['', 'Seçin…'], ...app.state.spots.map(s => [s.id, s.name])], '')}</select></label>` : ''}</section>
    <section class="card"><h2>Ne zaman?</h2>
        <div class="grid2"><label>Gün<select data-field="date">${options(Array.from({ length: 14 }, (_, i) => [todayIso(i), i === 0 ? `Bugün, ${dayLabel(i)}` : i === 1 ? `Yarın, ${dayLabel(i)}` : dayLabel(i)]), d.date)}</select></label>
        <label>Hedef tür<select data-field="species">${options([['', 'Fark etmez'], ...targets.map(s => [s.ad, s.ad])], d.species)}</select></label></div></section>
    ${fold('takim', `Su ve teknik: ${d.water === 'tatli' ? 'tatlı su' : 'deniz kıyısı'}, ${esc(TECHNIQUES.find(t => t.id === d.technique)?.ad || '')}`, `${chips('water', [['tuzlu', 'Deniz kıyısı'], ['tatli', 'Tatlı su']], d.water)}<p class="mute">Teknik</p>${chips('technique', TECHNIQUES.map(t => [t.id, t.ad]), d.technique)}
        ${setups.length ? `<label>Kayıtlı takım<select data-field="setup">${options([['', '—'], ...setups.map(s => [s.id, s.name])], d.setup)}</select></label>` : ''}`, open)}
    <button class="btn primary big" data-act="analyse" ${d.lat === null ? 'disabled' : ''}>Planı oluştur</button>`;
}

async function analyse(root) {
    const d = { ...app.draft };
    const salt = d.water === 'tuzlu';
    const mine = ++run;
    root.innerHTML = '<section class="card"><h2>Plan hazırlanıyor</h2><ul class="steps"></ul></section>';
    const list = $('.steps', root);
    // Her satir gercek bir istek veya hesaptir; sonucu neyse o isaretlenir.
    const step = async (label, job) => {
        const li = document.createElement('li');
        li.textContent = label;
        list.append(li);
        try { const v = await job(); li.className = 'done'; return v; }
        catch (err) { li.className = 'fail'; li.textContent = `${label}: alınamadı`; return { error: err }; }
    };
    const pack = await step(salt ? 'Hava, dalga, akıntı ve su seviyesi' : 'Hava verisi', () => api.loadPack(d.lat, d.lon, salt));
    if (mine !== run) return;
    if (pack.error) { toast(pack.error.message, 'bad'); return render(root); }
    const shore = await step('Kıyının yönü (yükseklik modeli)', () => api.shoreInfo(d.lat, d.lon));
    const front = salt ? await step('Çevredeki su sıcaklığı farkı', () => api.sstFront(d.lat, d.lon)) : null;
    const ctx = contextFor(d, shore.error ? null : shore.bearing);
    await step('Ay geçişleri ve solunar dönemler', async () => solunarFor(pack, ctx, d.date));
    if (mine !== run) return;

    result = { d, pack, ctx, shore: shore.error ? null : shore, front: front?.error ? null : front, fish: undefined, chl: undefined, answer: '' };
    setDay(d.date);
    renderResult(root);
    api.modelSpread(d.lat, d.lon).then(m => { if (mine === run && result) { result.models = m; paintConfidence(); } }, () => {});
    seenNearby(d.lat, d.lon, Number(d.date.slice(5, 7))).then(seen => { if (mine === run && result) { result.seen = seen; for (const [sel, count] of [['#activity', 3], ['#activity-all', 8]]) { const el = $(sel); if (el) el.innerHTML = activityHtml(count); } } }, () => {});
    if (salt) api.chlorophyll(d.lat, d.lon).then(v => v, () => null).then(v => { if (mine === run && result) { result.chl = v; const el = $('#metrics'); if (el) el.innerHTML = metrics(); } });
    api.nearbyFish(d.lat, d.lon).then(f => f, () => null).then(f => { if (mine === run && result) { result.fish = f; paintFish(); } });
}

function setDay(date) {
    result.d.date = date;
    result.periods = solunarFor(result.pack, result.ctx, date);
    result.plan = planFor(result.pack, result.ctx, date);
    result.sel = result.plan.windows[0]?.peak.row.time || result.plan.hours[0]?.row.time || null;
}

const span = w => `${C.hhmm(w.from)}–${C.hhmm(w.to)}`;

function paintFish() {
    const box = $('#fish');
    if (!box) return;
    const f = result.fish;
    box.innerHTML = f === undefined ? 'Aranıyor…' : f === null ? 'Gözlem servisine ulaşılamadı.' : !f.length ? '40 km çevrede kayıtlı balık gözlemi yok.'
        : `<div class="chips">${f.map(x => `<a class="chip" href="${esc(x.url)}" target="_blank" rel="noopener" title="${esc(x.latin)}">${esc(x.name)} <small>${x.count}</small></a>`).join('')}</div>`;
}

function metrics() {
    const { pack, shore, ctx, front, periods } = result;
    const i = pack.rows.findIndex(r => r.time === result.sel);
    const r = pack.rows[i];
    if (!r) return '';
    const prev = pack.rows[i - 3];
    const dp = prev && r.pressure !== null && prev.pressure !== null ? C.num(r.pressure - prev.pressure) : null;
    const next = pack.rows[i + 1];
    const tide = r.level !== null && next && next.level !== null ? (next.level > r.level + 0.005 ? 'yükseliyor' : next.level < r.level - 0.005 ? 'alçalıyor' : 'durgun') : null;
    const day = pack.days.find(x => x.date === r.time.slice(0, 10));
    const noon = new Date(C.toMs(`${r.time.slice(0, 10)}T12:00`, pack.offset));
    const moon = window.SunCalc.getMoonIllumination(noon);
    const clock = ms => C.localIso(ms, pack.offset).slice(11, 16);
    const sol = periods.map(p => `${p.type === 'ana' ? 'Ana' : 'Ara'} ${clock(p.at - p.half)}–${clock(p.at + p.half)}`).join(', ') || '--';
    const all = [
        ['Rüzgar', wind(r.wind), 'Saatlik ortalama, 10 m yükseklikte.', windPaint(r.wind)],
        ['Hamle', wind(r.gust), 'Ani rüzgar tepe değeri. 45 km/sa üstü atışı zorlaştırır.', windPaint(r.gust)],
        ['Rüzgar yönü', `${C.windName(r.dir)} (${show(r.dir, '°')})`, 'Rüzgarın geldiği yön.'],
        ['Kıyıya göre rüzgar', C.windToShore(r.dir, ctx.bearing) || '--', ctx.bearing === null ? 'Kıyı yönü bu noktada belirlenemedi.' : `Deniz yaklaşık ${C.dirCode(ctx.bearing)} yönünde (yükseklik modelinden tahmin).`],
        ...(ctx.salt ? [
            ['Dalga', show(r.wave, ' m') + (r.waveEstimated ? ' (tahmin)' : ''), 'Açık deniz model değeri; koy içinde farklı olabilir.'],
            ['Dalga periyodu', show(r.period, ' sn'), 'Uzun periyot, kıyıda daha güçlü ve seyrek büyük dalga demektir.'],
            ['Ölü dalga', show(r.swell, ' m'), 'Uzaktaki fırtınadan gelen dalga.'],
            ['Su sıcaklığı', show(r.sea, ' °C'), 'Deniz yüzeyi.'],
            ['Sıcaklık farkı', show(front, ' °C'), '15 km çevredeki en yüksek farkı (şu an). Büyük fark yem balığını toplayabilir.'],
            ['Akıntı', show(r.current, ' kt') + (r.currentDir === null ? '' : ` ${C.dirCode(r.currentDir)}`), 'Model akıntısı; kıyı dibinde güvenilirliği düşüktür.'],
            ['Su seviyesi', show(r.level, ' m'), 'Gelgit dahil model seviyesi. Seyir için kullanılmaz.'],
            ['Gelgit hareketi', tide || '--', 'Su hareket ederken beslenme artabilir.']
        ] : []),
        ['Basınç', show(r.pressure, ' hPa'), 'Deniz seviyesine indirgenmiş.'],
        ['Basınç eğilimi', dp === null ? '--' : `${dp > 0 ? '+' : ''}${dp} hPa/3sa`, 'Yavaş düşüş genelde olumlu sayılır.'],
        ['Hava', show(r.air, ' °C'), 'Hava sıcaklığı.'],
        ['Nem', show(r.humidity, ' %'), 'Bağıl nem.'],
        ['Bulut', show(r.cloud, ' %'), 'Bulutlu hava balığı sığa çekebilir.'],
        ['Yağış (48 sa)', show(r.rain, ' mm'), 'Son 48 saat toplamı; dere ağızlarında bulanıklığı etkiler.'],
        ['Görüş', r.visibility === null ? '--' : `${(r.visibility / 1000).toFixed(1)} km`, 'Sis kontrolü.'],
        ['Solunar', sol, 'Ana: ay tepede veya tam altta. Ara: ay doğuşu/batışı. Bilimsel kanıtı sınırlıdır.'],
        ['Ay', `${C.moonName(moon.phase)} %${Math.round(moon.fraction * 100)}`, 'Ay evresi ve aydınlanma.'],
        ...(ctx.salt ? [
            ['Klorofil', result.chl ? `${result.chl.value.toFixed(2)} mg/m³` : result.chl === undefined ? 'aranıyor…' : '--', result.chl ? `NOAA uydu ölçümü, ${result.chl.date}. Yüksek değer plankton ve yem balığı demek olabilir; kıyıda yanıltabilir.` : 'Yalnızca bilgisayar uygulamasında ve veri olduğunda gösterilir.'],
            ['Dipten su yükselmesi', C.upwelling(r.dir, r.wind, ctx.bearing, ctx.lat) || '--', 'Rüzgar ve kıyı yönünden kaba tahmin; birkaç gün süren rüzgarda anlamlıdır.']
        ] : []),
        ['Gün doğumu / batımı', day ? `${C.hhmm(day.sunrise)} / ${C.hhmm(day.sunset)}` : '--', 'Alacakaranlık çoğu tür için en verimli zaman.']
    ];
    return all.map(([k, v, help, paint]) => `<details class="metric"><summary><small>${esc(k)}</small><b${paint ? ` class="wchip" style="${paint}"` : ''}>${esc(v)}</b></summary><p>${esc(help)}</p></details>`).join('');
}

function renderResult(root) {
    const { d, pack, ctx, plan, shore } = result;
    const status = C.dataStatus(pack, Date.now());
    const sel = plan.hours.find(h => h.row.time === result.sel);
    const species = C.speciesFor({ salt: ctx.salt, month: Number(d.date.slice(5, 7)), seaTemp: sel?.row.sea ?? null, technique: d.technique });
    result.text = C.commentary(plan, ctx, species);
    const [safeText, safeClass] = SAFETY[!status.ok ? 'unknown' : sel?.safety.level || 'unknown'];
    const technique = TECHNIQUES.find(t => t.id === d.technique);
    const week = datesOf(pack).map(date => ({ date, p: date === d.date ? plan : planFor(pack, ctx, date) }));
    const dayName = date => new Date(`${date}T12:00`).toLocaleDateString('tr-TR', { weekday: 'short', day: 'numeric' });
    const setup = app.state.tackle.find(t => t.id === d.setup);

    const open = opened(root);
    root.innerHTML = `
    <div class="row between top"><button class="btn" data-act="back">← Yeni plan</button><span class="mute">${esc(pack.source)} veri, ${new Date(pack.updatedAt).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span></div>
    ${status.ok ? '' : `<p class="banner bad">${esc(status.message)} Güvenlik değerlendirmesi gösterilmiyor.</p>`}
    ${ctx.salt && shore && shore.elevation > 15 ? `<p class="banner warn">Seçilen nokta yaklaşık ${Math.round(shore.elevation)} m yükseklikte görünüyor; kıyıda olduğundan emin olun.</p>` : ''}
    <section class="card hero"><p class="mute">${esc(d.name || `${d.lat.toFixed(4)}, ${d.lon.toFixed(4)}`)} · ${esc(new Date(`${d.date}T12:00`).toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' }))}</p>
        <h1 class="${grade(plan.score)[1]}">${esc(C.scoreLabel(plan.score))}</h1>
        ${plan.windows[0] ? `<p class="when">${span(plan.windows[0])}</p>` : '<p class="bad">Bu gün için uygun pencere yok.</p>'}
        <p class="${safeClass}"><b>${esc(safeText)}</b> ${esc(status.ok ? sel?.safety.reasons.join(' ') || '' : '')}</p>
        <button type="button" class="btn primary big" data-guide="${d.lat},${d.lon}" data-name="${esc(d.name || 'Plan noktası')}">Beni oraya götür</button>
        <div class="row wrap"><button class="btn" data-act="save">Planı kaydet</button><button class="btn" data-act="remind" ${plan.windows.length ? '' : 'disabled'}>Takvime hatırlatma</button>${extras.shareButton(d.lat, d.lon, d.name || 'Mera')}</div>
        <p class="mute">Puan ${plan.score ?? '--'}/100 · ${esc(technique.ad)}${setup ? ` · ${esc(setup.name)}` : ''} · <span id="confidence">tahmin güveni ${plan.confidence}</span></p></section>
    <section class="card"><h2>Hangi balık, saat kaçta?</h2><div id="activity">${activityHtml(3)}</div></section>
    <section class="card"><h2>14 gün</h2><div class="week">${week.map(({ date, p }) => `<button data-act="day" data-v="${date}" class="${date === d.date ? 'on' : ''}"><small>${esc(dayName(date))}</small><b class="${p.allUnsafe ? 'bad' : grade(p.score)[1]}">${p.allUnsafe ? '!' : p.score ?? '--'}</b></button>`).join('')}</div><p class="mute">! güvenli saat yok. İleri günlerin tahmin güveni düşer.</p></section>
    ${fold('pencere', 'Atış saatleri ve yorum', `${plan.windows.map((w, n) => `<button class="window" data-act="hour" data-v="${w.peak.row.time}"><b>${n + 1}. ${span(w)}</b>${pill(w.score)}<small>${esc([...w.peak.factors].sort((a, b) => b.points / b.max - a.points / a.max).slice(0, 2).map(f => f.text).join(' · '))}</small></button>`).join('') || '<p>Bu gün için uygun pencere yok.</p>'}
        ${result.text.map(t => `<p>${esc(t)}</p>`).join('')}<p class="mute">Kural tabanlı otomatik yorumdur, yapay zekâ modeli değildir.</p>
        <div class="row wrap"><button class="btn" data-act="share">Metin paylaş</button><button class="btn" data-act="card">Görsel kart</button></div>`, open)}
    ${fold('balik', 'Bütün balıklar ve yöre kayıtları', `<div id="activity-all">${activityHtml(8)}</div><h3>Bölgede kayıtlı balıklar (iNaturalist, 40 km)</h3><div id="fish"></div>
        <p class="mute">Koşul uyumuna dayalı tahmindir, olasılık değildir. Avlanmadan önce <a href="${LEGAL_URL}" target="_blank" rel="noopener">resmi tebliği</a> kontrol edin.</p>`, open)}
    ${fold('grafik', 'Grafikler', `<h3>Saatlik puan</h3><div class="chart"><canvas id="hours"></canvas></div>
        <div class="row between"><h3>3 günlük eğilim</h3><select data-field="trend" aria-label="Eğilim">${options([['sicaklik', 'Sıcaklık ve bulut'], ['basinc', 'Basınç'], ['yagis', 'Yağış'], ['ruzgar', 'Rüzgar ve hamle'], ...(ctx.salt ? [['deniz', 'Su seviyesi ve dalga']] : [])], trend)}</select></div><div class="chart"><canvas id="trend"></canvas></div>`, open)}
    ${fold('veri', 'Ayrıntılı veriler', `<select data-field="hour" aria-label="Saat">${options(plan.hours.map(h => [h.row.time, `${C.hhmm(h.row.time)} · ${h.score ?? '--'}`]), result.sel)}</select>
        <div class="metrics" id="metrics">${metrics()}</div>
        <p class="mute">Kartlara dokununca açıklaması açılır. Kaynak: Open-Meteo. Resmi meteoroloji uyarılarının yerine geçmez.</p>
        <h3>Puanı ne belirledi?</h3>${(sel?.factors || []).map(f => `<div class="factor"><span>${esc(f.text)}</span><meter min="0" max="${f.max}" value="${f.points}"></meter></div>`).join('') || '<p>--</p>'}`, open)}
    ${fold('liste', 'Hazırlık listesi', [...CHECK.ortak, ...(CHECK[d.technique] || [])].map(t => `<label class="check"><input type="checkbox"> ${esc(t)}</label>`).join(''), open)}
    ${fold('zeka', 'Yapay zekâya sor (isteğe bağlı)', `<form data-form="mentor"><label>Sorunuz (isteğe bağlı)<input name="q" maxlength="300" placeholder="Hangi sahte, hangi derinlik?"></label><button class="btn primary">Mentora sor</button></form>
        <p id="answer" class="answer">${esc(result.answer)}</p><p class="mute">Kendi ücretsiz Gemini anahtarınızla çalışır (Ayarlar). Plan verisi ve noktanın koordinatı Google'a gönderilir. Yanıt hatalı olabilir.</p><button class="btn" data-act="ai">Soruyu kopyala</button>`, open)}
    ${islandWarning(d.lat, d.lon)}<a class="btn big" href="${mapsUrl(d.lat, d.lon)}" target="_blank" rel="noopener">Yol tarifi al</a>`;
    paintFish();
    paintConfidence();
    drawChart();
    drawTrend();
}

function paintConfidence() {
    const el = $('#confidence');
    const c = result.models && C.modelConfidence(result.models, result.d.date);
    if (el && c) el.textContent = `tahmin güveni ${c.level} (modeller arası ±${c.spread} km/sa)`;
}

function activityHtml(count) {
    const { d, pack, plan, ctx } = result;
    const evidence = { seen: ctx.salt ? result.seen : {}, own: ownEvidence(app.state.catches, d.lat, d.lon, Number(d.date.slice(5, 7))) };
    const all = speciesActivity(pack, plan.hours, { salt: ctx.salt, evidence });
    // Hedef tur en uste alinir.
    all.sort((a, b) => Number(b.name === d.species) - Number(a.name === d.species));
    return all.slice(0, count).map(f => `<div class="species"><b>${esc(f.name)} <span class="mono">${span(f)}</span></b><span class="pill ${f.closed ? 'bad' : f.level === 'yüksek' ? 'ok' : f.level === 'orta' ? 'warn' : 'mute'}">${f.closed ? 'yasak' : `${grade(f.score)[0]}`}</span>
        <small>${esc(f.why.join(' · '))}</small><small>Yem: ${esc(f.bait)}${ruleFor(f.name) ? ` · ${esc(ruleText(ruleFor(f.name)))}` : ''}</small></div>`).join('') || '<p>Güvenli saat veya mevsiminde tür yok.</p>';
}

function drawTrend() {
    weather?.destroy();
    const canvas = $('#trend');
    if (!canvas) return;
    const start = result.pack.rows.findIndex(r => r.time.startsWith(result.d.date));
    const rows = result.pack.rows.slice(start, start + 72);
    const defs = { sicaklik: [['Hava °C', 'air', '#fbbf24'], ['Su °C', 'sea', '#14b8a6'], ['Bulut %', 'cloud', '#64748b', 'y2']], basinc: [['Basınç hPa', 'pressure', '#fbbf24']], yagis: [['Yağış mm', 'precip', '#60a5fa']], ruzgar: [['Rüzgar km/sa', 'wind', '#60a5fa'], ['Hamle km/sa', 'gust', '#a78bfa']], deniz: [['Su seviyesi m', 'level', '#14b8a6'], ['Dalga m', 'wave', '#c084fc', 'y2']] }[trend] || [];
    weather = new window.Chart(canvas, {
        type: 'line',
        data: { labels: rows.map(r => `${r.time.slice(8, 10)}.${r.time.slice(5, 7)} ${r.time.slice(11, 16)}`), datasets: defs.map(([label, key, color, axis = 'y']) => ({ label, data: rows.map(r => (key === 'wind' || key === 'gust') && r[key] !== null ? Math.round(r[key] * 1.852) : r[key]), borderColor: color, backgroundColor: color, pointRadius: 0, tension: 0.3, yAxisID: axis })) },
        options: { maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { labels: { color: '#cbd5e1', boxWidth: 10 } } }, scales: { x: { ticks: { color: '#94a3b8', maxTicksLimit: 6 } }, y: { ticks: { color: '#94a3b8' } }, ...(defs.some(x => x[3]) ? { y2: { axis: 'y', position: 'right', ticks: { color: '#94a3b8' }, grid: { display: false } } } : {}) } }
    });
}

const aiPrompt = question => {
    const r = result.pack.rows.find(x => x.time === result.sel);
    return `Kıyıdan balık avı planımı değerlendir. Teknik: ${result.d.technique}. Su: ${result.d.water}. Hedef: ${result.d.species || 'serbest'}.\n${summary()}\nSeçili saat verisi (rüzgar kt, dalga m, sıcaklık C, basınç hPa): ${JSON.stringify(r)}\n${question || 'Sahte/yem, derinlik, atış taktiği ve dikkat edilecekleri kısaca öner.'}`;
};

export async function submit(form) {
    const box = $('#answer');
    const mine = run;
    box.textContent = 'Mentor düşünüyor…';
    try {
        const text = await ask(aiPrompt(form.elements.q.value.trim()));
        if (mine === run && result) { result.answer = text; $('#answer').textContent = text; }
    } catch (err) { if (mine === run) box.textContent = err.message; }
}

function drawChart() {
    chart?.destroy();
    const canvas = $('#hours');
    if (!canvas) return;
    const hs = result.plan.hours;
    const line = (label, data, color, axis) => ({ type: 'line', label, data, borderColor: color, backgroundColor: color, pointRadius: 0, tension: 0.3, yAxisID: axis });
    chart = new window.Chart(canvas, {
        data: {
            labels: hs.map(h => C.hhmm(h.row.time)),
            datasets: [
                { type: 'bar', label: 'Puan', data: hs.map(h => h.score), backgroundColor: hs.map(h => ({ go: '#14b8a6', caution: '#f59e0b', nogo: '#ef4444', unknown: '#64748b' })[h.safety.level]), yAxisID: 'y' },
                line('Rüzgar (km/sa)', hs.map(h => (h.row.wind === null ? null : Math.round(h.row.wind * 1.852))), '#60a5fa', 'w'),
                ...(result.ctx.salt ? [line('Dalga (m)', hs.map(h => h.row.wave), '#c084fc', 'm')] : [])
            ]
        },
        options: {
            maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false },
            plugins: { legend: { labels: { color: '#cbd5e1', boxWidth: 10 } } },
            scales: { x: { ticks: { color: '#94a3b8', maxTicksLimit: 8 } }, y: { min: 0, max: 100, ticks: { color: '#94a3b8' } }, w: { axis: 'y', position: 'right', beginAtZero: true, ticks: { color: '#60a5fa' }, grid: { display: false } }, m: { axis: 'y', display: false, beginAtZero: true } }
        }
    });
}

function summary() {
    const { d, plan, text } = result;
    return `KILÇIK av planı — ${d.name || `${d.lat}, ${d.lon}`} — ${d.date}\nPuan: ${plan.score ?? '--'}\nPencereler: ${plan.windows.map(span).join(', ') || 'yok'}\n${text.join('\n')}`;
}

function calendar() {
    const { d, plan, pack } = result;
    return icsFile(plan.windows.map(w => ({ name: d.name || 'seçili nokta', score: w.score, lat: d.lat, lon: d.lon, fromMs: C.toMs(w.from, pack.offset), toMs: C.toMs(w.to, pack.offset) })));
}

export const actions = {
    water: (v, root) => { Object.assign(app.draft, { water: v, species: '' }); render(root); },
    technique: (v, root) => { app.draft.technique = v; render(root); },
    here: async (v, root) => {
        try { const p = await locate(); Object.assign(app.draft, { lat: p.lat, lon: p.lon, name: `Konumum (±${p.accuracy} m)` }); render(root); }
        catch (err) { toast(err.message, 'bad'); }
    },
    pickmap: () => app.go('harita', { pick: true }),
    analyse: (v, root) => analyse(root),
    back: (v, root) => { run++; result = null; render(root); },
    hour: (v, root) => { result.sel = v; renderResult(root); },
    save: async () => {
        const { d, plan } = result;
        app.state.plans.unshift({ id: uid('plan'), name: d.name || `${d.lat.toFixed(4)}, ${d.lon.toFixed(4)}`, lat: d.lat, lon: d.lon, date: d.date, water: d.water, technique: d.technique, species: d.species, score: plan.score, window: plan.windows[0] ? span(plan.windows[0]) : '' });
        await persist();
        toast('Plan kaydedildi.', 'ok');
    },
    remind: () => download(`kilcik-${result.d.date}.ics`, calendar(), 'text/calendar'),
    share: () => (navigator.share ? navigator.share({ text: summary() }).catch(() => {}) : copy(summary(), 'Plan kopyalandı.')),
    ai: () => copy(aiPrompt(''), 'Kopyalandı. İstediğiniz yapay zekâ uygulamasına yapıştırın.'),
    day: (v, root) => { setDay(v); result.answer = ''; renderResult(root); },
    card: () => shareCard({ title: result.d.name || 'Av planım', big: String(result.plan.score ?? '--'), lines: [result.d.date, `Pencereler: ${result.plan.windows.map(span).join(', ') || 'yok'}`, C.scoreLabel(result.plan.score), TECHNIQUES.find(t => t.id === result.d.technique).ad] })
};

export function change(field, value, root) {
    if (field === 'hour') { result.sel = value; return renderResult(root); }
    if (field === 'trend') { trend = value; return drawTrend(); }
    if (field === 'spot') {
        const s = app.state.spots.find(x => x.id === value);
        if (s) Object.assign(app.draft, { lat: s.lat, lon: s.lon, name: s.name, water: s.water });
    } else app.draft[field] = value;
    render(root);
}

export function openPlan(draft) {
    run++;
    result = null;
    app.draft = { ...defaultDraft(), ...app.draft, ...draft };
}
