const SW_VERSION = 'chitayko-v6';
const APP_SHELL = `app-shell-${SW_VERSION}`;
const STATIC_CACHE = `static-${SW_VERSION}`;
const RUNTIME_CACHE = `runtime-${SW_VERSION}`;
const IMAGE_CACHE = `images-${SW_VERSION}`;
const API_CACHE = `api-${SW_VERSION}`;

const APP_SHELL_FILES = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './icon.png'
];

const STATIC_HOSTS = [
  'cdn.tailwindcss.com',
  'www.gstatic.com',
  'cdnjs.cloudflare.com',
  'cdn.jsdelivr.net'
];

const API_HOSTS = [
  'www.googleapis.com',
  'itunes.apple.com',
  'firestore.googleapis.com',
  'securetoken.googleapis.com',
  'identitytoolkit.googleapis.com',
  'corsproxy.io'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_SHELL).then((cache) => cache.addAll(APP_SHELL_FILES)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((name) => ![APP_SHELL, STATIC_CACHE, RUNTIME_CACHE, IMAGE_CACHE, API_CACHE].includes(name))
        .map((name) => caches.delete(name))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;

  if (request.headers.get('range')) return;

  if (url.origin === self.location.origin) {
    if (isAppShellRequest(request, url)) {
      event.respondWith(networkFirstShell(request));
      return;
    }

    if (isLocalImage(url)) {
      event.respondWith(cacheFirst(request, IMAGE_CACHE));
      return;
    }

    event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
    return;
  }

  if (STATIC_HOSTS.includes(url.hostname)) {
    event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
    return;
  }

  if (API_HOSTS.includes(url.hostname)) {
    if (
      url.hostname === 'firestore.googleapis.com' ||
      url.hostname === 'securetoken.googleapis.com' ||
      url.hostname === 'identitytoolkit.googleapis.com'
    ) {
      event.respondWith(networkOnly(request));
      return;
    }

    if (url.hostname === 'corsproxy.io') {
      event.respondWith(networkFirstWithFallback(request, RUNTIME_CACHE));
      return;
    }

    event.respondWith(networkFirstWithFallback(request, API_CACHE));
    return;
  }

  if (request.destination === 'image') {
    event.respondWith(cacheFirst(request, IMAGE_CACHE));
    return;
  }

  event.respondWith(networkFirstWithFallback(request, RUNTIME_CACHE));
});

function isAppShellRequest(request, url) {
  if (request.mode === 'navigate') return true;

  const pathname = url.pathname || '';
  return (
    pathname.endsWith('/index.html') ||
    pathname.endsWith('/styles.css') ||
    pathname.endsWith('/app.js') ||
    pathname.endsWith('/manifest.json') ||
    pathname.endsWith('/icon.png') ||
    pathname === '/' ||
    pathname.endsWith('/')
  );
}

function isLocalImage(url) {
  return /\.(png|jpg|jpeg|webp|gif|svg|ico)$/i.test(url.pathname || '');
}

async function networkOnly(request) {
  return fetch(request);
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (isCacheable(response)) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    if (request.destination === 'image') {
      const fallback = await caches.match('./icon.png');
      if (fallback) return fallback;
    }
    throw error;
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const networkPromise = fetch(request)
    .then((response) => {
      if (isCacheable(response)) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  if (cached) return cached;

  const networkResponse = await networkPromise;
  if (networkResponse) return networkResponse;

  if (request.mode === 'navigate') {
    const fallback = await caches.match('./index.html');
    if (fallback) return fallback;
  }

  return new Response('Offline', { status: 503, statusText: 'Offline' });
}

async function networkFirstShell(request) {
  const cache = await caches.open(APP_SHELL);

  try {
    const response = await fetch(request);
    if (isCacheable(response)) {
      cache.put(normalizeShellRequest(request), response.clone());
    }
    return response;
  } catch (_) {
    const cached = await cache.match(normalizeShellRequest(request));
    if (cached) return cached;

    const fallback = await cache.match('./index.html');
    if (fallback) return fallback;

    return new Response('Offline', { status: 503, statusText: 'Offline' });
  }
}

async function networkFirstWithFallback(request, cacheName) {
  const cache = await caches.open(cacheName);

  try {
    const response = await fetch(request);
    if (isCacheable(response)) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (_) {
    const cached = await cache.match(request);
    if (cached) return cached;

    if (request.mode === 'navigate') {
      const fallback = await caches.match('./index.html');
      if (fallback) return fallback;
    }

    return new Response(JSON.stringify({ offline: true }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

function normalizeShellRequest(request) {
  const url = new URL(request.url);
  if (url.pathname === '/' || url.pathname.endsWith('/')) {
    return './index.html';
  }
  if (url.pathname.endsWith('/index.html')) return './index.html';
  if (url.pathname.endsWith('/styles.css')) return './styles.css';
  if (url.pathname.endsWith('/app.js')) return './app.js';
  if (url.pathname.endsWith('/manifest.json')) return './manifest.json';
  if (url.pathname.endsWith('/icon.png')) return './icon.png';
  return request;
}

function isCacheable(response) {
  return response && response.ok && response.type !== 'opaque';
}
