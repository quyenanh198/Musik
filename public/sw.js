// Service worker: makes the app installable and lets it open offline. Audio and API always go to the network.
//
// Only page navigations are handled: the page is fetched from the network first (so a new release is picked up at
// once) and the last good copy is kept, to be shown when the network is down. Assets are content-hashed and served
// with long-lived cache headers, so the browser's own HTTP cache already covers them.
const CACHE = 'musik-shell-v1';
const SHELL = '/index.html';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) =>
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) if (name !== CACHE) await caches.delete(name);
      await self.clients.claim();
    })(),
  ),
);

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.mode !== 'navigate' || request.method !== 'GET') return; // everything else: the browser's default
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(caches.open(CACHE).then((cache) => cache.put(SHELL, copy)));
        }
        return response;
      })
      .catch(async () => (await caches.match(SHELL)) ?? Response.error()),
  );
});
