// freqhole service worker
// version is injected at build time by vite
const CACHE_VERSION = "__APP_VERSION__";
const CACHE_NAME = `freqhole-${CACHE_VERSION}`;

// assets to precache on install
const PRECACHE_URLS = ["/", "/index.html"];

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

// fetch: navigation requests (the html document) go network-first, since a
// stale cached index.html can reference a hashed asset filename that no
// longer exists once an old deployment gets deleted - always prefer
// whatever's actually live when online, and only fall back to cache when
// offline. everything else (hashed build assets, images, etc.) stays
// cache-first for speed and offline support.
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

  const isNavigation =
    event.request.mode === "navigate" ||
    event.request.destination === "document" ||
    url.pathname === "/" ||
    url.pathname === "/index.html";

  event.respondWith(isNavigation ? networkFirst(event.request) : cacheFirst(event.request));
});

// a cdn's spa catch-all rewrite can serve index.html (200, text/html) in
// place of a hashed js/css asset that's since been deleted, instead of a
// real 404. caching that response would poison future loads with a broken
// stylesheet/script, so refuse to cache (or use) anything whose
// content-type doesn't match what the file extension expects.
function looksLikeMismatchedAsset(url, response) {
  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  if (url.endsWith(".css")) return !contentType.includes("css");
  if (url.endsWith(".js") || url.endsWith(".mjs")) {
    return !contentType.includes("javascript") && !contentType.includes("ecmascript");
  }
  return false;
}

function networkFirst(request) {
  return fetch(request)
    .then((networkResponse) => {
      if (networkResponse && networkResponse.status === 200 && networkResponse.type !== "opaque") {
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, responseToCache));
      }
      return networkResponse;
    })
    .catch((error) => {
      console.warn("[sw] navigation fetch failed, falling back to cache:", error);
      return caches.match(request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        throw error;
      });
    });
}

function cacheFirst(request) {
  return caches.match(request).then((cachedResponse) => {
    if (cachedResponse) {
      // return cached version
      return cachedResponse;
    }

    // not in cache - fetch from network and cache it
    return fetch(request)
      .then((networkResponse) => {
        // don't cache non-ok responses or opaque responses
        if (
          !networkResponse ||
          networkResponse.status !== 200 ||
          networkResponse.type === "opaque"
        ) {
          return networkResponse;
        }

        if (looksLikeMismatchedAsset(request.url, networkResponse)) {
          console.error("[sw] asset response mime type mismatch, not caching:", request.url);
          return networkResponse;
        }

        // clone response since we need to use it twice
        const responseToCache = networkResponse.clone();

        caches.open(CACHE_NAME).then((cache) => {
          cache.put(request, responseToCache);
        });

        return networkResponse;
      })
      .catch((error) => {
        console.error("[sw] fetch failed:", error);
        // could return a custom offline page here if needed
        throw error;
      });
  });
}

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
