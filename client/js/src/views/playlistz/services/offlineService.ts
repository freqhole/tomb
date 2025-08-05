import { createSignal } from "solid-js";

// Offline state signals
const [isOnline, setIsOnline] = createSignal(navigator.onLine);
const [serviceWorkerReady, setServiceWorkerReady] = createSignal(false);
const [persistentStorageGranted, setPersistentStorageGranted] =
  createSignal(false);

// Export signals for components to use
export { isOnline, serviceWorkerReady, persistentStorageGranted };

const CACHE_NAME = "playlistz-cache-v1";

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
 * Register service worker using generated sw.js file
 */
async function registerServiceWorker(): Promise<boolean> {
  // Run service worker registration asynchronously to not block the app
  setTimeout(async () => {
    try {
      if (!("serviceWorker" in navigator)) {
        return;
      }

      // Use STANDALONE_MODE to determine correct service worker path
      const swPath = (window as any).STANDALONE_MODE
        ? "./data/sw.js"
        : "./sw.js";

      await navigator.serviceWorker.register(swPath);
      await navigator.serviceWorker.ready;
      setServiceWorkerReady(true);
    } catch (error) {
      // Silently fail - service worker should not interfere with app
    }
  }, 100);

  // Return false immediately to not block app initialization
  return false;
}

/**
 * Cache an audio file for offline access
 */
export async function cacheAudioFile(
  url: string,
  title: string
): Promise<void> {
  try {
    if (!("caches" in window)) {
      throw new Error("Cache API not supported");
    }

    // Skip for file:// protocol
    if (window.location.protocol === "file:") {
      return;
    }

    const cache = await caches.open(CACHE_NAME);
    await cache.add(url);
  } catch (error) {
    console.error(`❌ Failed to cache audio file ${title}:`, error);
    throw error;
  }
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

  // Register service worker asynchronously (don't block initialization)
  registerServiceWorker();
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

    const cache = await caches.open(CACHE_NAME);
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
