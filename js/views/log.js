// Av gunlugu: o andaki gercek kosullar, fotograf, istatistik.
import * as ortak from '../ortak.js';
import * as C from '../core.js';
import * as api from '../api.js';
import { SPECIES, LEGAL_URL } from '../species.js';
import * as extras from '../extras.js';
import { PEAK } from '../activity.js';
import { app, esc, uid, options, toast, persist, locate, opened, fold } from '../ui.js';
import { catchWarnings } from '../legal.js';
import { ask } from '../ai.js';
import { shareCard } from '../share.js';
import { contextFor, solunarFor } from '../planner.js';
import * as session from '../session.js';
import * as donus from '../donus.js';
import { hourFactors } from '../session.js';

let place = { lat: null, lon: null, spot: '' };
let editing = null;
let mode = '';          // '' kapali, 'fish' av, 'blank' bos donus
let locating = false;

/** Bu ayin one cikan turleri ve daha once yazilanlar: tek dokunusla secilir. */
function quickSpecies() {
    const month = new Date().getMonth() + 1;
    const mine = app.state.catches.filter(c => !c.blank).slice(-20).reverse().map(c => c.species);
    const season = SPECIES.filter(s => s.ortam === 'tuzlu' && s.aylar.includes(month)).sort((a, b) => Number((PEAK[b.ad] || []).includes(month)) - Number((PEAK[a.ad] || []).includes(month))).map(s => s.ad);
    return [...new Set([app.pref.species, ...mine, ...season].filter(Boolean))].slice(0, 6);
}

function scoreCard(k) {
    const line = (title, g) => `<div class="item"><span>${title}</span><b>${g.trips ? `${g.trips} avın ${g.fish}’inde balık (%${g.rate})` : 'henüz av yok'}</b></div>`;
    const verdict = !k.ready ? `<p class="mute">Yorum için iki grupta da en az ${k.min} av gerekir. Boş döndüğünüz avları da kaydedin.</p>`
        : k.high.rate > k.low.rate + 10 ? '<p class="ok">Şimdiye kadar tahminin iyi dediği saatlerde daha sık balık çıktı.</p>'
            : k.high.rate < k.low.rate - 10 ? '<p class="bad">Şimdiye kadar tahmin tutmadı: düşük puanlı saatlerde daha sık balık çıktı.</p>'
                : '<p class="warn">Şimdiye kadar yüksek ve düşük puanlı avlar arasında belirgin fark yok.</p>';
    return `<section class="card"><h2>İsabet karnesi</h2>${line(`Tahmin iyiydi (${k.line}+ puan)`, k.high)}${line(`Tahmin zayıftı (${k.line} altı)`, k.low)}${verdict}</section>`;
}

const nowLocal = () => new Date().toLocaleString('sv-SE').slice(0, 16).replace(' ', 'T');
const top = (list, key) => {
    const m = new Map();
    list.forEach(c => { const k = key(c); if (k) m.set(k, (m.get(k) || 0) + c.count); });
    return [...m].sort((a, b) => b[1] - a[1]).slice(0, 4);
};
const bars = (title, rows) => (rows.length ? `<div><h3>${title}</h3>${rows.map(([k, v]) => `<div class="factor"><span>${esc(k)} (${v})</span><meter min="0" max="${rows[0][1]}" value="${v}"></meter></div>`).join('')}</div>` : '');

