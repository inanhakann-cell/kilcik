// Ilk acilis: konum, takim ve hedef balik. Menuden yeniden acilabilir.
import { TECHNIQUES, SPECIES } from './species.js';
import { cacheGet, cacheSet } from './store.js';
import { app, esc, chips, options, toast, locate } from './ui.js';

const KEY = 'tercih';
export const preferences = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };

let box = null;
let choice = null;

function draw() {
    box.innerHTML = `<div class="sheet"><h1>KILÇIK’a hoş geldiniz</h1><p class="mute">Üç kısa soru. Sonradan menüden değiştirebilirsiniz.</p>
        <section class="card"><h2>1. Nerede avlanıyorsunuz?</h2>
            <button type="button" class="btn big${choice.place ? ' primary' : ''}" data-w="here">${choice.place ? 'Konum alındı ✓' : 'Konumumu kullan'}</button>
            <p class="mute">Konum vermezseniz ${esc(choice.fallback)} ile başlanır.</p></section>
        <section class="card"><h2>2. Takımınız</h2>${chips('w-technique', TECHNIQUES.filter(t => t.id !== 'fly').map(t => [t.id, t.ad]), choice.technique)}</section>
        <section class="card"><h2>3. Hedef balık</h2><select data-w="species" aria-label="Hedef balık">${options([['', 'Fark etmez'], ...SPECIES.filter(s => s.ortam === 'tuzlu').map(s => [s.ad, s.ad])], choice.species)}</select></section>
        <button type="button" class="btn primary big" data-w="done">Başla</button></div>`;
}

async function done() {
    localStorage.setItem(KEY, JSON.stringify({ technique: choice.technique, species: choice.species }));
    app.pref = preferences();
    app.draft.technique = choice.technique;
    if (choice.place) await cacheSet('area', choice.place);
    box.remove();
    box = null;
    // Secimlerin her ekrana islemesi icin uygulama yeniden hesaplanir.
    window.dispatchEvent(new CustomEvent('kilcik:pref', { detail: { place: choice.place } }));
    app.go('bugun');
}

export function open() {
    box?.remove();
    const pref = preferences();
    choice = { technique: pref.technique || 'spin', species: pref.species || '', place: null, fallback: 'Biga kıyıları' };
    box = document.createElement('div');
    box.id = 'welcome';
    box.addEventListener('click', async e => {
        const act = e.target.closest('[data-act="w-technique"]');
        if (act) { e.stopPropagation(); choice.technique = act.dataset.v; return draw(); }
        const w = e.target.closest('button[data-w]')?.dataset.w;
        if (w === 'done') return done();
        if (w !== 'here') return;
        try { const p = await locate(); choice.place = { lat: p.lat, lon: p.lon, name: 'Konumumun çevresi' }; draw(); }
        catch (err) { toast(err.message, 'bad'); }
    });
    box.addEventListener('change', e => { if (e.target.dataset.w === 'species') choice.species = e.target.value; });
    document.body.append(box);
    draw();
}

/** Yalnizca hic kullanilmamis cihazda sorulur. */
export async function firstRun() {
    const used = localStorage.getItem(KEY) || app.state.spots.length || app.state.catches.length || await cacheGet('area');
    if (!used) open();
}
