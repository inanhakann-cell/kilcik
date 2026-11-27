// Takim, dugum ve yem rehberi. Uygulamayla gelir, internetsiz acilir. Genel balikcilik bilgisidir.
import { SPECIES } from '../species.js';
import { esc, opened, fold } from '../ui.js';

const KNOTS = {
    clinch: ['Geliştirilmiş clinch', 'Misinayı fırdöndüye veya iğne gözüne bağlamak', ['Ucu halkadan geçirin.', 'Serbest ucu ana misinanın etrafına 5–7 tur sarın.', 'Ucu halkanın hemen yanındaki ilk ilmekten geçirin.', 'Sonra az önce oluşan büyük ilmekten geçirin.', 'Düğümü ıslatın, ana misinadan yavaşça sıkın, fazlayı kesin.']],
    palomar: ['Palomar', 'İp misinayı halkaya bağlamak', ['Misinanın ucunu ikiye katlayın.', 'Katlı ucu halkadan geçirin.', 'Katlı uçla gevşek bir basit düğüm atın.', 'Fırdöndü veya sahteyi katlı ilmeğin içinden geçirin.', 'Islatın, iki ucu birlikte çekip sıkın.']],
    uni: ['Çift uni', 'İp misinaya lider (fluorocarbon) eklemek', ['İki ucu yan yana, ters yönde üst üste koyun.', 'İp ucuyla bir ilmek yapıp iki misinanın etrafından ilmeğin içinden 7–8 tur dolayın, hafifçe sıkın.', 'Aynısını lider ucuyla 4–5 tur yapın.', 'Islatın; ana hatlardan çekerek iki düğümü birbirine yanaştırın.', 'Uçları kısaltın.']],
    loop: ['Cerrah ilmeği', 'Köstek veya beden ucunda sağlam ilmek', ['Misinanın ucunu katlayın.', 'Katlı kısımla basit düğüm atın.', 'Katlı ucu düğümün içinden bir kez daha geçirin.', 'Islatıp dört kolu birlikte sıkın.']],
    free: ['Kaymayan serbest ilmek', 'Sahtenin serbest yüzmesi için', ['Ana misinada gevşek bir basit düğüm yapın.', 'Ucu sahtenin halkasından geçirin.', 'Ucu basit düğümün içinden, çıktığı taraftan geri geçirin.', 'Ucu ana misinaya 4–5 tur sarın.', 'Ucu yine basit düğümün içinden geri geçirin.', 'Islatıp yavaşça sıkın.']]
};

// t: tur rehberindeki teknik kodlari
const RIGS = [
    { id: 'spin', ad: 'Spin takımı', t: ['spin', 'hafif', 'shorejig'], chain: ['Kamış 2,4–3 m', 'İp misina 0,10–0,18 mm', 'Fluorocarbon lider 0,25–0,40 mm, 60–120 cm', 'Klips', 'Sahte, kaşık veya jig'], tip: 'Dişli balıkta (lüfer, palamut) lideri kalın tutun. Kayalıkta ucu sık sık kontrol edin.', knots: ['uni', 'palomar', 'free'] },
    { id: 'lrf', ad: 'LRF (çok hafif)', t: ['lrf'], chain: ['Kamış 1,8–2,4 m', 'İp misina 0,06–0,08 mm', 'Lider 0,16–0,22 mm, 60 cm', 'Jig başlık 0,8–5 g', '1,5–3 inç silikon'], tip: 'İskele ve mendirekte dipten başlayıp kademe kademe yukarı arayın.', knots: ['uni', 'clinch', 'free'] },
    { id: 'kayan', ad: 'Dip takımı: kayan kurşun', t: ['dip'], chain: ['Ana misina', 'Kayan kurşun 20–60 g', 'Boncuk', 'Fırdöndü', 'Lider 50–100 cm', 'İğne ve yem'], tip: 'Balık yemi alırken ağırlık hissetmez; kumlukta iyi çalışır.', knots: ['clinch'] },
    { id: 'kostek', ad: 'Dip / surf: köstekli takım', t: ['dip'], chain: ['Ana misina + şok lider', 'Beden 1–1,5 m', '1–3 köstek (30–60 cm) ve iğne', 'En altta kurşun 80–150 g'], tip: 'Uzak atışta köstekleri kısa tutun. Uzun atışta şok lider kopmayı ve yaralanmayı önler.', knots: ['loop', 'clinch', 'uni'] },
    { id: 'samandira', ad: 'Şamandıra takımı', t: ['samandira'], chain: ['Ana misina', 'Stoper ve boncuk', 'Şamandıra', 'Ağırlık saçmaları', 'Küçük fırdöndü', 'Lider 50–120 cm', 'İğne ve yem'], tip: 'Yem dipten bir karış yukarıdan başlasın; vuruş yoksa derinliği değiştirin.', knots: ['clinch'] },
    { id: 'capari', ad: 'Çapari', t: ['lrf', 'hafif'], chain: ['Ana misina', 'Hazır çapari (tüylü iğneler)', 'En altta kurşun 20–60 g'], tip: 'İğne sayısı ve yasak dönemleri için güncel resmi tebliği kontrol edin.', knots: ['clinch', 'loop'] },
    { id: 'eging', ad: 'Kalamar / sübye (egi)', t: ['eging'], chain: ['Kamış 2,4–2,7 m', 'İp misina 0,10–0,14 mm', 'Lider 0,25–0,30 mm, 1,5 m', 'Egi 2.5–3.5 numara'], tip: 'Egiyi dibe indirip iki sert silkme yapın, batarken bekleyin; vuruş çoğunlukla batarken olur.', knots: ['uni', 'free'] }
];

let wanted = '';   // secili balik

export function render(root, params = {}) {
    if (params.species !== undefined) wanted = params.species;
    const fish = SPECIES.find(s => s.ad === wanted);
    const open = opened(root);
    const rigs = RIGS.filter(r => !fish || r.t.some(t => fish.t.includes(t)));
    if (fish && rigs[0]) open.add(`rig-${rigs[0].id}`);
    root.innerHTML = `<section class="card"><h1>Takım ve düğüm rehberi</h1>
        <label>Hangi balık için?<select data-field="fish"><option value="">Hepsi</option>${SPECIES.filter(s => s.ortam === 'tuzlu').map(s => `<option${s.ad === wanted ? ' selected' : ''}>${esc(s.ad)}</option>`).join('')}</select></label>
        ${fish ? `<p><b>Yem:</b> ${esc(fish.yem)}</p><p><b>Saat:</b> ${esc(fish.saat)}</p>` : ''}</section>
    <h3>Takımlar</h3>${rigs.length ? rigs.map(r => fold(`rig-${r.id}`, r.ad, `<ol>${r.chain.map(c => `<li>${esc(c)}</li>`).join('')}</ol><p class="mute">Sırayla, kamıştan yeme doğru.</p><p>${esc(r.tip)}</p><p class="mute">Düğümler: ${r.knots.map(k => esc(KNOTS[k][0])).join(', ')}</p>`, open)).join('') : '<section class="card">Bu tür için hazır takım anlatımı yok.</section>'}
    <h3>Düğümler</h3>${Object.entries(KNOTS).map(([id, [name, use, steps]]) => fold(`knot-${id}`, `${name} — ${use}`, `<ol>${steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>`, open)).join('')}
    <p class="mute">Ölçüler yaygın başlangıç değerleridir; kamışınızın atış ağırlığına uyun. Her düğümü ava çıkmadan önce çekerek sınayın.</p>`;
}

export function change(field, value, root) {
    if (field === 'fish') render(root, { species: value });
}
