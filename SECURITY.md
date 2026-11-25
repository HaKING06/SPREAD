# Güvenlik Politikası (Security Policy)

**SPREAD (`spread.haking.tr`)** güvenliği mimari düzeyde önceliklendirir:

## Uygulanan Güvenlik Katmanları
- **Sıfır Hesap / Kimlik Bilgisi Toplama:** Steam girişi, Steam API anahtarı, CSFloat API anahtarı veya takas bağlantısı talep edilmez.
- **Sıfır Çalışma Zamanı 3. Parti JS Bağımlılığı:** Hiçbir harici JS CDN betiği (Tailwind Play CDN vb.) çalıştırılmaz; tüm arayüz ve grafik motoru yerli ES modülleriyle yazılmıştır.
- **Katı Content Security Policy (CSP):** `_headers` dosyasında `script-src 'self'` (sıfır `unsafe-inline` script), `object-src 'none'`, `frame-ancestors 'none'` ve HSTS zorunlu kılınır.
- **DOM-XSS Koruması:** Kullanıcı ve API kaynaklı veriler `innerHTML` yerine güvenli DOM oluşturucu (`js/core/security.js` -> `el()`) ve URL allowlist denetimiyle işlenir.
- **Prototip Kirliliği & CSV Enjeksiyon Koruması:** JSON yedek içe aktarımlarında `__proto__` / `constructor` / `prototype` anahtarları temizlenir, SHA-256 bütünlük özeti doğrulanır ve CSV hücrelerinde formül enjeksiyonu (`=`, `+`, `-`, `@`) etkisizleştirilir.

## Güvenlik Açığı Bildirimi
Bir güvenlik zafiyeti tespit ederseniz lütfen herkese açık Issue açmak yerine doğrudan `security@haking.tr` adresine veya GitHub Private Security Advisory üzerinden bildirin.