export function render(root, params = {}) {
    if (params.lat !== undefined) { place = { lat: params.lat, lon: params.lon, spot: params.spot || '' }; mode ||= 'fish'; }
    const all = [...app.state.catches].sort((a, b) => b.at.localeCompare(a.at));
    const cs = all.filter(c => !c.blank);
    const learn = C.calibrate(all);
    const lures = app.state.tackle.filter(t => t.kind === 'Sahte / yem' || t.kind === 'Takım');
    const records = [...app.state.catches.filter(c => c.length || c.weight).reduce((m, c) => {
        const r = m.get(c.species) || { length: 0, weight: 0 };
        return m.set(c.species, { length: Math.max(r.length, c.length || 0), weight: Math.max(r.weight, c.weight || 0) });
    }, new Map())];
    const open = opened(root);
    if (editing) open.add('detay');
    const blank = mode === 'blank';
    const form = !mode ? '' : `
    <form class="card hero" data-form="catch"><h2>${editing ? 'Avı düzenle' : blank ? 'Boş döndüm' : 'Balık tuttum'}</h2>
        ${blank ? '' : `<div class="chips">${quickSpecies().map(n => `<button type="button" class="chip" data-act="pickfish" data-v="${esc(n)}">${esc(n)}</button>`).join('')}</div>
        <label>Tür<input name="species" list="species" maxlength="80" placeholder="Yukarıdan seçin veya yazın"></label>
        <label>Fotoğraf (isteğe bağlı)<input type="file" name="photo" accept="image/*"></label>`}
        <p class="mono">${place.lat === null ? (locating ? 'Konum alınıyor…' : 'Konum yok: aşağıdan seçin.') : `Konum: ${esc(place.spot)} ${place.lat.toFixed(4)}, ${place.lon.toFixed(4)}`}</p>
        <div class="row wrap"><button class="btn primary">Kaydet</button><button type="button" class="btn" data-act="cancel">Vazgeç</button></div>
        ${fold('detay', blank ? 'Saat, yer ve not' : 'Boy, yem, saat, yer ve not', `<div class="grid2">
        <label>Tarih ve saat<input type="datetime-local" name="at" required value="${nowLocal()}" max="${nowLocal()}"></label>
        ${blank ? '' : `<label>Boy (cm)<input type="number" name="length" min="0" step="0.5"></label>
        <label>Ağırlık (kg)<input type="number" name="weight" min="0" step="0.01"></label>
        <label>Adet<input type="number" name="count" min="1" step="1" value="1"></label>
        <label>Yem / sahte<input name="lure" list="lures" maxlength="120"></label>`}
        </div>
        <label>Kayıtlı nokta<select data-field="spot">${options([['', place.lat === null ? 'Seçin…' : 'Şu anki seçim'], ...app.state.spots.map(s => [s.id, s.name])], '')}</select></label>
        <div class="row wrap"><button type="button" class="btn" data-act="here">Konumum</button><button type="button" class="btn" data-act="map">Haritadan seç</button></div>
        <label>Not<input name="note" maxlength="300"></label>
        ${blank ? '' : `<label class="check"><input type="checkbox" name="released"> Balığı geri bıraktım</label>
        <button type="button" class="btn" data-act="identify">Fotoğraftan türü tahmin et (yapay zekâ)</button><p id="identify" class="answer"></p>
        <p class="mute">Asgari boyu <a href="${LEGAL_URL}" target="_blank" rel="noopener">resmi tebliğden</a> kontrol edin.</p>`}`, open, 'sub')}
        <datalist id="species">${SPECIES.map(s => `<option value="${esc(s.ad)}">`).join('')}</datalist>
        <datalist id="lures">${lures.map(t => `<option value="${esc(t.name)}">`).join('')}</datalist></form>`;
    root.innerHTML = `
    ${donus.tripCard()}
    ${session.active() ? session.card() : ''}
    ${mode ? form : `<button type="button" class="btn primary huge" data-act="new" data-v="fish">🎣 Balık tuttum</button><button type="button" class="btn huge" data-act="new" data-v="blank">Boş döndüm</button>
    <p class="mute">Saat, konum ve hava kendiliğinden eklenir.</p>`}
    <section class="card"><h2>Tahmin sizden öğreniyor</h2><p>Av çıkan: <b>${learn.good}/${learn.min}</b> · çıkmayan: <b>${learn.blank}/${learn.min}</b></p>
        ${learn.ready ? '<p class="ok">Puan ağırlıkları kayıtlarınıza göre ayarlanıyor.</p>' : '<p class="mute">İki sayı da dolunca tahmin size göre ayarlanır. Boş döndüğünüz günler de en az av kadar önemli.</p>'}</section>
    ${scoreCard(C.scorecard(all))}
    ${ortak.shareCard()}
    ${session.active() ? '' : session.card()}
    ${extras.backupCard()}
    ${cs.length || learn.ready ? fold('istat', 'İstatistik, rekorlar ve tahmin isabeti', `
    ${cs.length ? `<section class="card"><h2>İstatistik · ${cs.reduce((a, c) => a + c.count, 0)} balık</h2><div class="stats">
        ${bars('Tür', top(cs, c => c.species))}${bars('Nokta', top(cs, c => c.spot))}${bars('Yem', top(cs, c => c.lure))}
        ${bars('Saat dilimi', top(cs, c => { if (!c.at) return ''; const h = Math.floor(Number(c.at.slice(11, 13)) / 3) * 3; return `${String(h).padStart(2, '0')}–${String(h + 3).padStart(2, '0')}`; }))}</div>
        <p class="mute">Bir noktanın yakınında 5 veya daha fazla av kaydı olunca plan puanı saat alışkanlığınızı da hesaba katar.</p></section>` : ''}
    ${cs.length ? `<section class="card"><h2>Tahmin isabetini sına</h2><p>Her avınızın gününü gerçek geçmiş hava verisiyle yeniden puanlar ve av saatinizin o günün saatleri arasında kaçıncı sırada olduğuna bakar.</p><button class="btn primary" data-act="backtest">Avlarımla sına</button><p id="backtest" class="answer"></p></section>` : ''}
    ${learn.ready ? `<section class="card"><h2>Öğrenilen ağırlıklar</h2>${learn.effects.slice(0, 6).map(e => `<div class="item"><span>${esc(C.FACTOR_NAMES[e.key])}</span><b class="${e.weight > 1.05 ? 'ok' : e.weight < 0.95 ? 'warn' : 'mute'}">ağırlık ×${e.weight}</b></div>`).join('')}</section>` : ''}`, open) : ''}
    ${all.filter(c => c.blank).map(c => `<section class="card"><div class="row between"><span class="mute">Av çıkmadı · ${esc(c.at.replace('T', ' '))}${c.spot ? ` · ${esc(c.spot)}` : ''}</span><button class="btn danger" data-act="del" data-v="${c.id}">Sil</button></div></section>`).join('')}
    ${records.length ? `<section class="card"><h2>Rekorlarım</h2>${records.map(([k, r]) => `<div class="item"><b>${esc(k)}</b><span>${[r.length ? `${r.length} cm` : '', r.weight ? `${r.weight} kg` : ''].filter(Boolean).join(' · ')}</span></div>`).join('')}</section>` : ''}
    ${cs.map(c => `<section class="card">${c.photo ? `<img class="photo" src="${c.photo}" alt="${esc(c.species)}">` : ''}
        <div class="row between"><h2>${esc(c.species)}${c.count > 1 ? ` ×${c.count}` : ''}</h2><span class="row"><button class="btn" data-act="card" data-v="${c.id}">Paylaş</button><button class="btn" data-act="edit" data-v="${c.id}">Düzenle</button><button class="btn danger" data-act="del" data-v="${c.id}">Sil</button></span></div>
        <p>${esc(c.at.replace('T', ' '))}${c.spot ? ` · ${esc(c.spot)}` : ''}${c.length ? ` · ${c.length} cm` : ''}${c.weight ? ` · ${c.weight} kg` : ''}${c.released ? ' · bırakıldı' : ''}</p>
        <p class="mute">${esc([c.lure, c.conditions, c.note].filter(Boolean).join(' · '))}</p>${catchWarnings(c.species, c.released ? null : c.length, c.at).map(w => `<p class="bad">${esc(w)}</p>`).join('')}</section>`).join('')}`;
    const old = editing && app.state.catches.find(c => c.id === editing);
    if (old && mode) {
        const f = root.querySelector('[data-form="catch"]').elements;
        for (const k of ['at', 'species', 'length', 'weight', 'count', 'lure', 'note']) { const field = f.namedItem(k); if (field) field.value = old[k] ?? ''; }
        const box = f.namedItem('released');
        if (box) box.checked = old.released;
    }
}

