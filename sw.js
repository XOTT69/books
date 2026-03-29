const CACHE_NAME = 'chitayko-shell-v3';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon.png'
];

const CDN_HOSTS = [
  'cdn.tailwindcss.com',
  'www.gstatic.com',
  'cdnjs.cloudflare.com',
  'cdn.jsdelivr.net'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    event.respondWith(handleSameOrigin(request));
    return;
  }

  if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(handleCDN(request));
    return;
  }

  if (
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('itunes.apple.com') ||
    url.hostname.includes('corsproxy.io')
  ) {
    event.respondWith(networkFirst(request));
    return;
  }
});

async function handleSameOrigin(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  try {
    const fresh = await fetch(request);

    if (fresh && fresh.ok) {
      cache.put(request, fresh.clone());
    }

    return fresh;
  } catch (error) {
    if (cached) return cached;

    if (
      request.mode === 'navigate' ||
      request.destination === 'document'
    ) {
      const fallback = await cache.match('./index.html');
      if (fallback) return fallback;
    }

    throw error;
  }
}

async function handleCDN(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) {
      cache.put(request, fresh.clone());
    }
    return fresh;
  } catch (error) {
    if (cached) return cached;
    throw error;
  }
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) {
      cache.put(request, fresh.clone());
    }
    return fresh;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw error;
  }
}
