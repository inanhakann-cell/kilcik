// Ana ekrana ekleme yonergesi (yalnizca telefonda ve henuz eklenmemisse).
let prompt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); prompt = e; });
const installed = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const phone = () => matchMedia('(pointer: coarse)').matches;
const apple = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function card() {
    if (!phone() || installed() || localStorage.getItem('kurulum') === 'gizli') return '';
    const how = apple()
        ? 'Safari’de alttaki <b>Paylaş</b> simgesine, sonra <b>Ana Ekrana Ekle</b>’ye dokunun. iPhone, simgeden açılan uygulamanın kayıtlarını ayrı tutar: kayıt girmeden önce ekleyin.'
        : prompt ? 'Uygulamayı ana ekrana simge olarak kurabilirsiniz.' : 'Chrome’da sağ üstteki <b>⋮</b> menüsünden <b>Uygulamayı yükle</b> veya <b>Ana ekrana ekle</b>’yi seçin.';
    return `<section class="card install"><h2>Telefona kur</h2><p>${how}</p><div class="row wrap">${prompt ? '<button class="btn primary" data-install="yes">Uygulamayı yükle</button>' : ''}<button class="btn" data-install="no">Bir daha gösterme</button></div></section>`;
}

export async function choose(answer, node) {
    if (answer === 'no') localStorage.setItem('kurulum', 'gizli');
    else if (prompt) { await prompt.prompt(); prompt = null; }
    node.remove();
}