async function shrink(file) {
    if (!/^image\//.test(file.type) || file.size > 30e6) throw new Error('Yalnızca 30 MB’tan küçük fotoğraf seçin.');
    const img = await createImageBitmap(file);
    const k = Math.min(1, 1000 / Math.max(img.width, img.height));
    const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(img.width * k), height: Math.round(img.height * k) });
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.75);
}

export async function submit(form, root) {
    const f = form.elements;
    const blank = mode === 'blank';
    // Bos donus formunda av alanlari yoktur.
    const val = name => f.namedItem(name)?.value ?? '';
    const released = Boolean(f.namedItem('released')?.checked);
    if (!blank && !val('species').trim()) return toast('Balığı seçin veya yazın.', 'bad');
    if (blank && place.lat === null) return toast('Boş seans için de konum seçin.', 'bad');
    const warnings = blank ? [] : catchWarnings(val('species'), released ? null : Number(val('length')), f.at.value);
    if (warnings.length && !window.confirm(`${warnings.join('\n')}\n\nYine de kaydedilsin mi?`)) return;
    const old = editing && app.state.catches.find(c => c.id === editing);
    const button = form.querySelector('button.primary');
    button.disabled = true;
    let photo = '';
    try { const file = f.namedItem('photo')?.files[0]; if (file) photo = await shrink(file); }
    catch { toast('Fotoğraf okunamadı; kayıt fotoğrafsız yapılacak.', 'bad'); }
    // Duzenlemede zaman ve yer ayniysa kayitli kosullar korunur.
    let conditions = old && old.at === f.at.value && old.lat === place.lat && old.lon === place.lon ? old.conditions : '';
    if (place.lat !== null && !conditions) {
        try {
            const r = await api.conditionsAt(place.lat, place.lon, f.at.value);
            if (r) conditions = [r.wind !== null ? `${C.kmh(r.wind)} ${C.dirCode(r.dir)}` : '', r.pressure !== null ? `${r.pressure} hPa` : '', r.air !== null ? `hava ${r.air}°C` : '', r.sea !== null ? `su ${r.sea}°C` : '', r.wave !== null && !r.waveEstimated ? `dalga ${r.wave} m` : ''].filter(Boolean).join(', ');
        } catch { toast('O anın hava verisi alınamadı.', 'bad'); }
    }
    // O saatin etken degerleri saklanir; tahmin bunlardan ogrenir.
    const same = old && old.at === f.at.value && old.lat === place.lat && old.lon === place.lon;
    let factors = same ? old.factors : null, score = same ? old.score : null;
    if ((!factors || score == null) && place.lat !== null) {
        const info = await hourFactors(place.lat, place.lon, f.at.value).catch(() => null);
        factors ||= info?.factors || null;
        score ??= info?.score ?? null;
    }
    const [entry] = C.sanitizeState({ catches: [{ id: old?.id || uid('av'), at: f.at.value, species: blank ? 'Av çıkmadı' : val('species').trim(), blank, factors, score, spot: place.spot, lat: place.lat, lon: place.lon, length: val('length'), weight: val('weight'), count: val('count'), lure: val('lure').trim(), released, note: val('note').trim(), conditions, photo: photo || old?.photo || '' }] }).catches;
    if (!entry) { button.disabled = false; return toast('Tür girin.', 'bad'); }
    app.state.catches = [...app.state.catches.filter(c => c.id !== entry.id), entry];
    editing = null;
    mode = '';
    place = { lat: null, lon: null, spot: '' };
    await persist();
    render(root);
    toast(blank ? 'Boş seans kaydedildi.' : 'Av kaydedildi.', 'ok');
}

