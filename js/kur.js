// Kurulum sayfasi (kur.html). Sayfa guvenlik politikasi satir ici betige izin vermez.
(() => {
    // Ana ekran simgesinden acildiysa dogrudan uygulamaya gec.
    if (matchMedia('(display-mode: standalone)').matches || navigator.standalone === true) return location.replace('./');
    const ua = navigator.userAgent;
    const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const android = /Android/.test(ua);
    const inApp = /; wv\)|WhatsApp|Instagram|FBAN|FBAV|FB_IAB|Line\//.test(ua) || (ios && !/Safari\//.test(ua));
    const $ = id => document.getElementById(id);
    $('ios').hidden = !ios;
    $('android').hidden = !android || inApp;
    $('inapp').hidden = !(android && inApp);
    $('desktop').hidden = ios || android;
    let prompt = null;
    addEventListener('beforeinstallprompt', e => { e.preventDefault(); prompt = e; $('install').hidden = false; $('manual').hidden = true; });
    $('install').addEventListener('click', async () => {
        if (!prompt) return;
        await prompt.prompt();
        const choice = await prompt.userChoice;
        prompt = null;
        $('install').hidden = true;
        if (choice.outcome === 'accepted') $('done').hidden = false; else $('manual').hidden = false;
    });
    addEventListener('appinstalled', () => { $('done').hidden = false; $('install').hidden = true; $('manual').hidden = true; });
    $('copy').addEventListener('click', async e => {
        const url = new URL('kur.html', location.href).href;
        try { await navigator.clipboard.writeText(url); e.target.textContent = 'Kopyalandı'; }
        catch { window.prompt('Bağlantıyı kopyalayın:', url); }
    });
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
