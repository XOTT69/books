const CACHE_NAME = 'chitaiko-v8';

// кешуємо тільки свій застосунок (НЕ CDN!)
const APP_SHELL = [
  '/',
  '/index.html',
  '/app.js',
  '/manifest.json',
  '/icon.png'
];

// Install
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(APP_SHELL);
    })
  );
});

// Activate
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) return caches.delete(key);
        })
      )
    )
  );
  self.clients.claim();
});

// Fetch (SAFE VERSION)
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  // ❌ ігноруємо не-http
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // ❌ НЕ кешуємо CDN / зовнішні сервіси
  const blocked = [
    'cdn.tailwindcss.com',
    'cdn.jsdelivr.net',
    'cdnjs.cloudflare.com',
    'www.gstatic.com',
    'firebase',
    'googleapis'
  ];

  if (blocked.some(d => url.hostname.includes(d))) {
    event.respondWith(fetch(req));
    return;
  }

  // 🟢 Network first (краще для PWA)
  event.respondWith(
    fetch(req)
      .then(networkRes => {
        // кешуємо тільки GET
        if (req.method === 'GET') {
          const clone = networkRes.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(req, clone).catch(() => {});
          });
        }
        return networkRes;
      })
      .catch(() => {
        // fallback з кешу
        return caches.match(req);
      })
  );
});
