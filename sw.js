const CACHE_NAME = "chitayko-cache-v4"; // Змінюй цифру тут, коли кардинально оновлюєш код на GitHub

const urlsToCache = [
  "./",
  "./index.html",
  "./manifest.json"
];

// Встановлення і кешування файлів
self.addEventListener("install", (event) => {
  self.skipWaiting(); // Змушуємо новий SW активуватися відразу
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log("Відкрито кеш");
      return cache.addAll(urlsToCache);
    })
  );
});

// Активація і видалення старого кешу (ЩОБ НЕ ВИСІЛИ СТАРІ ВЕРСІЇ)
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log("Видаляємо старий кеш:", cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Перехоплення запитів
self.addEventListener("fetch", (event) => {
  // Пропускаємо запити до API (Firebase, Google Books), щоб вони йшли в інтернет
  if (!event.request.url.startsWith(self.location.origin)) {
    return;
  }

  // Для наших локальних файлів (index.html) беремо з кешу, або йдемо в інтернет
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    }).catch(() => {
      return caches.match('./index.html');
    })
  );
});
