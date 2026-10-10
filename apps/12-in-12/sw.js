// 12 in 12 service worker. It is registered with a ?v= query, the same value the rest of the site uses
// (scripts/sync-cache-versions.js rewrites it on every deploy), so the cache name always matches the shipped files.
// Scope is this folder only (apps/12-in-12/). Only the app shell is cached. Nothing else on the site is touched.
const VERSION = (new URL(self.location.href).searchParams.get('v') || 'dev').replace(/[^\w.-]/g, '');
const QUERY = `?v=${VERSION}`;
const CACHE_PREFIX = 'utl-12-in-12-';
const CACHE_NAME = `${CACHE_PREFIX}${VERSION}`;
const SCOPE_URL = new URL(self.registration.scope);
const SHELL = [
  './',
  './index.html',
  './core.js' + QUERY,
  './app.js' + QUERY,
  './manifest.webmanifest',
  '../../assets/utl-logo-nav-white.png' + QUERY,
  '../../assets/tactile-buttons.js' + QUERY
].map((path) => new URL(path, SCOPE_URL).href);

self.addEventListener('install', (event) => {
  // No skipWaiting here. A new worker waits until the person chooses "Reload" in the page.
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)));
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // The page: network first, so a fresh deploy is seen, with the cached page when offline.
  if (request.mode === 'navigate') {
    if (!url.pathname.startsWith(SCOPE_URL.pathname)) return;
    event.respondWith(
      fetch(request).catch(() => caches.match(new URL('./index.html', SCOPE_URL).href))
    );
    return;
  }

  // Shell files only, matched by exact URL (the ?v= value is part of it). Anything else goes to the network untouched.
  if (!SHELL.includes(url.href)) return;
  event.respondWith(
    caches.match(request, { ignoreVary: true }).then((cached) => cached || fetch(request))
  );
});
