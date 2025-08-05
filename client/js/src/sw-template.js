// Simple Service Worker for Playlistz
// Caches the current page for offline access

const CACHE_NAME = "playlistz-cache-v1";
let currentPageUrl = null;

// Install event - cache the current page
self.addEventListener("install", (event) => {
  event.waitUntil(
    self.clients.matchAll().then((clients) => {
      if (clients.length > 0) {
        currentPageUrl = clients[0].url.split("?")[0]; // Remove query params
        return caches.open(CACHE_NAME).then((cache) => {
          return cache.add(currentPageUrl).catch((error) => {
            console.warn("Failed to cache page:", error);
          });
        });
      }
      return Promise.resolve();
    })
  );
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME) {
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => self.clients.claim())
  );
});

// Fetch event - serve the cached page for navigation requests
self.addEventListener("fetch", (event) => {
  const request = event.request;

  // Only handle navigation requests (when user navigates to the page)
  if (request.mode === "navigate") {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) => {
        // Try to serve the cached page
        if (currentPageUrl) {
          return cache.match(currentPageUrl).then((cachedResponse) => {
            if (cachedResponse) {
              return cachedResponse;
            }
            // If not cached, try network
            return fetch(request).catch(() => {
              return new Response("App offline - no cached page available", {
                status: 503,
                headers: { "Content-Type": "text/plain" },
              });
            });
          });
        }
        // Fallback to network
        return fetch(request);
      })
    );
  }
});
