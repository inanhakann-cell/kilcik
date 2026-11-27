// Firtina nobeti: gidilecek saat icin hava bozarsa bildirim sunucusu haber verir.
import * as C from './core.js';
import * as push from './push.js';
import { esc, toast } from './ui.js';

const KEY = 'firtina-nobeti';
export const MAX_DAYS = 7;
const saved = () => { try { const w = JSON.parse(localStorage.getItem(KEY)); return w?.to > Date.now() ? w : null; } catch { return null; } };
export const forget = () => localStorage.removeItem(KEY);

const when = w => `${new Date(w.from).toLocaleString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })} – ${new Date(w.to).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}`;

/** Secilen gun ve saatlerin zaman araligi; bitis baslangictan once ise ertesi gune tasar. */
export function range(date, start, end, offset) {
    const from = C.toMs(`${date}T${start}`, offset);
    const to = C.toMs(`${date}T${end}`, offset);
    return { from, to: to > from ? to : to + 86400000 };
}

export function card(pack, date, window_) {
    if (!push.offered()) return '';
    const on = saved();
    const far = C.toMs(`${date}T00:00`, pack.offset) - Date.now() > MAX_DAYS * 86400000;
    // Bu gune kurulu nobet varsa kutularda onun saatleri gorunur.
    const same = on && C.localIso(on.from, pack.offset).slice(0, 10) === date;
    const start = same ? C.localIso(on.from, pack.offset).slice(11, 16) : window_ ? C.hhmm(window_.from) : '06:00';
    const end = same ? C.localIso(on.to, pack.offset).slice(11, 16) : window_ ? C.hhmm(window_.to) : '10:00';
    return `<section class="card" id="nobet"><h2>Hava bozarsa haber ver</h2>
        ${on ? `<p>Açık nöbet: <b class="ok">${esc(on.name)}</b><br>${esc(when(on))}</p>${on.warning ? `<p class="banner bad">⚠ ${esc(on.warning)}</p>` : ''}<div class="row wrap"><button type="button" class="btn" data-act="nobetsil">Nöbeti kapat</button></div>` : ''}
        ${far ? `<p class="mute">Nöbet en fazla ${MAX_DAYS} gün sonrası için kurulabilir.</p>` : `<div class="grid2"><label>Gideceğim saat<input type="time" name="nobetbas" value="${start}"></label><label>Döneceğim saat<input type="time" name="nobetson" value="${end}"></label></div>
        <button type="button" class="btn big" data-act="nobetkur">${on ? 'Nöbeti bu plana taşı' : 'Haber ver'}</button>`}
        <p class="mute">Seçtiğiniz saatlerde sert rüzgar, yüksek dalga veya gök gürültüsü tahmin edilirse bildirim gelir. Son 3 günde saatte bir kontrol edilir. Sunucu, saat geçene kadar bildirim adresini, yaklaşık konumu (1 km) ve saatleri saklar. Tahmindir; resmi uyarının yerine geçmez.</p></section>`;
}

export async function start({ pack, lat, lon, name, date }, root) {
    const from = root.querySelector('[name=nobetbas]')?.value;
    const to = root.querySelector('[name=nobetson]')?.value;
    if (!from || !to) return toast('Saatleri seçin.', 'bad');
    const span = range(date, from, to, pack.offset);
    if (span.to <= Date.now()) return toast('Bu saat geçmiş.', 'bad');
    const storm = C.stormAhead(pack, Math.max(span.from, Date.now()), (span.to - Math.max(span.from, Date.now())) / 3600000);
    try {
        // iPhone izni dokunustan hemen sonra sorulabildigi icin once abonelik alinir.
        const sub = await push.subscription();
        await push.post('/nobet', { sub: sub.toJSON(), area: { lat, lon, name }, ...span, level: C.stormLevel(storm) });
        const warning = storm ? `Şu anki tahminde bu saatlerde hava sert: ${C.stormParts(storm).join(', ')}.` : '';
        localStorage.setItem(KEY, JSON.stringify({ ...span, name, warning }));
        toast(storm ? 'Nöbet kuruldu. Dikkat: hava şimdiden sert görünüyor.' : 'Nöbet kuruldu. Hava bozarsa haber vereceğiz.', storm ? 'bad' : 'ok');
    } catch (err) { toast(`Nöbet kurulamadı: ${err.message}`, 'bad'); }
}

export async function stop() {
    try {
        const sub = await push.current();
        if (sub) await push.post('/nobet-sil', { endpoint: sub.endpoint });
        forget();
        toast('Nöbet kapatıldı.', 'ok');
    } catch (err) { toast(`Kapatılamadı: ${err.message}`, 'bad'); }
}
