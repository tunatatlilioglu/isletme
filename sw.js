const CACHE = 'isletme-v2';
const STATIC = [
  '/isletme/satis_demo.html',
  '/isletme/isletme_kasa.html',
  '/isletme/manifest-satis.json',
  '/isletme/manifest-kasa.json',
  '/isletme/icon-satis-192.png',
  '/isletme/icon-satis-512.png',
  '/isletme/icon-kasa-192.png',
  '/isletme/icon-kasa-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(STATIC)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.url.includes('firebaseapp') ||
      e.request.url.includes('googleapis') ||
      e.request.url.includes('gstatic') ||
      e.request.url.includes('cdnjs') ||
      e.request.url.includes('cdn.jsdelivr')) return;

  e.respondWith(
    fetch(e.request)
      .then(res => {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
