// Telefonda noktaya yuruyerek ulasma: canli mesafe ve yon. Ekran acik tutulur.
import { esc, toast, mapsUrl } from './ui.js';

const NAMES = ['Kuzey', 'Kuzeydoğu', 'Doğu', 'Güneydoğu', 'Güney', 'Güneybatı', 'Batı', 'Kuzeybatı'];
const rad = d => d * Math.PI / 180;

/** Iki nokta arasi mesafe (m) ve pusula yonu (derece). */
export function course(from, to) {
    const dLat = rad(to.lat - from.lat), dLon = rad(to.lon - from.lon);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(from.lat)) * Math.cos(rad(to.lat)) * Math.sin(dLon / 2) ** 2;
    const y = Math.sin(dLon) * Math.cos(rad(to.lat));
    const x = Math.cos(rad(from.lat)) * Math.sin(rad(to.lat)) - Math.sin(rad(from.lat)) * Math.cos(rad(to.lat)) * Math.cos(dLon);
    const bearing = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    return { metres: 12742000 * Math.asin(Math.sqrt(a)), bearing, name: NAMES[Math.round(bearing / 45) % 8] };
}

let box = null, watch = null, lock = null;

async function keepAwake() {
    try { lock = await navigator.wakeLock?.request('screen'); } catch { lock = null; }
}
document.addEventListener('visibilitychange', () => { if (box && !document.hidden) keepAwake(); });

export function open(lat, lon, name) {
    if (!navigator.geolocation) return toast('Bu cihazda konum desteklenmiyor.', 'bad');
    close();
    const target = { lat, lon };
    box = document.createElement('div');
    box.id = 'guide';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Noktaya yönlendirme');
    box.innerHTML = `<p class="mute">Noktaya yönlendirme</p><h1>${esc(name || 'Seçilen nokta')}</h1><p class="mono">${lat.toFixed(5)}, ${lon.toFixed(5)}</p>
        <div class="needle" hidden>↑</div><p class="far">Konum aranıyor…</p><p class="way"></p><p class="mute acc"></p>
        <p class="warn">Kuş uçuşu yöndür; yol, kayalık, özel mülk ve yasak alanları göstermez.</p>
        <div class="row wrap"><a class="btn" href="${mapsUrl(lat, lon)}" target="_blank" rel="noopener">Yol tarifi</a><button class="btn primary" data-guide-close>Kapat</button></div>`;
    box.querySelector('[data-guide-close]').addEventListener('click', () => history.back());
    document.body.append(box);
    history.pushState({ ...history.state, guide: true }, '');
    const set = (cls, text) => { box.querySelector(cls).textContent = text; };
    watch = navigator.geolocation.watchPosition(p => {
        const here = { lat: p.coords.latitude, lon: p.coords.longitude };
        const c = course(here, target);
        const moving = Number.isFinite(p.coords.heading) && p.coords.speed > 0.5;
        const needle = box.querySelector('.needle');
        needle.hidden = false;
        needle.style.transform = `rotate(${Math.round(c.bearing - (moving ? p.coords.heading : 0))}deg)`;
        const near = c.metres <= Math.max(15, p.coords.accuracy);
        set('.far', near ? 'Noktadasınız' : c.metres < 1000 ? `${Math.round(c.metres)} m` : `${(c.metres / 1000).toFixed(1)} km`);
        set('.way', `${c.name} yönünde · ${Math.round(c.bearing)}°`);
        set('.acc', `Konum doğruluğu ±${Math.round(p.coords.accuracy)} m · ok ${moving ? 'yürüdüğünüz yöne göre' : 'kuzey yukarıda kabul edilerek'} gösteriliyor`);
    }, () => set('.far', 'Konum alınamadı. Konum iznini kontrol edin.'), { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
    keepAwake();
}

/** Aciksa kapatir ve true dondurur. */
export function close() {
    if (!box) return false;
    navigator.geolocation.clearWatch(watch);
    lock?.release?.().catch(() => {});
    box.remove();
    box = lock = null;
    return true;
}

export const button = (lat, lon, name) => `<button type="button" class="btn" data-guide="${lat},${lon}" data-name="${esc(name)}">Noktaya götür</button>`;
