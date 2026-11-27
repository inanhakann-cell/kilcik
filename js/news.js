// Guncelleme notu: her yeni surumde bir kez gosterilir, menuden yeniden acilabilir.
// Her yayindan once listenin BASINA yeni surum eklenir (sade dil, en fazla 6 madde).
import { esc } from './ui.js';

export const NOTES = [
    {
        v: 38, date: '27.11.2026', title: 'Birlikte daha isabetli',
        items: [
            'İsterseniz av sonuçlarınızı isimsiz paylaşın; çevrede son 14 günde ne çıktığı Bugün ekranında görünür.',
            '☰ Menü’de “Sorun bildir / öneri gönder”.',
            'Fırtına riski varsa Bugün ekranının üstünde uyarı çıkar (resmi uyarı değildir).',
            '☰ Menü → Takım ve düğüm rehberi: internetsiz de açılır.',
            'Dip işaretlerini de isteğe bağlı paylaşabilirsiniz.'
        ]
    },
    {
        v: 37, date: '27.11.2026', title: 'Daha hızlı ve isabetli',
        items: [
            'Rüzgar artık dört hava modelinin ortalaması: kıyı ölçümleriyle sınamada tek tahminden daha yakın çıktı.',
            'Türkiye kıyılarındaki meralar kendi sunucumuzdan gelir; harita sunucusu dolu olsa da listelenir.',
            'Bildirim bölgesi isterseniz bulunduğunuz yeri izler (Menü → Av bildirimi).',
            'Günlük ekranında isabet karnesi: tahmin ne kadar tuttu?',
            'Bugün ekranında “Bu bölgeyi internetsiz için indir” düğmesi.'
        ]
    },
    {
        v: 36, date: '27.11.2026', title: 'Her yerde meralar',
        items: [
            'Uygulama açılınca konumunuz alınır ve çevrenizdeki kıyı meraları gösterilir.',
            'Yalnız Biga değil: gittiğiniz her bölgede yer adı, ada uyarısı ve dip bilgisi aranır.',
            'Denizden uzaktaysanız en yakın kıyı gösterilir. Konum izni sorulunca izin verin.',
            'Yeni bir bölgede ilk açılış internet hızına göre bir iki dakika sürebilir.'
        ]
    },
    {
        v: 35, date: '27.11.2026', title: 'Yakın yer adı',
        items: [
            'Meraların yanında en yakın yerleşimin adı ve kuş uçuşu uzaklığı yazıyor.'
        ]
    },
    {
        v: 34, date: '27.11.2026', title: 'Dip bilgisi',
        items: [
            'Bugün, mera kartları, harita ve noktalarınızda yaklaşık dip bilgisi görünüyor.',
            'Kıyı yapısı (kumsal, çakıl, kayalık) ve daha ayrıntılı dip haritası eklendi.',
            'Dip bilgisi yaklaşıktır; gördüğünüzü işaretlemeyi sürdürün.'
        ]
    },
    {
        v: 33, date: '27.11.2026', title: 'Av bildirimi',
        items: [
            'Yarın balığa değerse akşam 19:00’da sebepleriyle bildirim gelir.',
            'Açılışta izin sorulur; ☰ Menü → Av bildirimi’nden açıp kapatabilirsiniz.',
            'iPhone’da uygulama ana ekrana eklenmiş olmalı (iOS 16.4 veya üstü).',
            'Sunucuya yalnızca bildirim adresi, yaklaşık bölge, hedef balık ve ayar gider.'
        ]
    },
    {
        v: 32, date: '27.11.2026', title: 'Ada noktaları düzeltildi',
        items: [
            'Bugün ekranı artık arada deniz olan ada noktalarını önermiyor.',
            'Adadaki bir noktada “feribot veya tekne gerekir” uyarısı çıkıyor.'
        ]
    },
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
