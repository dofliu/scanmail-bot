const CACHE_NAME = 'scanmail-v3';
const ASSETS = [
  '/',
  '/index.html',
  '/css/palette.css',
  '/js/store.js',
  '/js/atoms.jsx',
  '/js/mobile.jsx',
  '/js/desktop.jsx',
  '/js/api.js',
  '/js/scanmail.js',
  '/js/image-tools.js',
  '/js/pdf-tools.js',
  '/js/doc-convert.js',
  '/js/gif-tools.js',
  '/js/video-tools.js',
  '/js/batch-rename.js',
  '/js/app.js',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  // Only handle GET requests and skip API calls
  if (e.request.method !== 'GET' || e.request.url.includes('/api/')) {
    return;
  }
  e.respondWith(
    caches.match(e.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Fetch new version in background (Stale-While-Revalidate)
        fetch(e.request).then((networkResponse) => {
          if (networkResponse.status === 200) {
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(e.request, networkResponse);
            });
          }
        }).catch(() => {});
        return cachedResponse;
      }
      return fetch(e.request);
    })
  );
});
