const CACHE_NAME = 'chitayko-v2';
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.filter(name => name !== CACHE_NAME).map(name => caches.delete(name))
      );
    })
  );
});

self.addEventListener('fetch', event => {
  const url = event.request.url;

  // Пропускаємо API запити (щоб Firebase та пошук працювали наживо)
  if (url.includes('firestore') || url.includes('googleapis') || url.includes('itunes.apple.com')) {
      return;
  }

  // Стратегія: Stale-While-Revalidate (спочатку кеш, потім оновлення у фоні)
  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      const networkFetch = fetch(event.request).then(response => {
        // Кешуємо тільки успішні GET запити
        if(event.request.method === 'GET' && response.status === 200 && response.type === 'basic') {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseClone));
        }
        return response;
      }).catch(() => {
          // Якщо немає інтернету і немає в кеші
      });
      return cachedResponse || networkFetch;
    })
  );
});
