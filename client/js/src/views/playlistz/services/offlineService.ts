import { createSignal } from "solid-js";

// Offline state signals
const [isOnline, setIsOnline] = createSignal(navigator.onLine);
const [serviceWorkerReady, setServiceWorkerReady] = createSignal(false);
const [persistentStorageGranted, setPersistentStorageGranted] =
  createSignal(false);

// Export signals for components to use
export { isOnline, serviceWorkerReady, persistentStorageGranted };

/**
 * Service worker code as a string (will be converted to blob URL)
 */
const SERVICE_WORKER_CODE = `
// Inline Service Worker for Playlistz
const CACHE_NAME = 'playlistz-cache-v1';
const CACHE_URLS = [
  // The current page (will be added dynamically)
];

// Install event - cache the current page
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Cache the current page URL
      const currentUrl = self.location.href.split('?')[0]; // Remove query params
      return cache.add(currentUrl);
    }).catch((error) => {
      console.error('❌ Service Worker install failed:', error);
    })
  );

  // Force the waiting service worker to become the active service worker
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
    }).then(() => {
      // Claim all clients immediately
      return self.clients.claim();
    })
  );
});

// Fetch event - serve from cache when offline
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Only handle same-origin requests and relative file paths
  if (url.origin === self.location.origin || url.protocol === 'file:') {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }

        // Try to fetch from network
        return fetch(event.request).then((response) => {
          // Only cache successful responses
          if (response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return response;
        }).catch((error) => {
          throw error;
        });
      })
    );
  }
});

// Handle messages from the main thread
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'CACHE_AUDIO_FILE') {
    const { url, title } = event.data;

    caches.open(CACHE_NAME).then((cache) => {
      return cache.add(url);
    }).then(() => {
      // Send confirmation back to main thread
      event.source.postMessage({
        type: 'AUDIO_FILE_CACHED',
        url: url,
        title: title
      });
    }).catch((error) => {
      console.error('❌ Failed to cache audio file:', title, error);
      event.source.postMessage({
        type: 'AUDIO_FILE_CACHE_FAILED',
        url: url,
        title: title,
        error: error.message
      });
    });
  }
});
`;

/**
 * Request persistent storage
 */
async function requestPersistentStorage(): Promise<boolean> {
  try {
    if ("storage" in navigator && "persist" in navigator.storage) {
      const granted = await navigator.storage.persist();

      if (granted) {
        setPersistentStorageGranted(true);
      } else {
        setPersistentStorageGranted(false);
      }

      return granted;
    } else {
      return false;
    }
  } catch (error) {
    console.error("❌ Error requesting persistent storage:", error);
    return false;
  }
}

/**
 * Register the inline service worker
 */
async function registerServiceWorker(): Promise<boolean> {
  try {
    if (!("serviceWorker" in navigator)) {
      return false;
    }

    // Skip service worker for file:// protocol as it's not supported
    if (window.location.protocol === "file:") {
      return false;
    }

    // For HTTPS, create a data URL instead of blob URL for better compatibility
    // Use unescape/encodeURIComponent to handle special characters properly
    const encodedCode = btoa(unescape(encodeURIComponent(SERVICE_WORKER_CODE)));
    const dataUrl = `data:application/javascript;base64,${encodedCode}`;

    await navigator.serviceWorker.register(dataUrl);

    // Wait for the service worker to be ready
    await navigator.serviceWorker.ready;
    setServiceWorkerReady(true);

    return true;
  } catch (error) {
    console.error("❌ Service Worker registration failed:", error);
    // Continue without service worker - offline features will be limited but app still works
    return false;
  }
}

/**
 * Cache an audio file for offline access
 */
export function cacheAudioFile(url: string, title: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!serviceWorkerReady()) {
      reject(new Error("Service Worker not ready"));
      return;
    }

    // Skip for file:// protocol
    if (window.location.protocol === "file:") {
      resolve();
      return;
    }

    if (!navigator.serviceWorker.controller) {
      reject(new Error("No active Service Worker"));
      return;
    }

    const messageChannel = new MessageChannel();

    messageChannel.port1.onmessage = (event) => {
      if (event.data.type === "AUDIO_FILE_CACHED") {
        resolve();
      } else if (event.data.type === "AUDIO_FILE_CACHE_FAILED") {
        reject(new Error(event.data.error));
      }
    };

    navigator.serviceWorker.controller.postMessage(
      {
        type: "CACHE_AUDIO_FILE",
        url: url,
        title: title,
      },
      [messageChannel.port2]
    );
  });
}

/**
 * Initialize offline support
 */
export async function initializeOfflineSupport(): Promise<void> {
  // Set up online/offline listeners
  const updateOnlineStatus = () => {
    setIsOnline(navigator.onLine);
  };

  window.addEventListener("online", updateOnlineStatus);
  window.addEventListener("offline", updateOnlineStatus);

  // Request persistent storage
  await requestPersistentStorage();

  // Register service worker (will skip for file:// protocol)
  await registerServiceWorker();
}

/**
 * Get storage usage information
 */
export async function getStorageInfo(): Promise<{
  quota?: number;
  usage?: number;
  quotaFormatted?: string;
  usageFormatted?: string;
  usagePercent?: number;
  persistent?: boolean;
}> {
  try {
    const info: any = {};

    if ("storage" in navigator) {
      if ("estimate" in navigator.storage) {
        const estimate = await navigator.storage.estimate();
        info.quota = estimate.quota;
        info.usage = estimate.usage;

        if (estimate.quota) {
          info.quotaFormatted =
            Math.round(estimate.quota / 1024 / 1024) + " MB";
        }

        if (estimate.usage) {
          info.usageFormatted =
            Math.round(estimate.usage / 1024 / 1024) + " MB";
        }

        if (estimate.quota && estimate.usage) {
          info.usagePercent = Math.round(
            (estimate.usage / estimate.quota) * 100
          );
        }
      }

      if ("persisted" in navigator.storage) {
        info.persistent = await navigator.storage.persisted();
      }
    }

    return info;
  } catch (error) {
    console.error("❌ Error getting storage info:", error);
    return {};
  }
}

/**
 * Check if a URL is cached
 */
export async function isUrlCached(url: string): Promise<boolean> {
  try {
    if (!("caches" in window)) {
      return false;
    }

    const cache = await caches.open("playlistz-cache-v1");
    const response = await cache.match(url);
    return !!response;
  } catch (error) {
    console.error("❌ Error checking cache:", error);
    return false;
  }
}

/**
 * Clear all cached data
 */
export async function clearCache(): Promise<void> {
  try {
    if ("caches" in window) {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames.map((cacheName) => {
          return caches.delete(cacheName);
        })
      );
    }
  } catch (error) {
    console.error("❌ Error clearing cache:", error);
    throw error;
  }
}
