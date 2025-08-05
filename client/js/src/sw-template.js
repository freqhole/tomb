// Simple Service Worker for Playlistz - Cache everything, serve from cache when offline
const CACHE_NAME = "playlistz-cache-v1";

// Install event - skip waiting to activate immediately
self.addEventListener("install", (event) => {
  console.log("🔧 SW: Installing service worker");
  console.log("🔧 SW: Cache name:", CACHE_NAME);
  self.skipWaiting();
});

// Activate event - take control of all pages
self.addEventListener("activate", (event) => {
  console.log("✅ SW: Activating service worker");
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        console.log("🔍 SW: Found existing caches:", cacheNames);
        // Delete old caches
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME) {
              console.log("🗑️ SW: Deleting old cache:", cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => {
        console.log("🎯 SW: Taking control of all pages");
        return self.clients.claim();
      })
      .then(() => {
        console.log("✅ SW: Service worker activated and controlling pages");
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
    console.log(
      "⏭️ SW: Skipping non-GET request:",
      request.method,
      request.url
    );
    return;
  }

  // Skip non-HTTP(S) requests
  if (!request.url.startsWith("http")) {
    console.log("⏭️ SW: Skipping non-HTTP request:", request.url);
    return;
  }

  // Skip /data/ resources (audio files, etc.) - these are stored in IndexedDB
  if (request.url.includes("/data/")) {
    console.log(
      "⏭️ SW: Skipping /data/ resource (stored in IndexedDB):",
      request.url
    );
    return;
  }

  console.log("🌐 SW: Handling request:", request.url);

  event.respondWith(
    caches.open(CACHE_NAME).then((cache) => {
      // Try network first
      return fetch(request)
        .then((networkResponse) => {
          console.log(
            "✅ SW: Network success for:",
            request.url,
            "Status:",
            networkResponse.status
          );
          // Only cache HTML pages and the service worker itself
          const shouldCache =
            networkResponse.ok &&
            (request.url.endsWith(".html") || request.url.endsWith("sw.js"));

          if (shouldCache) {
            console.log("💾 SW: Caching:", request.url);
            cache
              .put(request, networkResponse.clone())
              .then(() => {
                console.log("✅ SW: Successfully cached:", request.url);
              })
              .catch((cacheError) => {
                console.error(
                  "❌ SW: Failed to cache:",
                  request.url,
                  cacheError
                );
              });
          } else if (networkResponse.ok) {
            console.log("⏭️ SW: Not caching (not HTML/SW):", request.url);
          } else {
            console.log(
              "⚠️ SW: Network response not ok:",
              networkResponse.status,
              request.url
            );
          }
          return networkResponse;
        })
        .catch((networkError) => {
          console.log(
            "❌ SW: Network failed for:",
            request.url,
            networkError.message
          );
          // Network failed, try cache
          return cache.match(request).then((cachedResponse) => {
            if (cachedResponse) {
              console.log("📦 SW: Serving from cache:", request.url);
              return cachedResponse;
            }
            console.log("💥 SW: No cache found for:", request.url);
            // Return a proper Response instead of throwing
            return new Response("Page not available offline", {
              status: 503,
              statusText: "Service Unavailable",
              headers: { "Content-Type": "text/plain" },
            });
          });
        })
        .catch((error) => {
          console.error("❌ SW: Cache operation failed:", error);
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
  console.log("📨 SW: Received message:", type, data);

  if (type === "CACHE_URL") {
    caches.open(CACHE_NAME).then((cache) => {
      console.log("💾 SW: Manual caching:", data.url);
      cache.add(data.url).catch((error) => {
        console.error("❌ SW: Failed to cache:", data.url, error);
      });
    });
  } else if (type === "CLAIM_CLIENTS") {
    console.log("🚀 SW: Claiming control of all clients");
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
