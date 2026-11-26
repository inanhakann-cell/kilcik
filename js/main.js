import { app, $, toast } from './ui.js';
import { loadState, cacheGet, cacheSet } from './store.js';
import * as plan from './views/plan.js';
import * as map from './views/map.js';
import * as log from './views/log.js';
import { spots, plans, tackle, settings } from './views/lists.js';
import * as species from './views/species.js';
import { check } from './alerts.js';
import * as today from './views/today.js';
import * as weather from './views/weather.js';
import * as explore from './views/explore.js';
import * as session from './session.js';
import * as more from './views/more.js';
import * as guide from './guide.js';
import * as install from './install.js';

const VIEWS = { bugun: today, hava: weather, kesif: explore, plan, harita: map, noktalar: spots, planlar: plans, takim: tackle, gunluk: log, turler: species, ayarlar: settings, daha: more };
// Telefonda "Daha" altinda duran ekranlar
const IN_MORE = ['plan', 'noktalar', 'planlar', 'takim', 'turler', 'ayarlar'];
let current = 'bugun';
const root = () => $(`#view-${current}`);

let depth = 0;   // geri donulebilecek ekran sayisi
const positions = [];

app.go = (name, params = {}, fromHistory = false) => {
    const next = VIEWS[name] ? name : 'bugun';
    if (!fromHistory && next !== current) {
        positions[depth] = window.scrollY;
        depth += 1;
        history.pushState({ view: next, depth }, '');
    }
    current = next;
    if (current === 'plan' && params.draft) plan.openPlan(params.draft);
    document.querySelectorAll('.view').forEach(v => { v.hidden = v.id !== `view-${current}`; });
    document.querySelectorAll('[data-nav]').forEach(b => b.setAttribute('aria-current', b.dataset.nav === current || (b.dataset.nav === 'daha' && IN_MORE.includes(current)) ? 'page' : 'false'));
    $('#back').hidden = depth === 0;
    VIEWS[current].render(root(), params);
    window.scrollTo(0, fromHistory ? positions[depth] || 0 : 0);
};

history.replaceState({ view: 'bugun', depth: 0 }, '');
window.addEventListener('popstate', e => {
    if (guide.close()) return;
    depth = e.state?.depth || 0;
    app.go(e.state?.view || 'bugun', {}, true);
});

document.addEventListener('click', e => {
    if (e.target.closest('#back')) return history.back();
    const lead = e.target.closest('[data-guide]');
    if (lead) {
        const [lat, lon] = lead.dataset.guide.split(',').map(Number);
        return guide.open(lat, lon, lead.dataset.name);
    }
    const setup = e.target.closest('[data-install]');
    if (setup) return install.choose(setup.dataset.install, setup.closest('.install'));
    const nav = e.target.closest('[data-nav]');
    if (nav) return app.go(nav.dataset.nav);
    const el = e.target.closest('[data-act]');
    if (el) VIEWS[current].actions?.[el.dataset.act]?.(el.dataset.v, root());
});
document.addEventListener('change', e => {
    const field = e.target.dataset?.field;
    if (field) VIEWS[current].change?.(field, field === 'import' ? e.target : e.target.value, root());
});
document.addEventListener('submit', e => {
    e.preventDefault();
    if (e.target.dataset.form === 'session') return session.submit(e.target, () => app.go(current));
    VIEWS[current].submit?.(e.target, root());
});

// Klavye acikken alt cubuk yazi alanini kapatmasin.
const TEXT = 'textarea,input:not([type=checkbox]):not([type=radio]):not([type=file])';
document.addEventListener('focusin', e => document.body.classList.toggle('typing', e.target.matches(TEXT)));
document.addEventListener('focusout', () => document.body.classList.remove('typing'));

let lastY = 0;
window.addEventListener('scroll', () => {
    const y = window.scrollY;
    if (Math.abs(y - lastY) < 8) return;
    document.body.classList.toggle('reading', y > lastY && y > 90);
    lastY = y;
}, { passive: true });

const net = () => { $('#offline').hidden = navigator.onLine; };
window.addEventListener('online', net);
window.addEventListener('offline', net);

try {
    app.state = await loadState();
    app.draft = plan.defaultDraft();
    await session.init();
    net();
    app.go('bugun');
    // Ana ekran simgesine basili tutunca acilan kisayollar
    const start = new URLSearchParams(location.search).get('git');
    if (start) app.go(start);
    session.backfill().catch(() => {});
    window.addEventListener('online', () => session.backfill().catch(() => {}));
    today.autoRefresh();
    navigator.storage?.persist?.().catch(() => {});
    setTimeout(check, 5000);
    // Kayitlar yalnizca bu cihazda: iki haftada bir yedek hatirlatilir.
    cacheGet('backup:at').then(at => {
        if (app.state.catches.length < 3) return;
        if (!at) cacheSet('backup:at', Date.now() - 13 * 86400000);
        else if (Date.now() - at > 14 * 86400000) toast('Av günlüğünüzü yedekleyin: Ayarlar → Yedek indir.', 'warn');
    });
    setInterval(check, 3 * 3600000);
} catch (err) {
    console.error(err);
    toast('Uygulama kayıtları açılamadı. Tarayıcıda site verisine izin verin.', 'bad');
}
if ('serviceWorker' in navigator) {
    // Yeni surum geldiginde eski ekran kalmasin diye bir kez yenilenir.
    if (navigator.serviceWorker.controller) navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('Çevrimdışı mod kurulamadı:', err.message));
}
