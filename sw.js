// 집밥 레시피 PWA 서비스워커
// 배포할 때마다 아래 CACHE_VERSION 숫자만 올리면 이전 캐시가 자동으로 정리됩니다.
const CACHE_VERSION = 'jipbap-v14';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './data/seed-recipes.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // 외부 도메인(웹 검색 링크 등)은 서비스워커가 관여하지 않음
  if (url.origin !== self.location.origin) return;

  // 앱 코드/데이터: 네트워크 우선 → 실패 시 캐시 (항상 최신, 오프라인 지원)
  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
  );
});
