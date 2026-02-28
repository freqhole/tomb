// freqhole service worker
// version is injected at build time by vite
const CACHE_VERSION = "__APP_VERSION__";
const CACHE_NAME = `freqhole-${CACHE_VERSION}`;

// assets to precache on install
const PRECACHE_URLS = [
  "/",
  "/index.html",
];

// install: precache core assets
self.addEventListener("install", (event) => {
  console.log(`[sw] installing version: ${CACHE_VERSION}`);
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => {
        console.log("[sw] precaching core assets");
        return cache.addAll(PRECACHE_URLS);
      })
      .catch((error) => {
        console.error("[sw] precache failed:", error);
      })
  );
});

// activate: clean up old caches
self.addEventListener("activate", (event) => {
  console.log(`[sw] activating version: ${CACHE_VERSION}`);
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          // delete any cache that starts with freqhole- but isn't current version
          if (cacheName.startsWith("freqhole-") && cacheName !== CACHE_NAME) {
            console.log(`[sw] deleting old cache: ${cacheName}`);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  // claim clients immediately so the new SW takes over
  return self.clients.claim();
});

// fetch: cache-first strategy for offline support
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // only handle same-origin requests (not API calls to remote servers)
  if (url.origin !== self.location.origin) {
    return;
  }

  // skip non-GET requests
  if (event.request.method !== "GET") {
    return;
  }

  // skip websocket and other special protocols
  if (!url.protocol.startsWith("http")) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // return cached version
        return cachedResponse;
      }

      // not in cache - fetch from network and cache it
      return fetch(event.request)
        .then((networkResponse) => {
          // don't cache non-ok responses or opaque responses
          if (!networkResponse || networkResponse.status !== 200 || networkResponse.type === "opaque") {
            return networkResponse;
          }

          // clone response since we need to use it twice
          const responseToCache = networkResponse.clone();

          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });

          return networkResponse;
        })
        .catch((error) => {
          console.error("[sw] fetch failed:", error);
          // could return a custom offline page here if needed
          throw error;
        });
    })
  );
});

// handle messages from the app
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    console.log("[sw] skip waiting, activating immediately");
    self.skipWaiting();
  }

  if (event.data && event.data.type === "GET_VERSION") {
    event.ports[0].postMessage({ version: CACHE_VERSION });
  }
});
