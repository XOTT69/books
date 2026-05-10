// Спрощений Service Worker для ЧитайКо PWA на Vercel
// Оптимізований для швидкості та надійності

const CACHE_NAME = 'chitayko-v2';
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json',
  '/app.js',
  '/app-extended.js',
  'https://cdn.tailwindcss.com',
  'https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/9.22.0/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore-compat.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.1.5/jszip.min.js',
  'https://cdn.jsdelivr.net/npm/epubjs/dist/epub.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/hammer.js/2.0.8/hammer.min.js',
  'https://cdn.jsdelivr.net/npm/sortablejs@latest/Sortable.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/localforage/1.10.0/localforage.min.js',
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://unpkg.com/html5-qrcode'
];

// Встановлення
self.addEventListener('install', event => {
  console.log('🔧 Installing Service Worker...');
  self.skipWaiting();
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('📦 Caching assets');
        return cache.addAll(urlsToCache);
      })
      .catch(err => console.error('❌ Cache install failed:', err))
  );
});

// Активація
self.addEventListener('activate', event => {
  console.log('🔄 Activating Service Worker...');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(name => {
          if (name !== CACHE_NAME) {
            console.log('🗑️ Deleting old cache:', name);
            return caches.delete(name);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Перехоплення запитів
self.addEventListener('fetch', event => {
  const url = event.request.url;
  
  // Пропускаємо API запити (Firebase, Google Books, Apple)
  if (url.includes('firestore') || 
      url.includes('googleapis') || 
      url.includes('google.com') ||
      url.includes('itunes.apple.com') ||
      url.includes('firebaseio.com')) {
    return;
  }
  
  // Стратегія: Stale-While-Revalidate
  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      const networkFetch = fetch(event.request).then(response => {
        // Кешуємо тільки успішні GET запити
        if (event.request.method === 'GET' && 
            response.status === 200 && 
            response.type === 'basic') {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      }).catch(() => {
        // Якщо немає інтернету і немає в кеші
        if (event.request.destination === 'document') {
          return caches.match('/index.html');
        }
      });
      
      return cachedResponse || networkFetch;
    })
  );
});

// Push повідомлення
self.addEventListener('push', event => {
  const options = {
    body: 'Нові рекомендації книг чекають на вас!',
    icon: '/icon.png',
    badge: '/icon.png',
    vibrate: [100, 50, 100],
    data: { url: '/' },
    actions: [
      {
        action: 'open',
        title: 'Відкрити застосунок'
      },
      {
        action: 'close',
        title: 'Закрити'
      }
    ]
  };
  
  event.waitUntil(
    self.registration.showNotification('ЧитайКо', options)
  );
});

// Обробка кліків на сповіщення
self.addEventListener('notificationclick', event => {
  event.notification.close();
  
  if (event.action === 'open' || !event.action) {
    event.waitUntil(
      clients.openWindow(event.notification.data.url || '/')
    );
  }
});

console.log('🚀 ЧитайКо Service Worker loaded');
