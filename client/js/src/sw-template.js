// Simple Service Worker for Playlistz - Cache everything, serve from cache when offline
const CACHE_NAME = "playlistz-cache-v1";

// Install event - skip waiting to activate immediately
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

// Activate event - take control of all pages
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        // Delete old caches
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME) {
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => {
        return self.clients.claim();
      })
      .then(() => {
        // Notify all clients that SW is ready
        return self.clients.matchAll();
      })
      .then((clients) => {
        clients.forEach((client) => {
          client.postMessage({ type: "SW_READY" });
        });
      })
  );
});

// Fetch event - cache only HTML and SW, serve from cache when offline
self.addEventListener("fetch", (event) => {
  const request = event.request;

  // Only handle GET requests
  if (request.method !== "GET") {
    return;
  }

  // Skip non-HTTP(S) requests
  if (!request.url.startsWith("http")) {
    return;
  }

  // Skip /data/ resources (audio files, etc.) - these are stored in IndexedDB
  if (request.url.includes("/data/")) {
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then((cache) => {
      // Try network first
      return fetch(request)
        .then((networkResponse) => {
          // Only cache HTML pages and the service worker itself
          const shouldCache =
            networkResponse.ok &&
            (request.url.endsWith(".html") || request.url.endsWith("sw.js"));

          if (shouldCache) {
            cache
              .put(request, networkResponse.clone())
              .then(() => {})
              .catch((cacheError) => {
                console.error("[sw] failed to cache:", request.url, cacheError);
              });
          }
          return networkResponse;
        })
        .catch((networkError) => {
          // Network failed, try cache
          return cache.match(request).then((cachedResponse) => {
            if (cachedResponse) {
              return cachedResponse;
            }

            // Return a proper Response instead of throwing
            return new Response("Page not available offline", {
              status: 503,
              statusText: "Service Unavailable",
              headers: { "Content-Type": "text/plain" },
            });
          });
        })
        .catch((error) => {
          console.error("[sw] Cache operation failed:", error);
          return new Response("Cache error", {
            status: 503,
            statusText: "Service Unavailable",
            headers: { "Content-Type": "text/plain" },
          });
        });
    })
  );
});

// Handle messages from main thread
self.addEventListener("message", (event) => {
  const { type, data } = event.data;

  if (type === "CACHE_URL") {
    caches.open(CACHE_NAME).then((cache) => {
      cache.add(data.url).catch((error) => {
        console.error("[sw] Failed to cache:", data.url, error);
      });
    });
  } else if (type === "CLAIM_CLIENTS") {
    self.clients
      .claim()
      .then(() => {
        return self.clients.matchAll();
      })
      .then((clients) => {
        clients.forEach((client) => {
          client.postMessage({ type: "SW_READY" });
        });
      });
  }
});
