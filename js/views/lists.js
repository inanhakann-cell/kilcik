// Noktalarim, Planlarim, Takim cantasi, Ayarlar.
import * as C from '../core.js';
import { TECHNIQUES, SAMPLE_SPOTS, LEGAL_URL } from '../species.js';
import * as guide from '../guide.js';
import { app, $, esc, uid, options, toast, download, persist, mapsUrl, locate, copy, SAFETY } from '../ui.js';
import { scanSpots, icsFile } from '../planner.js';
import { getAi, setAi } from '../ai.js';
import { askPermission, check } from '../alerts.js';
import { cachedPlaces } from '../places.js';
import { cacheGet, cacheSet } from '../store.js';

const empty = text => `<section class="card"><p class="mute">${text}</p></section>`;
const confirmDelete = async (listName, id, redraw) => {
    const item = app.state[listName].find(x => x.id === id);
    if (!item || !window.confirm(`"${item.name}" silinsin mi?`)) return;
    app.state[listName] = app.state[listName].filter(x => x.id !== id);
    await persist();
    redraw();
};

// ---- Noktalarim ----
let scan = null;

export const spots = {
    render(root) {
        root.innerHTML = `<div class="row wrap"><button class="btn primary" data-act="add">Haritadan ekle</button>
        <button class="btn" data-act="score">Fırsat taraması (7 gün)</button>
        <button class="btn" data-act="gpx" ${app.state.spots.length ? '' : 'disabled'}>GPX indir</button>
        <button class="btn" data-act="samples">Biga–Bozcaada örnekleri</button></div>
        <div id="scan">${scanHtml()}</div>
        ${app.state.spots.map(s => `<section class="card"><div class="row between"><h2>${esc(s.name)}</h2><span class="pill mute" id="sc-${s.id}">${s.water === 'tatli' ? 'Tatlı su' : 'Deniz'}</span></div>
            <p class="mono">${s.lat.toFixed(5)}, ${s.lon.toFixed(5)}</p>${s.note ? `<p>${esc(s.note)}</p>` : ''}
            <div class="row wrap"><button class="btn primary" data-act="plan" data-v="${s.id}">Planla</button><button class="btn" data-act="show" data-v="${s.id}">Haritada</button>
            <a class="btn" href="${mapsUrl(s.lat, s.lon)}" target="_blank" rel="noopener">Yol tarifi</a>${guide.button(s.lat, s.lon, s.name)}<button class="btn" data-act="edit" data-v="${s.id}">Düzenle</button><button class="btn danger" data-act="del" data-v="${s.id}">Sil</button></div></section>`).join('')
        || empty('Henüz kayıtlı noktanız yok. Haritadan bir nokta seçip kaydedin.')}`;
    },
    actions: {
        add: () => app.go('harita'),
        plan: v => { const s = app.state.spots.find(x => x.id === v); app.go('plan', { draft: { lat: s.lat, lon: s.lon, name: s.name, water: s.water } }); },
        show: v => app.go('harita', { focus: app.state.spots.find(x => x.id === v) }),
        edit: async (v, root) => {
            const s = app.state.spots.find(x => x.id === v);
            const name = window.prompt('Ad:', s.name);
            if (name === null) return;
            const note = window.prompt('Not:', s.note);
            Object.assign(s, { name: name.trim().slice(0, 80) || s.name, note: (note ?? s.note).slice(0, 300) });
            await persist();
            spots.render(root);
        },
        del: (v, root) => confirmDelete('spots', v, () => spots.render(root)),
        score: async () => {
            const box = $('#scan');
            box.innerHTML = '<section class="card">Tarama başlıyor…</section>';
            try {
                // Kayitli nokta yoksa secili bolgenin kiyi yerleri taranir.
                let list = app.state.spots;
                let source = '';
                if (!list.length) {
                    const area = (await cacheGet('area')) || { name: SAMPLE_SPOTS[0][0], lat: SAMPLE_SPOTS[0][1], lon: SAMPLE_SPOTS[0][2] };
                    const near = (await cachedPlaces(area.lat, area.lon))?.list || [];
                    list = near.length ? near.slice(0, 8) : [{ id: 'area', name: area.name, lat: area.lat, lon: area.lon, water: 'tuzlu' }];
                    source = `Kayıtlı noktanız olmadığı için “${area.name}” bölgesi tarandı.`;
                }
                const { found, failed } = await scanSpots(list, app.draft.technique, 7, (n, all) => { const b = $('#scan'); if (b) b.innerHTML = `<section class="card">Taranıyor ${n}/${all}…</section>`; });
                scan = { rows: found.slice(0, 12), failed, source };
            } catch (err) {
                console.error(err);
                scan = null;
                toast('Tarama yapılamadı. İnternet bağlantısını kontrol edin.', 'bad');
            }
            const now = $('#scan');
            if (now) now.innerHTML = scanHtml();
        },
        calendar: () => download('kilcik-firsatlar.ics', icsFile(scan.rows.slice(0, 10).map(f => ({ ...f, name: f.spot.name, lat: f.spot.lat, lon: f.spot.lon }))), 'text/calendar'),
        openscan: v => { const f = scan.rows[Number(v)]; app.go('plan', { draft: { lat: f.spot.lat, lon: f.spot.lon, name: f.spot.name, water: f.spot.water, date: f.date } }); },
        samples: async (v, root) => {
            if (!window.confirm('Eski sürümden 10 kıyı noktası eklenecek. Koordinatları doğrulanmadı; bazıları karada olabilir. Eklensin mi?')) return;
            const have = new Set(app.state.spots.map(s => s.name));
            SAMPLE_SPOTS.filter(([n]) => !have.has(n)).forEach(([name, lat, lon]) => app.state.spots.push({ id: uid('spot'), name, lat, lon, water: 'tuzlu', note: 'Koordinat doğrulanmadı.' }));
            await persist();
            spots.render(root);
        },
        gpx: () => {
            const body = app.state.spots.map(s => `  <wpt lat="${s.lat}" lon="${s.lon}"><name>${esc(s.name)}</name><desc>${esc(s.note)}</desc></wpt>`).join('\n');
            download('kilcik-noktalar.gpx', `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="KILCIK" xmlns="http://www.topografix.com/GPX/1/1">\n${body}\n</gpx>`, 'application/gpx+xml');
        }
    }
};

