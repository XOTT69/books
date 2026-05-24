const CACHE_NAME = 'chitayko-v5';
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/manifest.json',
    '/icon.png',
    'https://cdn.tailwindcss.com',
    'https://cdnjs.cloudflare.com/ajax/libs/localforage/1.10.0/localforage.min.js',
    'https://cdn.jsdelivr.net/npm/sortablejs@latest/Sortable.min.js',
    'https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js',
    'https://www.gstatic.com/firebasejs/9.22.0/firebase-auth-compat.js',
    'https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore-compat.js'
];

self.addEventListener('install', event => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            return cache.addAll(STATIC_ASSETS).catch(err => {
                console.log('Cache addAll partial fail:', err);
                // Cache what we can
                return Promise.allSettled(STATIC_ASSETS.map(url => cache.add(url).catch(() => {})));
            });
        })
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.filter(name => name !== CACHE_NAME).map(name => caches.delete(name))
            );
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    const url = event.request.url;

    // Skip non-GET
    if (event.request.method !== 'GET') return;

    // Skip API requests — let them go to network always
    if (url.includes('firestore.googleapis.com') || 
        url.includes('www.googleapis.com/books') || 
        url.includes('www.googleapis.com/identitytoolkit') ||
        url.includes('securetoken.googleapis.com') ||
        url.includes('itunes.apple.com') ||
        url.includes('corsproxy.io')) {
        return;
    }

    // Navigation requests — network first, fallback to cache
    if (event.request.mode === 'navigate') {
        event.respondWith(
            fetch(event.request)
                .then(response => {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                    return response;
                })
                .catch(() => caches.match('/index.html'))
        );
        return;
    }

    // Static assets — Stale While Revalidate
    event.respondWith(
        caches.match(event.request).then(cachedResponse => {
            const networkFetch = fetch(event.request).then(response => {
                if (response && response.status === 200) {
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseClone));
                }
                return response;
            }).catch(() => null);

            return cachedResponse || networkFetch;
        })
    );
}); 
