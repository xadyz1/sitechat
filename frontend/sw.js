/* SwiftChat service worker — enables PWA installability.
   Network-first for navigations and API, cache-first for static assets. */
const CACHE_NAME = 'swiftchat-v3';
const STATIC_ASSETS = [
  '/css/styles.css',
  '/js/app.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/manifest.webmanifest'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== location.origin) return;

  // Never cache API or widget requests
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/widget/')) return;

  // JS/CSS: network-first so dashboard updates land immediately; cache is the offline fallback
  if (/^\/(css|js)\//.test(url.pathname)) {
    event.respondWith(
      fetch(request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return res;
      }).catch(() => caches.match(request))
    );
    return;
  }

  // Icons and other static assets: cache-first
  if (/^\/icons\//.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) =>
        cached ||
        fetch(request).then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return res;
        })
      )
    );
    return;
  }

  // Navigations: network-first, fall back to cache when offline
  event.respondWith(fetch(request).catch(() => caches.match(request)));
});