function scanHtml() {
    if (!scan) return '';
    return `<section class="card"><h2>En iyi fırsatlar</h2>${scan.source ? `<p class="mute">${esc(scan.source)}</p>` : ''}${scan.rows.map((f, i) => `<button class="window" data-act="openscan" data-v="${i}"><b>${esc(f.spot.name)}</b><span class="pill ${SAFETY[f.level][1]}">${f.score}</span><small>${esc(new Date(`${f.date}T12:00`).toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' }))} · ${C.hhmm(f.from)}–${C.hhmm(f.to)} · güven ${f.confidence}</small></button>`).join('') || '<p>Güvenli pencere bulunamadı.</p>'}
        ${scan.failed ? `<p class="mute">${scan.failed} nokta için güncel veri alınamadı.</p>` : ''}<p class="mute">Sarı puan: o saatte dikkat gerektiren koşul var.</p>
        <div class="row"><button class="btn" data-act="calendar" ${scan.rows.length ? '' : 'disabled'}>İlk 10'u takvime ekle</button></div></section>`;
}

// ---- Planlarim ----
export const plans = {
    render(root) {
        const today = new Date().toLocaleDateString('sv-SE');
        root.innerHTML = app.state.plans.map(p => `<section class="card"><div class="row between"><h2>${esc(p.name)}</h2><span class="pill">${p.score ?? '--'}</span></div>
            <p>${esc(p.date)}${p.window ? ` · ${esc(p.window)}` : ''} · ${esc(TECHNIQUES.find(t => t.id === p.technique)?.ad || '')}${p.date < today ? ' · geçmiş' : ''}</p>
            <p class="mute">Puan kaydedildiği andaki tahmindir.</p>
            <div class="row"><button class="btn primary" data-act="open" data-v="${p.id}">${p.date < today ? 'Bugün için aç' : 'Güncel veriyle aç'}</button><button class="btn danger" data-act="del" data-v="${p.id}">Sil</button></div></section>`).join('')
        || empty('Kayıtlı plan yok. Plan sonucunda “Planı kaydet” düğmesini kullanın.');
    },
    actions: {
        open: v => { const p = app.state.plans.find(x => x.id === v); app.go('plan', { draft: { lat: p.lat, lon: p.lon, name: p.name, date: p.date, water: p.water, technique: p.technique, species: p.species } }); },
        del: (v, root) => confirmDelete('plans', v, () => plans.render(root))
    }
};

// ---- Takim cantasi ----
const KINDS = ['Kamış', 'Makine', 'Misina', 'Sahte / yem', 'Takım', 'Diğer'];
export const tackle = {
    render(root) {
        root.innerHTML = `<form class="card" data-form="tackle"><h2>Çantaya ekle</h2><div class="grid2">
            <label>Tür<select name="kind">${options(KINDS.map(k => [k, k]), 'Kamış')}</select></label>
            <label>Ad<input name="name" required maxlength="100" placeholder="2.70 m MH spin kamış"></label></div>
            <label>Ayrıntı<input name="detail" maxlength="300" placeholder="14-42 g, 4000 makine, 0.16 örgü, 14 lb FC"></label>
            <button class="btn primary">Ekle</button><p class="mute">“Takım” türündekiler plan ekranında seçilebilir.</p></form>
            ${KINDS.map(k => { const items = app.state.tackle.filter(t => t.kind === k); return items.length ? `<section class="card"><h2>${k}</h2>${items.map(t => `<div class="item"><div><b>${esc(t.name)}</b><small>${esc(t.detail)}</small></div><button class="btn danger" data-act="del" data-v="${t.id}">Sil</button></div>`).join('')}</section>` : ''; }).join('')}`;
    },
    actions: { del: (v, root) => confirmDelete('tackle', v, () => tackle.render(root)) },
    async submit(form, root) {
        const name = form.elements.name.value.trim();
        if (!name) return;
        app.state.tackle.push({ id: uid('tk'), kind: form.elements.kind.value, name, detail: form.elements.detail.value.trim() });
        await persist();
        tackle.render(root);
    }
};

// ---- Ayarlar ve yedek ----
export const settings = {
    render(root) {
        const s = app.state.settings;
        root.innerHTML = `<form class="card" data-form="settings"><h2>Güvenlik sınırları (kıyı)</h2><div class="grid2">
            <label>En yüksek rüzgar (km/saat)<input type="number" name="wind" min="15" max="63" step="1" value="${Math.round(s.wind * 1.852)}"></label>
            <label>En yüksek dalga (m)<input type="number" name="wave" min="0.3" max="2.5" step="0.05" value="${s.wave}"></label>
            <label>Bildirim için en düşük puan<input type="number" name="alertScore" min="40" max="100" step="1" value="${s.alertScore}"></label></div>
            <label class="check"><input type="checkbox" name="alerts" ${s.alerts ? 'checked' : ''}> Fırsat ve plan günü bildirimleri (uygulama açıkken)</label>
            <button class="btn primary">Kaydet</button></form>
            <form class="card" data-form="ai"><h2>Yapay zekâ (isteğe bağlı)</h2><p>Google AI Studio'dan alacağınız kendi ücretsiz anahtarınız. Yalnızca bu cihazda saklanır, yedeğe girmez. Ücretsiz katmanda gönderilen veriler Google tarafından ürün geliştirmede kullanılabilir.</p>
            <p><a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Anahtar alma sayfası</a></p>
            <div class="grid2"><label>API anahtarı<input type="password" name="key" autocomplete="off" placeholder="Kayıtlı değil"></label><label>Model<input name="model" maxlength="60"></label></div>
            <div class="row"><button class="btn primary">Kaydet</button><button type="button" class="btn danger" data-act="clearai">Anahtarı sil</button></div></form>
            <section class="card"><h2>Yedek</h2><p>Kayıtlar yalnızca bu cihazda durur. Telefon ile bilgisayar arasında taşımak için yedek alıp diğerinde yükleyin.</p>
            <div class="row wrap"><button class="btn" data-act="export">Yedek indir</button><label class="btn">Yedek yükle<input type="file" accept=".json,application/json" data-field="import" hidden></label></div></section>
            <section class="card"><h2>Bilgi</h2><p><a href="${LEGAL_URL}" target="_blank" rel="noopener">Amatör avcılık tebliği (boy limitleri ve yasaklar)</a></p>
            <p>Acil durum: <a href="tel:112">112</a> · Sahil Güvenlik <a href="tel:158">158</a></p>
            <button class="btn danger" data-act="sos">Konumumu yakınlarıma gönder</button>
            <p class="mute">Veri: Open-Meteo, iNaturalist, RainViewer, Esri, OpenStreetMap, OpenSeaMap. Tahminler hatalı olabilir; denize ve kayalığa çıkmadan kendi gözlemini yap.</p></section>`;
        getAi().then(ai => {
            const f = root.querySelector('[data-form="ai"]');
            if (!f) return;
            f.elements.model.value = ai.model;
            if (ai.key) f.elements.key.placeholder = 'Kayıtlı (değiştirmek için yenisini yazın)';
        });
    },
    actions: {
        clearai: async (v, root) => { await setAi({ ...(await getAi()), key: '' }); settings.render(root); toast('Anahtar silindi.'); },
        sos: async () => {
            try {
                const p = await locate();
                const text = `Balık avındayım. Konumum (±${p.accuracy} m): ${p.lat}, ${p.lon} https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lon}`;
                if (navigator.share) await navigator.share({ text }).catch(() => {});
                else await copy(text, 'Konum metni kopyalandı; mesajla gönderin.');
            } catch (err) { toast(err.message, 'bad'); }
        },
        export: () => (cacheSet('backup:at', Date.now()), download)(`kilcik-yedek-${new Date().toLocaleDateString('sv-SE')}.json`, JSON.stringify({ app: 'KILCIK', ...app.state }), 'application/json')
    },
    async submit(form, root) {
        const f = form.elements;
        if (form.dataset.form === 'ai') {
            const old = await getAi();
            await setAi({ key: f.key.value.trim() || old.key, model: f.model.value.trim() || old.model });
            settings.render(root);
            return toast('Yapay zekâ ayarı kaydedildi.', 'ok');
        }
        app.state.settings = C.sanitizeState({ settings: { wind: Number(f.wind.value) / 1.852, wave: f.wave.value, alerts: f.alerts.checked, alertScore: f.alertScore.value } }).settings;
        await persist();
        if (app.state.settings.alerts) {
            if (!(await askPermission())) toast('Sistem bildirimi izni yok; uyarılar yalnızca uygulama içinde görünür.', 'bad');
            check();
        }
        settings.render(root);
        toast('Ayarlar kaydedildi.', 'ok');
    },
    async change(field, input, root) {
        const file = input.files?.[0];
        if (field !== 'import' || !file) return;
        let data = null;
        try { data = JSON.parse(await file.text()); } catch {}
        const legacy = Array.isArray(data?.logbook) || Array.isArray(data?.customSpots);
        if (!data || (!legacy && !['spots', 'catches', 'tackle', 'plans'].some(k => Array.isArray(data[k])))) return toast('Geçersiz yedek; hiçbir şey değişmedi.', 'bad');
        const incoming = C.sanitizeState(legacy ? C.fromLegacy(data) : data);
        if (!window.confirm(`Yedekte ${incoming.spots.length} nokta, ${incoming.catches.length} av, ${incoming.tackle.length} malzeme, ${incoming.plans.length} plan var. Mevcut kayıtlara eklensin mi?`)) return;
        app.state = C.mergeState(app.state, incoming);
        await persist();
        settings.render(root);
        toast('Yedek yüklendi.', 'ok');
    }
};
