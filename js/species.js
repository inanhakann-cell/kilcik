// Genel balikcilik bilgisi (yaygin kabuller). Resmi veya bolgesel olarak dogrulanmis degildir.
// aylar: 1-12, su: tercih edilen su sicakligi araligi (C), t: teknik kodlari
const S = (ad, ortam, aylar, su, t, saat, yem) => ({ ad, ortam, aylar, su, t, saat, yem });

export const TECHNIQUES = [
    { id: 'spin', ad: 'Spin', wind: [4, 18], wave: [0.2, 0.9] },
    { id: 'hafif', ad: 'Hafif spin', wind: [0, 12], wave: [0, 0.5] },
    { id: 'lrf', ad: 'LRF', wind: [0, 10], wave: [0, 0.35] },
    { id: 'shorejig', ad: 'Shore jig', wind: [4, 18], wave: [0.2, 1] },
    { id: 'dip', ad: 'Dip / surf (yemli)', wind: [3, 17], wave: [0.15, 0.8] },
    { id: 'samandira', ad: 'Şamandıra', wind: [0, 10], wave: [0, 0.35] },
    { id: 'eging', ad: 'Kalamar (egi)', wind: [0, 10], wave: [0, 0.4] },
    { id: 'fly', ad: 'Fly', wind: [0, 8], wave: [0, 0.3] }
];

export const SPECIES = [
    S('Levrek', 'tuzlu', [1, 2, 3, 4, 10, 11, 12], [9, 19], ['spin', 'dip', 'hafif'], 'şafak, akşam, gece; köpüklü su', 'minnow, silikon, canlı karides'),
    S('Lüfer / Çinekop', 'tuzlu', [8, 9, 10, 11, 12], [13, 23], ['spin', 'shorejig', 'dip'], 'gün doğumu ve batımı', 'kaşık, metal jig, zargana/istavrit fileto'),
    S('Palamut', 'tuzlu', [8, 9, 10, 11], [14, 22], ['shorejig', 'spin'], 'sabah', 'metal jig, kaşık, çapari'),
    S('İstavrit', 'tuzlu', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], [9, 24], ['lrf', 'hafif', 'samandira'], 'akşam, gece, ışık altı', 'küçük silikon, çapari'),
    S('Çipura', 'tuzlu', [4, 5, 6, 7, 8, 9, 10, 11], [15, 25], ['dip'], 'sabah ve ikindi', 'mamun, sülünez, yengeç'),
    S('Mırmır', 'tuzlu', [5, 6, 7, 8, 9, 10], [17, 26], ['dip'], 'akşam ve gece; kumluk', 'boru kurdu, mamun'),
    S('Karagöz / Sargoz', 'tuzlu', [3, 4, 5, 6, 7, 8, 9, 10, 11], [13, 24], ['dip', 'samandira', 'lrf'], 'sabah ve akşam; taşlık', 'karides, kurt, hamur'),
    S('Kalamar', 'tuzlu', [1, 2, 3, 10, 11, 12], [10, 19], ['eging'], 'gün batımı ve gece', '2.5-3.5 no egi'),
    S('Sübye', 'tuzlu', [2, 3, 4, 5, 10, 11], [11, 20], ['eging'], 'gündüz ve akşam; kumluk-erişte', 'egi, sübye zokası'),
    S('Zargana', 'tuzlu', [4, 5, 6, 9, 10, 11], [14, 24], ['samandira', 'hafif'], 'gündüz, sakin su', 'ipek, küçük kaşık'),
    S('Kefal', 'tuzlu', [4, 5, 6, 7, 8, 9, 10, 11], [14, 27], ['samandira', 'fly'], 'gündüz; liman ve dere ağzı', 'ekmek, hamur'),
    S('İzmarit', 'tuzlu', [1, 2, 3, 4, 10, 11, 12], [10, 19], ['lrf', 'dip'], 'gündüz', 'küçük yem, kurt'),
    S('Sazan', 'tatli', [4, 5, 6, 7, 8, 9, 10], [14, 28], ['dip', 'samandira'], 'şafak, akşam, gece', 'mısır, boilie, hamur'),
    S('Turna', 'tatli', [3, 4, 9, 10, 11, 12], [6, 18], ['spin'], 'sabah ve akşam; sazlık', 'kaşık, büyük silikon'),
    S('Sudak', 'tatli', [4, 5, 9, 10, 11], [9, 20], ['spin', 'dip'], 'alacakaranlık', 'jighead silikon'),
    S('Yayın', 'tatli', [5, 6, 7, 8, 9], [18, 28], ['dip'], 'gece', 'ciğer, solucan, canlı yem'),
    S('Tatlı su levreği', 'tatli', [3, 4, 5, 9, 10, 11], [8, 20], ['lrf', 'hafif', 'spin'], 'gündüz', 'küçük kaşık, silikon'),
    S('Alabalık', 'tatli', [3, 4, 5, 6, 9], [4, 16], ['fly', 'hafif', 'lrf'], 'sabah; serin, akan su', 'döner kaşık, sinek'),
    S('Tatlı su kefali', 'tatli', [4, 5, 6, 7, 8, 9, 10], [10, 24], ['hafif', 'samandira', 'fly'], 'gündüz', 'küçük kaşık, ekmek')
];

export const LATIN = { 'Levrek': 'Dicentrarchus labrax', 'Lüfer / Çinekop': 'Pomatomus saltatrix', 'Palamut': 'Sarda sarda', 'İstavrit': 'Trachurus trachurus', 'Çipura': 'Sparus aurata', 'Mırmır': 'Lithognathus mormyrus', 'Karagöz / Sargoz': 'Diplodus vulgaris', 'Kalamar': 'Loligo vulgaris', 'Sübye': 'Sepia officinalis', 'Zargana': 'Belone belone', 'Kefal': 'Mugil cephalus', 'İzmarit': 'Spicara', 'Sazan': 'Cyprinus carpio', 'Turna': 'Esox lucius', 'Sudak': 'Sander lucioperca', 'Yayın': 'Silurus glanis', 'Tatlı su levreği': 'Perca fluviatilis', 'Alabalık': 'Salmo trutta', 'Tatlı su kefali': 'Squalius cephalus' };

export const LEGAL_URL = 'https://mevzuat.gov.tr/MevzuatMetin/yonetmelik/9.5.40946.pdf';

// Eski surumdeki kiyi noktalari: koordinatlar dogrulanmadi.
export const SAMPLE_SPOTS = [
    ['Karabiga Mendirek', 40.4021, 27.3087], ['Karabiga Burun', 40.4085, 27.311], ['Aksaz Burnu', 40.4295, 27.2315],
    ['Şahmelek Kıyısı', 40.415, 27.177], ['Kemer / Parion', 40.4305, 27.0685], ['Kocabaş Çayı Ağzı', 40.3885, 27.3245],
    ['Ayazma', 39.8085, 26.012], ['Habbele', 39.8145, 25.9955], ['Bozcaada Liman', 39.8365, 26.0762], ['Odunluk İskelesi', 39.8185, 26.1535]
];
