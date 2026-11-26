// Guncelleme notu: her yeni surumde bir kez gosterilir, menuden yeniden acilabilir.
// Her yayindan once listenin BASINA yeni surum eklenir (sade dil, en fazla 6 madde).
import { esc } from './ui.js';

export const NOTES = [
    {
        v: 31, date: '26.11.2026', title: 'Daha sade ve kolay',
        items: [
            'Alt menü dört düğme: Bugün, Meralar, Hava, Günlük. Diğerleri üstteki ☰ Menü’de.',
            'Bugün ekranında nereye, saat kaçta ve hangi balık tek bakışta.',
            'Harita, mera listesi ve noktalarınız artık Meralar’da.',
            '“Balık tuttum” ve “Boş döndüm” ile birkaç dokunuşta kayıt.',
            'Arkadaşa nokta gönderme, dip işaretleme, gündüz teması ve büyük yazı.',
            'Konum, takım ve hedef balık için: ☰ Menü → Başlangıç tercihleri.'
        ]
    }
];

const KEY = 'surum-notu';
export const markSeen = () => localStorage.setItem(KEY, String(NOTES[0].v));
export const unseen = () => Number(localStorage.getItem(KEY) || 0) < NOTES[0].v;

export function open() {
    document.getElementById('news')?.remove();
    const [latest] = NOTES;
    const box = document.createElement('div');
    box.id = 'news';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Güncelleme notu');
    box.innerHTML = `<div class="sheet"><h1>Uygulama güncellendi</h1><p class="mute">Sürüm ${latest.v} · ${latest.date}</p>
        <section class="card"><h2>${esc(latest.title)}</h2><ul>${latest.items.map(t => `<li>${esc(t)}</li>`).join('')}</ul></section>
        <p class="mute">Kayıtlarınız olduğu gibi duruyor.</p>
        <button type="button" class="btn primary big">Tamam</button><a class="btn big" href="kilavuz.html">Kullanım kılavuzu</a></div>`;
    // Kapatilana veya kilavuz acilana kadar okunmamis sayilir.
    box.addEventListener('click', e => {
        if (!e.target.closest('.btn')) return;
        markSeen();
        box.remove();
    });
    document.body.append(box);
}
