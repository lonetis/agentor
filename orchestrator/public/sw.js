// Agentor service worker: an offline / server-unreachable fallback for page
// navigations, nothing else. It never answers API, WebSocket, proxy (editor,
// desktop) or download traffic and caches no app HTML or assets — Nitro already
// serves /_nuxt/ with immutable cache headers.
//
// Bump CACHE whenever offline.html changes so clients pick up the new copy.
// Kill switch: ship a sw.js whose install/activate handler calls
// `self.registration.unregister()`; browsers re-check this file on every
// navigation (it is served with `cache-control: no-cache`).

const CACHE = 'agentor-offline-v1';
const OFFLINE_URL = '/offline.html';
// Paths that must always reach the server untouched. Add every new server path
// prefix here that is navigated to directly (proxies, OAuth, downloads).
const BYPASS = ['/api/', '/_nuxt/', '/_nuxt_icon', '/ws/', '/editor/', '/desktop/', '/mcp', '/.well-known/'];
// Traefik answers these while the orchestrator restarts (e.g. during an update).
const UNREACHABLE = new Set([502, 503, 504]);

async function cacheOfflinePage() {
  const cache = await caches.open(CACHE);
  await cache.add(new Request(OFFLINE_URL, { cache: 'reload' }));
}

// Chromium static routing: requests under the BYPASS prefixes never start the
// worker. The editor/desktop iframes are controlled clients, so without this
// every one of their subresource requests would wake the worker. Must be
// called synchronously from the install handler.
async function addBypassRoutes(event) {
  if (typeof event.addRoutes !== 'function' || typeof URLPattern !== 'function') return;
  try {
    await event.addRoutes(
      BYPASS.map((prefix) => ({
        condition: { urlPattern: new URLPattern({ pathname: `${prefix}*` }) },
        source: 'network',
      })),
    );
  } catch (err) {
    console.warn('[sw] static routes not registered', err);
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(Promise.all([cacheOfflinePage(), addBypassRoutes(event)]).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => key.startsWith('agentor-') && key !== CACHE).map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || req.mode !== 'navigate' || req.destination !== 'document') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || BYPASS.some((prefix) => url.pathname.startsWith(prefix))) return;

  event.respondWith(
    (async () => {
      try {
        const res = await fetch(req);
        if (!UNREACHABLE.has(res.status)) return res;
      } catch {
        // Network down or connection refused: serve the offline page below.
      }
      return (await caches.match(OFFLINE_URL)) ?? Response.error();
    })(),
  );
});
