// Uygulama acikken (veya arka planda sekme olarak dururken) firsat ve plan gunu bildirimleri.
// Sunucu olmadigi icin uygulama tamamen kapaliyken bildirim gonderilemez.
import { app, toast } from './ui.js';
import { cacheGet, cacheSet } from './store.js';
import { scanSpots } from './planner.js';

const supported = () => 'Notification' in window;

export async function askPermission() {
    if (!supported()) return false;
    return (await Notification.requestPermission()) === 'granted';
}

async function notify(title, body) {
    toast(`${title}: ${body}`, 'ok');
    if (!supported() || Notification.permission !== 'granted') return;
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) await reg.showNotification(title, { body, icon: 'icons/icon-192.png' });
    else new Notification(title, { body, icon: 'icons/icon-192.png' });
}

let busy = false;
export async function check() {
    const { alerts, alertScore } = app.state.settings;
    if (!alerts || busy || !navigator.onLine) return;
    busy = true;
    try {
        const today = new Date().toLocaleDateString('sv-SE');
        const sent = (await cacheGet('alerts:sent')) || {};
        const once = async (key, title, body) => {
            if (sent[key]) return;
            sent[key] = Date.now();
            await notify(title, body);
        };
        for (const p of app.state.plans.filter(p => p.date === today))
            await once(`plan:${p.id}:${today}`, 'Bugün av planınız var', `${p.name} ${p.window}. Gitmeden güvenliği kontrol edin.`);
        const { found } = await scanSpots(app.state.spots.slice(0, 12), app.draft.technique, 2);
        for (const f of found.filter(f => f.score >= alertScore && f.level === 'go' && f.fromMs > Date.now()).slice(0, 3))
            await once(`win:${f.spot.id}:${f.date}`, `${f.spot.name}: puan ${f.score}`, `${f.date.slice(8)}.${f.date.slice(5, 7)} saat ${f.from.slice(11)}–${f.to.slice(11)}`);
        const keep = Object.fromEntries(Object.entries(sent).filter(([, t]) => Date.now() - t < 20 * 86400000));
        await cacheSet('alerts:sent', keep);
    } finally { busy = false; }
}
