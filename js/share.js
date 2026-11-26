// Paylasim karti: av veya plan icin 1080x1080 gorsel.
import { toast } from './ui.js';

export async function shareCard({ title, lines, photo = '', big = '' }) {
    const c = Object.assign(document.createElement('canvas'), { width: 1080, height: 1080 });
    const g = c.getContext('2d');
    g.fillStyle = '#06131a';
    g.fillRect(0, 0, 1080, 1080);
    let y = 180;
    if (photo) {
        const img = await createImageBitmap(await (await fetch(photo)).blob());
        const k = Math.max(1080 / img.width, 640 / img.height);
        g.drawImage(img, (1080 - img.width * k) / 2, (640 - img.height * k) / 2, img.width * k, img.height * k);
        g.fillStyle = '#06131a';
        g.fillRect(0, 640, 1080, 440);
        y = 730;
    }
    if (big) { g.fillStyle = '#14b8a6'; g.font = 'bold 220px system-ui'; g.fillText(big, 60, 330); y = 460; }
    g.fillStyle = '#e6f1f4';
    g.font = 'bold 62px system-ui';
    g.fillText(title, 60, y, 960);
    g.font = '40px system-ui';
    g.fillStyle = '#b6cdd5';
    lines.filter(Boolean).slice(0, 6).forEach((line, i) => g.fillText(line, 60, y + 70 + i * 56, 960));
    g.fillStyle = '#14b8a6';
    g.font = 'bold 38px system-ui';
    g.fillText('KILÇIK', 880, 1040);
    const blob = await new Promise(resolve => c.toBlob(resolve, 'image/png'));
    const file = new File([blob], 'kilcik.png', { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) return navigator.share({ files: [file] }).catch(() => {});
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'kilcik.png' });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast('Görsel indirildi.', 'ok');
}
