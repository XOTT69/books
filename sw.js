const CACHE_NAME = 'chitayko-v10';
const ROOT = self.registration.scope;
const SHELL = new URL('index.html', ROOT).href;
const STATIC_ASSETS = [
    './',
    'index.html',
    'app.js?v=10',
    'library.css?v=10',
    'utilities.css',
    'manifest.json',
    'icon.png',
    'icon-192.png'
].map(path => new URL(path, ROOT).href);
const DEPENDENCIES = [
    'https://cdnjs.cloudflare.com/ajax/libs/localforage/1.10.0/localforage.min.js',
    'https://cdn.jsdelivr.net/npm/sortablejs@1.15.6/Sortable.min.js',
    'https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js',
    'https://www.gstatic.com/firebasejs/9.22.0/firebase-auth-compat.js',
    'https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore-compat.js'
];

self.addEventListener('install', event => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_NAME);
        await cache.addAll(STATIC_ASSETS);
        await Promise.allSettled(DEPENDENCIES.map(url => cache.add(url)));
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', event => {
    event.waitUntil(caches.keys().then(names =>
        Promise.all(names.filter(name => name.startsWith('chitayko-') && name !== CACHE_NAME)
            .map(name => caches.delete(name)))
    ).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
    const {request} = event;
    if (request.method !== 'GET') return;

    if (request.mode === 'navigate' && request.url.startsWith(ROOT)) {
        event.respondWith((async () => {
            try {
                return await fetch(request);
            } catch {
                return (await caches.open(CACHE_NAME)).match(SHELL);
            }
        })());
        return;
    }

    const url = new URL(request.url);
    const readerDependency = request.destination === 'script' &&
        ['cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'unpkg.com'].includes(url.hostname);
    if (!STATIC_ASSETS.includes(request.url) && !DEPENDENCIES.includes(request.url) && !readerDependency) return;
    event.respondWith((async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok || response.type === 'opaque') await cache.put(request, response.clone()).catch(() => {});
        return response;
    })());
});
