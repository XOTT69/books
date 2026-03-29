const STATIC_CACHE = "chitayko-static-v14";
const CDN_CACHE = "chitayko-cdn-v14";

const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon.png"
];

const CDN_URLS = [
  "https://cdn.tailwindcss.com/",
  "https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js",
  "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth-compat.js",
  "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore-compat.js",
  "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.1.5/jszip.min.js",
  "https://cdn.jsdelivr.net/npm/epubjs/dist/epub.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/hammer.js/2.0.8/hammer.min.js",
  "https://cdn.jsdelivr.net/npm/sortablejs@latest/Sortable.min.js"
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil((async () => {
    const staticCache = await caches.open(STATIC_CACHE);
    await staticCache.addAll(APP_SHELL);

    const cdnCache = await caches.open(CDN_CACHE);
    await Promise.allSettled(CDN_URLS.map((url) => cdnCache.add(url)));
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.map((key) => {
        if (![STATIC_CACHE, CDN_CACHE].includes(key)) {
          return caches.delete(key);
        }
      })
    );
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method !== "GET") return;

  if (
    url.hostname.includes("googleapis.com") ||
    url.hostname.includes("itunes.apple.com") ||
    url.hostname.includes("firestore.googleapis.com") ||
    url.hostname.includes("identitytoolkit.googleapis.com") ||
    url.hostname.includes("securetoken.googleapis.com")
  ) {
    return;
  }

  if (req.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(STATIC_CACHE);
        cache.put("./index.html", fresh.clone());
        return fresh;
      } catch {
        return (await caches.match("./index.html")) || Response.error();
      }
    })());
    return;
  }

  const isLocal = url.origin === self.location.origin;
  const isCdn =
    url.hostname.includes("gstatic.com") ||
    url.hostname.includes("cdnjs.cloudflare.com") ||
    url.hostname.includes("cdn.jsdelivr.net") ||
    url.href.startsWith("https://cdn.tailwindcss.com");

  if (isLocal || isCdn) {
    event.respondWith((async () => {
      const cacheName = isLocal ? STATIC_CACHE : CDN_CACHE;
      const cache = await caches.open(cacheName);
      const cached = await cache.match(req);

      const networkFetch = fetch(req)
        .then((res) => {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => null);

      if (cached) {
        event.waitUntil(networkFetch);
        return cached;
      }

      const fresh = await networkFetch;
      if (fresh) return fresh;

      if (req.destination === "image") {
        return (await caches.match("./icon.png")) || Response.error();
      }

      return Response.error();
    })());
  }
});
