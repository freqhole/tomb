import { createSignal } from "solid-js";

// Offline state signals
const [isOnline, setIsOnline] = createSignal(navigator.onLine);
const [serviceWorkerReady, setServiceWorkerReady] = createSignal(false);
const [persistentStorageGranted, setPersistentStorageGranted] = createSignal(false);

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
  console.log('📦 Service Worker installing...');

  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Cache the current page URL
      const currentUrl = self.location.href.split('?')[0]; // Remove query params
      console.log('📦 Caching current page:', currentUrl);
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
  console.log('✅ Service Worker activating...');

  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('🗑️ Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      console.log('✅ Service Worker activated and ready');
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
          console.log('📱 Serving from cache:', event.request.url);
          return cachedResponse;
        }

        // Try to fetch from network
        return fetch(event.request).then((response) => {
          // Only cache successful responses
          if (response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
              console.log('💾 Cached response for:', event.request.url);
            });
          }
          return response;
        }).catch((error) => {
          console.log('❌ Network fetch failed:', event.request.url, error);

          // For audio files, try to return a meaningful error
          if (event.request.url.includes('.mp3') ||
              event.request.url.includes('.m4a') ||
              event.request.url.includes('.wav') ||
              event.request.url.includes('.ogg') ||
              event.request.url.includes('.flac')) {
            console.log('🎵 Audio file not available offline');
          }

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
    console.log('🎵 Caching audio file:', title, url);

    caches.open(CACHE_NAME).then((cache) => {
      return cache.add(url);
    }).then(() => {
      console.log('✅ Audio file cached:', title);
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
    if ('storage' in navigator && 'persist' in navigator.storage) {
      console.log('🔒 Requesting persistent storage...');
      const granted = await navigator.storage.persist();

      if (granted) {
        console.log('✅ Persistent storage granted');
        setPersistentStorageGranted(true);
      } else {
        console.log('❌ Persistent storage denied');
        setPersistentStorageGranted(false);
      }

      // Check current storage estimate
      if ('estimate' in navigator.storage) {
        const estimate = await navigator.storage.estimate();
        console.log('💾 Storage estimate:', {
          quota: estimate.quota ? Math.round(estimate.quota / 1024 / 1024) + ' MB' : 'Unknown',
          usage: estimate.usage ? Math.round(estimate.usage / 1024 / 1024) + ' MB' : 'Unknown',
          usagePercent: estimate.quota && estimate.usage ?
            Math.round((estimate.usage / estimate.quota) * 100) + '%' : 'Unknown'
        });
      }

      return granted;
    } else {
      console.log('❌ Persistent storage not supported');
      return false;
    }
  } catch (error) {
    console.error('❌ Error requesting persistent storage:', error);
    return false;
  }
}

/**
 * Register the inline service worker
 */
async function registerServiceWorker(): Promise<boolean> {
  try {
    if (!('serviceWorker' in navigator)) {
      console.log('❌ Service Workers not supported');
      return false;
    }

    // Skip service worker for file:// protocol as it's not supported
    if (window.location.protocol === 'file:') {
      console.log('⚠️ Service Worker not supported with file:// protocol');
      return false;
    }

    console.log('📦 Registering inline service worker...');

    // Create blob URL for the service worker
    const blob = new Blob([SERVICE_WORKER_CODE], { type: 'application/javascript' });
    const swUrl = URL.createObjectURL(blob);

    const registration = await navigator.serviceWorker.register(swUrl);

    console.log('✅ Service Worker registered:', registration);

    // Wait for the service worker to be ready
    await navigator.serviceWorker.ready;
    setServiceWorkerReady(true);
    console.log('✅ Service Worker ready');

    // Clean up blob URL
    URL.revokeObjectURL(swUrl);

    // Listen for service worker updates
    registration.addEventListener('updatefound', () => {
      console.log('🔄 Service Worker update found');
      const newWorker = registration.installing;
      if (newWorker) {
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            console.log('✅ New Service Worker installed');
          }
        });
      }
    });

    return true;
  } catch (error) {
    console.error('❌ Service Worker registration failed:', error);
    return false;
  }
}

/**
 * Cache an audio file for offline access
 */
export function cacheAudioFile(url: string, title: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!serviceWorkerReady()) {
      reject(new Error('Service Worker not ready'));
      return;
    }

    // Skip for file:// protocol
    if (window.location.protocol === 'file:') {
      console.log('⚠️ Audio caching not needed for file:// protocol');
      resolve();
      return;
    }

    if (!navigator.serviceWorker.controller) {
      reject(new Error('No active Service Worker'));
      return;
    }

    const messageChannel = new MessageChannel();

    messageChannel.port1.onmessage = (event) => {
      if (event.data.type === 'AUDIO_FILE_CACHED') {
        resolve();
      } else if (event.data.type === 'AUDIO_FILE_CACHE_FAILED') {
        reject(new Error(event.data.error));
      }
    };

    navigator.serviceWorker.controller.postMessage(
      {
        type: 'CACHE_AUDIO_FILE',
        url: url,
        title: title
      },
      [messageChannel.port2]
    );
  });
}

/**
 * Initialize offline support
 */
export async function initializeOfflineSupport(): Promise<void> {
  console.log('🌐 Initializing offline support...');

  // Set up online/offline listeners
  const updateOnlineStatus = () => {
    setIsOnline(navigator.onLine);
    console.log(navigator.onLine ? '🌐 Back online' : '📱 Gone offline');
  };

  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);

  // Request persistent storage
  await requestPersistentStorage();

  // Register service worker (will skip for file:// protocol)
  await registerServiceWorker();

  console.log('✅ Offline support initialized');
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

    if ('storage' in navigator) {
      if ('estimate' in navigator.storage) {
        const estimate = await navigator.storage.estimate();
        info.quota = estimate.quota;
        info.usage = estimate.usage;

        if (estimate.quota) {
          info.quotaFormatted = Math.round(estimate.quota / 1024 / 1024) + ' MB';
        }

        if (estimate.usage) {
          info.usageFormatted = Math.round(estimate.usage / 1024 / 1024) + ' MB';
        }

        if (estimate.quota && estimate.usage) {
          info.usagePercent = Math.round((estimate.usage / estimate.quota) * 100);
        }
      }

      if ('persisted' in navigator.storage) {
        info.persistent = await navigator.storage.persisted();
      }
    }

    return info;
  } catch (error) {
    console.error('❌ Error getting storage info:', error);
    return {};
  }
}

/**
 * Check if a URL is cached
 */
export async function isUrlCached(url: string): Promise<boolean> {
  try {
    if (!('caches' in window)) {
      return false;
    }

    const cache = await caches.open('playlistz-cache-v1');
    const response = await cache.match(url);
    return !!response;
  } catch (error) {
    console.error('❌ Error checking cache:', error);
    return false;
  }
}

/**
 * Clear all cached data
 */
export async function clearCache(): Promise<void> {
  try {
    if ('caches' in window) {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames.map(cacheName => {
          console.log('🗑️ Clearing cache:', cacheName);
          return caches.delete(cacheName);
        })
      );
      console.log('✅ All caches cleared');
    }
  } catch (error) {
    console.error('❌ Error clearing cache:', error);
    throw error;
  }
}
