// Telefonda alt cubuga sigmayan ekranlar.
import * as install from '../install.js';

const ITEMS = [
    ['plan', 'Av planla', 'Nokta, gün ve tekniğe göre saatler'],
    ['noktalar', 'Noktalarım', 'Kayıtlı meralar ve fırsat taraması'],
    ['planlar', 'Kayıtlı planlar', 'Planlar ve takvime ekleme'],
    ['takim', 'Takım çantam', 'Kamış, makine, yem'],
    ['turler', 'Tür rehberi', 'Mevsim, yem ve yasal sınırlar'],
    ['ayarlar', 'Ayarlar ve yedek', 'Güvenlik sınırları, yedek indir ve yükle']
];

export function render(root) {
    root.innerHTML = `<div class="menu">${ITEMS.map(([v, title, text]) => `<button type="button" class="card" data-nav="${v}"><b>${title}</b><small>${text}</small></button>`).join('')}<a class="card" href="kilavuz.html"><b>Kullanım kılavuzu</b><small>Her ekran ve düğme ne işe yarar</small></a></div>${install.card()}`;
}
