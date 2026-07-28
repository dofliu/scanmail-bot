const CACHE_NAME = 'scanmail-v14';
const ASSETS = [
  '/',
  '/index.html',
  '/css/palette.css',
  '/js/config.js',
  '/js/native.js',
  '/js/image-local.js',
  '/js/zip-lite.js',
  '/js/ttf-lite.js',
  '/js/pdf-write.js',
  '/js/sign-lite.js',
  '/js/pdf-lite.js',
  '/js/doc-local.js',
  '/js/store.js',
  '/js/atoms.jsx',
  '/js/mobile.jsx',
  '/js/desktop.jsx',
  '/js/studio.jsx',
  '/js/boot.jsx',
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
// vendor/fonts/NotoSansTC-Subset.ttf 刻意不放進 ASSETS ——
// 4.6 MB，只有輸出 PDF 才會用到，第一次用時再抓就好。


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
    // ignoreSearch: true — 靜態資源在 index.html 用 ?v=X.Y.Z 做快取破壞，
    // 但 install 階段 cache.addAll(ASSETS) 是用不含版號的路徑預存。
    // 若比對時要求精確符合（預設行為），這兩者永遠對不上，預存快取形同
    // 白做工，每次都得改打網路。手機訊號不穩/離線時網路請求失敗，
    // 又拿不到快取，關鍵腳本（如 api.js）整個載入失敗，
    // 導致 window.API 是 undefined、上傳功能直接壞掉。
    caches.match(e.request, { ignoreSearch: true }).then((cachedResponse) => {
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
      // 快取未命中（含 ignoreSearch 都找不到）時才真的打網路
      return fetch(e.request);
    })
  );
});
