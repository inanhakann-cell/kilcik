// Menu: alt cubuga sigmayan ekranlar ve gorunum ayarlari.
import * as install from '../install.js';
import * as extras from '../extras.js';
import * as welcome from '../welcome.js';
import * as news from '../news.js';
import * as push from '../push.js';
import * as donus from '../donus.js';
import * as ortak from '../ortak.js';
import { chips, WARNINGS_URL } from '../ui.js';

const ITEMS = [
    ['plan', 'Av planla', 'Nokta, gün ve tekniğe göre saatler'],
    ['noktalar', 'Noktalarım', 'Kayıtlı meralar ve fırsat taraması'],
    ['planlar', 'Kayıtlı planlar', 'Planlar ve takvime ekleme'],
    ['takim', 'Takım çantam', 'Kamış, makine, yem'],
    ['turler', 'Tür rehberi', 'Mevsim, yem ve yasal sınırlar'],
    ['rehber', 'Takım ve düğüm rehberi', 'Hangi balığa nasıl takım, internetsiz'],
    ['ayarlar', 'Ayarlar ve yedek', 'Güvenlik sınırları, yedek indir ve yükle']
];

export function render(root) {
    const look = extras.look();
    root.innerHTML = `<section class="card"><h2>QR ile kur</h2><p class="mute">Arkadaşınız kamerasıyla okutup uygulamayı telefonuna eklesin.</p><a class="btn primary big" href="qr.html">QR kodunu göster</a></section>${push.card()}${donus.followCard()}<div class="menu">${ITEMS.map(([v, title, text]) => `<button type="button" class="card" data-nav="${v}"><b>${title}</b><small>${text}</small></button>`).join('')}
        <button type="button" class="card" data-act="welcome"><b>Başlangıç tercihleri</b><small>Konum, takım ve hedef balık</small></button>
        <a class="card" href="${WARNINGS_URL}" target="_blank" rel="noopener"><b>Meteoroloji uyarıları</b><small>Resmi fırtına ve yağış uyarıları (MGM)</small></a>
        <button type="button" class="card" data-act="news"><b>Yenilikler</b><small>Son güncellemede neler değişti</small></button>
        <a class="card" href="kilavuz.html"><b>Kullanım kılavuzu</b><small>Her ekran ve düğme ne işe yarar</small></a></div>
        <section class="card"><h2>Görünüm</h2>${chips('theme', [['koyu', 'Koyu'], ['acik', 'Gündüz (açık)']], look.theme)}<div class="row">${chips('text', [['normal', 'Normal yazı'], ['buyuk', 'Büyük yazı']], look.text)}</div></section>
        ${ortak.shareCard()}${ortak.feedbackCard()}
        ${install.card()}`;
    push.paint(root);
}

export const change = (field, value, root) => (ortak.toggle(field) ? render(root) : push.change(field, root));
export const submit = form => ortak.sendFeedback(form);

export const actions = {
    ...push.actions,
    ...donus.followActions,
    theme: (v, root) => { extras.setLook('theme', v); render(root); },
    text: (v, root) => { extras.setLook('text', v); render(root); },
    welcome: () => welcome.open(),
    news: () => news.open()
};
