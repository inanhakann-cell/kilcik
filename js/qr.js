// QR sayfasi (qr.html): kurulum baglantisini paylasir. Karekod qr.svg dosyasindadir; adres degisirse yeniden uretilmeli.
(() => {
    const url = 'https://inanhakann-cell.github.io/kilcik/kur.html';
    const button = document.getElementById('send');
    button.addEventListener('click', async () => {
        if (navigator.share) return navigator.share({ title: 'KILÇIK', text: 'Kıyı avı planlayıcı: dokun, telefonuna ekle.', url }).catch(() => {});
        try { await navigator.clipboard.writeText(url); button.textContent = 'Bağlantı kopyalandı'; }
        catch { window.prompt('Bağlantıyı kopyalayın:', url); }
    });
})();
