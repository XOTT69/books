const CACHE_NAME = "chitayko-cache-v10";

const urlsToCache = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon.png"
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

// Активація і видалення старого кешу (щоб на телефонах завжди була свіжа версія)
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

  // Для наших локальних файлів беремо з кешу, або йдемо в інтернет
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    }).catch(() => {
      // Якщо взагалі немає інтернету і файл не знайдено, показуємо головну сторінку
      return caches.match('./index.html');
    })
  );
});
