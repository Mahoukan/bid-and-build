const CACHE = 'bid-build-static-__BUILD_ID__';
const ASSETS = new Set(__STATIC_ASSETS__);
const OFFLINE = '__OFFLINE_URL__';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Only build-generated public files, with no cookies or user-provided URLs.
    await cache.addAll([...ASSETS].map((url) => new Request(url, { cache: 'reload', credentials: 'omit' })));
  })());
});

self.addEventListener('activate', (event) => {
  // Natural activation waits for every old controlled window to close. Its
  // chunks remain cached until then, including lazy routes in unsaved editors.
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys
    .filter((key) => key.startsWith('bid-build-static-') && key !== CACHE)
    .map((key) => caches.delete(key)))));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || request.headers.has('Authorization')) return;
  // API, authentication, media, health and Socket.IO requests never enter a
  // cache or receive an HTML fallback. WebSockets bypass this worker entirely.
  if (/^\/(api|socket\.io|media|health)(\/|$)/.test(url.pathname)) return;
  if (!url.search && ASSETS.has(url.pathname)) {
    event.respondWith(caches.open(CACHE).then(async (cache) => (await cache.match(url.pathname)) ?? fetch(request)));
    return;
  }
  if (request.mode === 'navigate' && /^(\/|\/(builder|templates|admin)|\/(room|display)\/[A-HJ-NP-Z2-9]{8})$/.test(url.pathname)) {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.status < 500) return response;
      } catch { /* An unavailable server gets a static explanation, never game state. */ }
      return (await (await caches.open(CACHE)).match(OFFLINE)) ?? Response.error();
    })());
  }
});
