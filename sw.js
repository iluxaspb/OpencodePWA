/* Scoped offline shell for deployment under any Pages subpath. */
const scopeUrl = new URL(self.registration.scope);
const scopePath = scopeUrl.pathname.endsWith('/') ? scopeUrl.pathname : `${scopeUrl.pathname}/`;
const cacheName = `oc-mobile-shell:${scopePath}:v1`;
const shellAssets = [
  './',
  './index.html',
  './css/app.css',
  './js/app.js',
  './js/core/api-client.js',
  './js/core/event-parser.js',
  './js/core/mock-transport.js',
  './js/core/v2-client.js',
  './js/voice/index.js',
  './js/voice/markdown.js',
  './js/voice/recognizer.js',
  './js/voice/speech.js',
  './js/voice/voices.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
];
const assetPaths = new Set(shellAssets.map((path) => new URL(path, scopeUrl).pathname));

function isScopedAsset(requestUrl) {
  return requestUrl.origin === scopeUrl.origin && requestUrl.pathname.startsWith(scopePath) && assetPaths.has(requestUrl.pathname);
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    try {
      for (const asset of shellAssets) {
        const request = new Request(new URL(asset, scopeUrl), { method: 'GET', credentials: 'same-origin' });
        const response = await fetch(request);
        if (!response.ok || response.type === 'opaque' || response.headers.get('Cache-Control')?.toLowerCase().includes('no-store')) {
          throw new Error(`Required shell asset unavailable: ${asset}`);
        }
        await cache.put(request, response.clone());
      }
    } catch (error) {
      await caches.delete(cacheName);
      throw error;
    }
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => name.startsWith(`oc-mobile-shell:${scopePath}:`) && name !== cacheName)
      .map((name) => caches.delete(name)));
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || request.headers.has('Authorization')) return;

  const url = new URL(request.url);
  if (!isScopedAsset(url)) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok && response.type !== 'opaque' && !response.headers.get('Cache-Control')?.toLowerCase().includes('no-store')) {
          const cache = await caches.open(cacheName);
          await cache.put(new Request(new URL('./index.html', scopeUrl)), response.clone());
        }
        return response;
      } catch {
        const cache = await caches.open(cacheName);
        return (await cache.match(new Request(new URL('./index.html', scopeUrl)))) || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok && response.type !== 'opaque' && !response.headers.get('Cache-Control')?.toLowerCase().includes('no-store')) {
      await cache.put(request, response.clone());
    }
    return response;
  })());
});