export const actions = {
    ...session.actions(() => app.go('gunluk')),
    here: async (v, root) => {
        try { const p = await locate(); place = { lat: p.lat, lon: p.lon, spot: '' }; paintPlace(root); }
        catch (err) { toast(err.message, 'bad'); }
    },
    map: () => app.go('harita'),
    backtest: async (v, root) => {
        const box = root.querySelector('#backtest');
        const list = app.state.catches.filter(c => !c.blank && c.at && c.lat !== null).slice(-30);
        const ranks = [];
        for (const [n, c] of list.entries()) {
            box.textContent = `Sınanıyor ${n + 1}/${list.length}…`;
            try {
                const date = c.at.slice(0, 10);
                const pack = await api.dayPack(c.lat, c.lon, date);
                const shore = await api.shoreInfo(c.lat, c.lon).catch(() => null);
                // Gunluk bonusu kapali: avin kendisi puani etkilemesin.
                const ctx = { ...contextFor({ lat: c.lat, lon: c.lon, water: 'tuzlu', technique: 'spin' }, shore?.bearing ?? null), history: [] };
                ctx.solunar = solunarFor(pack, ctx, date);
                const scores = pack.rows.map((r, i) => ({ time: r.time, score: C.scoreHour(pack, i, ctx).score })).filter(x => x.score !== null && x.time.startsWith(date));
                const own = scores.find(x => x.time.slice(0, 13) === c.at.slice(0, 13));
                if (own) ranks.push((scores.filter(x => x.score < own.score).length + scores.filter(x => x.score === own.score).length / 2) / scores.length);
            } catch { /* verisi alinamayan av atlanir */ }
        }
        if (!ranks.length) { box.textContent = 'Konumu ve zamanı olan, verisi alınabilen av bulunamadı.'; return; }
        const good = ranks.filter(r => r >= 0.5).length;
        const avg = Math.round(ranks.reduce((a, b) => a + b, 0) / ranks.length * 100);
        box.textContent = `${ranks.length} av sınandı: ${good} tanesi (%${Math.round(good / ranks.length * 100)}) modelin günün üst yarısı dediği saatlerde. Ortalama sıra: %${avg} (rastgele tahmin yaklaşık %50).\n${ranks.length < 20 ? 'Sonuç çıkarmak için henüz az kayıt var (en az 20-30 av gerekir).' : 'Not: hep aynı saatlerde ava gidiyorsanız sonuç yanlı çıkar.'}`;
    },
    cancel: (v, root) => { editing = null; mode = ''; place = { lat: null, lon: null, spot: '' }; render(root); },
    new: async (v, root) => {
        mode = v;
        editing = null;
        locating = place.lat === null;
        render(root);
        window.scrollTo(0, 0);
        if (!locating) return;
        // Konum arka planda alinir; yazilanlar kaybolmaz.
        try { const p = await locate(); if (place.lat === null) place = { lat: p.lat, lon: p.lon, spot: '' }; }
        catch (err) { toast(err.message, 'bad'); }
        locating = false;
        if (mode) paintPlace(root);
    },
    pickfish: (v, root) => {
        root.querySelector('[data-form="catch"] [name="species"]').value = v;
        root.querySelectorAll('[data-act="pickfish"]').forEach(b => b.classList.toggle('on', b.dataset.v === v));
    },
    edit: (v, root) => {
        const c = app.state.catches.find(x => x.id === v);
        editing = v;
        mode = c.blank ? 'blank' : 'fish';
        place = { lat: c.lat, lon: c.lon, spot: c.spot };
        render(root);
        window.scrollTo(0, 0);
    },
    card: v => {
        const c = app.state.catches.find(x => x.id === v);
        // Konum bilerek karta yazilmaz.
        shareCard({ title: `${c.species}${c.count > 1 ? ` ×${c.count}` : ''}`, photo: c.photo, lines: [c.at.slice(0, 10), [c.length ? `${c.length} cm` : '', c.weight ? `${c.weight} kg` : ''].filter(Boolean).join(' · '), c.lure, c.released ? 'Geri bırakıldı' : ''] });
    },
    identify: async (v, root) => {
        const file = root.querySelector('[name="photo"]').files[0];
        const box = root.querySelector('#identify');
        if (!file) { box.textContent = 'Önce fotoğraf seçin.'; return; }
        box.textContent = 'Fotoğraf inceleniyor…';
        try { box.textContent = await ask('Fotoğraftaki balık veya kafadanbacaklı hangi tür olabilir? Türkçe ad, Latince ad, güven düzeyi ve ayırt edici özellikleri yaz. Balık yoksa söyle.', await shrink(file)); }
        catch (err) { box.textContent = err.message; }
    },
    del: async (v, root) => {
        if (!window.confirm('Bu av kaydı silinsin mi?')) return;
        app.state.catches = app.state.catches.filter(c => c.id !== v);
        await persist();
        render(root);
    }
};

// Form doldurulurken yalnizca konum satiri guncellenir; yazilanlar kaybolmaz.
function paintPlace(root) {
    const line = root.querySelector('[data-form="catch"] .mono');
    if (line) line.textContent = place.lat === null ? 'Konum yok: aşağıdan seçin.' : `Konum: ${place.spot} ${place.lat.toFixed(4)}, ${place.lon.toFixed(4)}`;
}

export function change(field, value, root) {
    if (ortak.toggle(field)) return render(root);
    const s = app.state.spots.find(x => x.id === value);
    if (field === 'spot' && s) { place = { lat: s.lat, lon: s.lon, spot: s.name }; paintPlace(root); }
}
