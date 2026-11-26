// Istege bagli yapay zeka: kullanicinin kendi Google Gemini anahtari. Anahtar yedege dahil edilmez.
import { cacheGet, cacheSet } from './store.js';

export const DEFAULT_MODEL = 'gemini-flash-latest';
export const getAi = async () => ({ key: '', model: DEFAULT_MODEL, ...(await cacheGet('ai')) });
export const setAi = value => cacheSet('ai', value);

export async function ask(prompt, imageDataUrl) {
    const { key, model } = await getAi();
    if (!key) throw new Error('Önce Ayarlar bölümüne yapay zekâ anahtarınızı girin.');
    const parts = [{ text: prompt }];
    if (imageDataUrl) {
        const [, mime, data] = imageDataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
        parts.push({ inline_data: { mime_type: mime, data } });
    }
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
            systemInstruction: { parts: [{ text: 'Türkiye kıyı balıkçılığı konusunda yardımcı ol. Türkçe, kısa ve düz metin yaz. Verilmeyen veriyi uydurma; emin olmadığını belirt. Güvenlik uyarılarını hafife alma.' }] },
            contents: [{ parts }]
        })
    });
    if (!res.ok) throw new Error(res.status === 429 ? 'Ücretsiz kullanım sınırı doldu; daha sonra deneyin.' : res.status === 404 ? 'Model adı bulunamadı; Ayarlar’dan değiştirin.' : `Yapay zekâ servisi hata verdi (${res.status}). Anahtarı kontrol edin.`);
    const text = (await res.json()).candidates?.[0]?.content?.parts?.map(p => p.text || '').join('').trim();
    if (!text) throw new Error('Yapay zekâ boş yanıt döndürdü.');
    return text;
}
