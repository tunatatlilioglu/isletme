const CACHE = 'isletme-v1';
const STATIC = [
  '/isletme/satis_demo.html',
  '/isletme/isletme_kasa.html',
  '/isletme/manifest.json',
  '/isletme/icon-192.png',
  '/isletme/icon-512.png',
];

// Kurulum — statik dosyaları önbelleğe al
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(STATIC)).then(() => self.skipWaiting())
  );
});

// Aktivasyon — eski önbellekleri temizle
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch — önce ağ, hata varsa önbellekten sun
self.addEventListener('fetch', e => {
  // Firebase ve CDN isteklerini geç
  if (e.request.url.includes('firebaseapp') ||
      e.request.url.includes('googleapis') ||
      e.request.url.includes('gstatic') ||
      e.request.url.includes('cdnjs') ||
      e.request.url.includes('cdn.jsdelivr')) {
    return;
  }

  e.respondWith(
    fetch(e.request)
      .then(res => {
        // Başarılı yanıtı önbelleğe de yaz
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
