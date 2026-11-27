// Tur rehberi: mevsim takvimi, yontem, yasal sinirlar ve iNaturalist fotografi.
import { SPECIES, TECHNIQUES, LATIN, LEGAL_URL } from '../species.js';
import { ruleFor, ruleText, inClosedSeason, LEGAL_DATE } from '../legal.js';
import { getJson } from '../api.js';
import { cacheGet, cacheSet } from '../store.js';
import { app, esc, chips, toast } from '../ui.js';

const MONTHS = ['O', 'Ş', 'M', 'N', 'M', 'H', 'T', 'A', 'E', 'E', 'K', 'A'];
let water = 'tuzlu';

export function render(root) {
    const today = new Date().toLocaleDateString('sv-SE');
    const month = Number(today.slice(5, 7));
    const list = SPECIES.filter(s => s.ortam === water).sort((a, b) => b.aylar.includes(month) - a.aylar.includes(month));
    root.innerHTML = `<section class="card"><h1>Tür rehberi</h1>${chips('water', [['tuzlu', 'Deniz'], ['tatli', 'Tatlı su']], water)}
        <p class="mute">Yasal sınırlar: 6/2 tebliğ metni, ${LEGAL_DATE} tarihinde okundu. <a href="${LEGAL_URL}" target="_blank" rel="noopener">Resmi metin</a>. Mevsim ve yöntem bilgisi genel balıkçılık bilgisidir.</p></section>
    <div class="cols">${list.map(s => {
        const r = ruleFor(s.ad);
        return `<section class="card"><div class="row between"><h2>${esc(s.ad)}</h2><span class="pill ${inClosedSeason(r, today) ? 'bad' : s.aylar.includes(month) ? 'ok' : 'mute'}">${inClosedSeason(r, today) ? 'Av yasağı' : s.aylar.includes(month) ? 'Mevsiminde' : 'Mevsim dışı'}</span></div>
            <div class="months">${MONTHS.map((m, i) => `<span class="${s.aylar.includes(i + 1) ? 'on' : ''}${i + 1 === month ? ' now' : ''}">${m}</span>`).join('')}</div>
            <p>${esc(`${s.yem} · ${s.saat}`)}</p><p class="mute">Su ${s.su[0]}–${s.su[1]} °C · ${esc(TECHNIQUES.filter(t => s.t.includes(t.id)).map(t => t.ad).join(', '))}</p>
            ${r ? `<p><b>${esc(ruleText(r))}</b></p>${r.not ? `<p class="mute">${esc(r.not)}</p>` : ''}` : ''}
            <div class="row wrap"><button class="btn" data-act="photo" data-v="${esc(s.ad)}">Fotoğraf göster</button><button class="btn" data-act="plan" data-v="${esc(s.ad)}">Bu tür için planla</button>${s.ortam === 'tuzlu' ? `<button class="btn" data-act="rig" data-v="${esc(s.ad)}">Takımı gör</button>` : ''}</div><div class="ph"></div></section>`;
    }).join('')}</div>`;
}

export const actions = {
    rig: v => app.go('rehber', { species: v }),
    water: (v, root) => { water = v; render(root); },
    plan: v => { const s = SPECIES.find(x => x.ad === v); app.go('plan', { draft: { species: v, water: s.ortam, technique: s.t[0] } }); },
    photo: async (v, root) => {
        const box = [...root.querySelectorAll('[data-act="photo"]')].find(b => b.dataset.v === v).closest('.card').querySelector('.ph');
        try {
            let p = await cacheGet(`taxon:${v}`);
            if (!p) {
                const t = (await getJson(`https://api.inaturalist.org/v1/taxa?q=${encodeURIComponent(LATIN[v])}&per_page=1`)).results[0];
                p = { url: t.default_photo.medium_url, by: t.default_photo.attribution, page: `https://www.inaturalist.org/taxa/${t.id}`, latin: t.name };
                await cacheSet(`taxon:${v}`, p);
            }
            box.innerHTML = `<img class="photo" src="${esc(p.url)}" alt="${esc(v)}"><p class="mute"><i>${esc(p.latin)}</i> · ${esc(p.by)} · <a href="${esc(p.page)}" target="_blank" rel="noopener">iNaturalist</a></p>`;
        } catch { toast('Fotoğraf alınamadı.', 'bad'); }
    }
};
