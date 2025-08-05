// Minimal Service Worker for Playlistz
// Caches the current page for offline access

const CACHE_NAME = 'playlistz-cache-v1';

// Install event - cache the current page
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Cache the page that registered this service worker
      return self.clients.matchAll().then((clients) => {
        if (clients.length > 0) {
          const currentUrl = clients[0].url.split('?')[0]; // Remove query params
          return cache.add(currentUrl).catch((error) => {
            console.warn('Failed to cache page:', error);
          });
        }
        return Promise.resolve();
      });
    })
  );
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch event - serve cached page for any HTML request
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Only handle GET requests from same origin
  if (request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  // For HTML requests (any path), try to serve the cached page
  if (request.headers.get('Accept')?.includes('text/html') ||
      url.pathname.endsWith('.html') ||
      url.pathname === '/' ||
      url.pathname.endsWith('/')) {

    event.respondWith(
      caches.open(CACHE_NAME).then((cache) => {
        return cache.keys().then((keys) => {
          // Find any cached HTML page and serve it
          for (const key of keys) {
            const keyUrl = new URL(key.url);
            if (keyUrl.pathname.endsWith('.html') || keyUrl.pathname === '/') {
              return cache.match(key);
            }
          }
          // No cached page found, try network
          return fetch(request);
        });
      }).catch(() => {
        return new Response('App offline - no cached page available', {
          status: 503,
          headers: { 'Content-Type': 'text/plain' }
        });
      })
    );
    return;
  }

  // For other requests, try cache first, then network
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(request);
    })
  );
});
