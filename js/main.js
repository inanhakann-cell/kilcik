import { app, $, toast } from './ui.js';
import { loadState, cacheGet } from './store.js';
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
import * as donus from './donus.js';
import * as more from './views/more.js';
import * as archive from './views/archive.js';
import * as paylasim from './paylasim.js';
import * as guide from './guide.js';
import * as install from './install.js';
import * as extras from './extras.js';
import * as welcome from './welcome.js';
import * as news from './news.js';
import * as push from './push.js';
import * as ortak from './ortak.js';
import * as rehber from './views/rehber.js';
import * as ses from './ses.js';
import { loadLands } from './places.js';
import { loadDip } from './dip.js';

// Baska bir sitenin cercevesi icinde calismaz (tiklama tuzagina karsi).
if (window.top !== window.self) {
    document.body.textContent = 'KILÇIK başka bir sayfanın içinde açılamaz.';
    throw new Error('cerceve icinde');
}

const VIEWS = { bugun: today, hava: weather, kesif: explore, plan, harita: map, noktalar: spots, planlar: plans, takim: tackle, gunluk: log, turler: species, rehber, ayarlar: settings, daha: more, arsiv: archive };
// Telefonda menu altinda duran ekranlar
const IN_MORE = ['plan', 'planlar', 'takim', 'turler', 'rehber', 'ayarlar'];
// Alt cubukta Meralar secili gorunen ekranlar
const IN_SPOTS = ['kesif', 'harita', 'noktalar'];
const PHONE = matchMedia('(max-width:899px),(max-height:500px)');
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
    document.querySelectorAll('[data-nav]').forEach(b => b.setAttribute('aria-current', b.dataset.nav === current || (b.dataset.nav === 'daha' && IN_MORE.includes(current)) || (b.matches('nav [data-nav="kesif"]') && IN_SPOTS.includes(current) && PHONE.matches) ? 'page' : 'false'));
    $('#back').hidden = depth === 0;
    $('#menu').hidden = current === 'bugun' || current === 'daha';
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
    const send = e.target.closest('[data-share]');
    if (send) return extras.share(...send.dataset.share.split(',').map(Number), send.dataset.name);
    const floor = e.target.closest('[data-floor]');
    if (floor) return extras.toggleFloor(floor);
    if (e.target.closest('[data-backup]')) return extras.backup(e.target.closest('[data-backup]')).then(() => app.go(current));
    const nav = e.target.closest('[data-nav]');
    // Meralar sekmesi harita ile acilir.
    if (nav) return app.go(nav.dataset.nav === 'kesif' && nav.closest('body > nav') && PHONE.matches ? 'harita' : nav.dataset.nav);
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
    // Daha once kullanilmis cihazda kayit zaten vardir (loadState ilk acilista olusturur).
    const returning = Boolean(await cacheGet('state'));
    app.state = await loadState();
    app.pref = welcome.preferences();
    app.draft = plan.defaultDraft();
    app.draft.technique = app.pref.technique || app.draft.technique;
    await session.init();
    net();
    // Ada uyarilari ekran cizilmeden hazir olsun (uygulamayla gelen dosya).
    await Promise.all([loadLands().catch(() => {}), loadDip()]);
    // Daha once kullanilan cihazda acilista konum okunur (yeni kullaniciya karsilama ekrani sorar).
    if (returning) today.followLocation();
    app.go('bugun');
    // Ana ekran simgesine basili tutunca acilan kisayollar
    const start = new URLSearchParams(location.search).get('git');
    if (start && Object.hasOwn(VIEWS, start)) app.go(start);
    // Arkadastan gelen nokta baglantisi
    const received = await extras.receiveFromAddress();
    // Yeni kullanici tanisma sorularini, eski kullanici guncelleme notunu bir kez gorur.
    if (!returning) { news.markSeen(); if (!received) await welcome.firstRun(); }
    else if (news.unseen()) news.open();
    ses.start();
    // Bildirim izni sorusu diger acilis pencerelerinden sonra bir kez cikar.
    push.prompt();
    window.addEventListener('hashchange', () => extras.receiveFromAddress());
    session.backfill().catch(() => {});
    window.addEventListener('online', () => session.backfill().catch(() => {}));
    // Gonderilemeyen "Dondum" yeniden denenir; yakin kodunun suresi yenilenir.
    donus.retry(() => app.go(current));
    window.addEventListener('online', () => donus.retry(() => app.go(current)));
    donus.renew();
    paylasim.start();
    // Paylasim durumu degisince acik form yoksa gunluk yenilenir.
    window.addEventListener('kilcik:shared', () => { if (current === 'gunluk' && !document.querySelector('[data-form="catch"]')) log.render(root()); });
    today.autoRefresh();
    ortak.start();
    navigator.storage?.persist?.().catch(() => {});
    setTimeout(check, 5000);
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
