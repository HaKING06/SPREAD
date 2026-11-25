# Katkıda Bulunma Rehberi (Contributing)

**SPREAD (`spread.haking.tr`)** projesine katkıda bulunmak için:

1. Depoyu fork edin ve yeni bir dal oluşturun (`git checkout -b feat/yeni-ozellik`).
2. Değişikliklerinizi yaptıktan sonra tüm sözdizimi ve güvenlik kontrollerini çalıştırın:
   ```bash
   npm run verify
   ```
3. Katalog ve canlı fiyat önbelleğini güncellemek için:
   ```bash
   npm run sync
   ```
4. Yeni kullanıcı/API girdisi gösteren tüm DOM kodlarında `innerHTML` kullanmayın; `js/core/security.js` içindeki `el()` yardımcılarını tercih edin.
5. Açıklayıcı bir Pull Request gönderin.
