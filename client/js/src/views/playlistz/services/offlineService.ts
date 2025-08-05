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
 * Generate and register PWA manifest
 */
function generatePWAManifest(playlistTitle?: string): void {
  const appName = playlistTitle || "Playlistz";
  const iconPng =
    "data:image/png;base64,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IECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAAECBAgQIECAAIHcAv8PdHhKodTk8K4AAAAASUVORK5CYII=";

  const manifest = {
    name: appName,
    short_name: appName.length > 12 ? appName.substring(0, 12) : appName,
    description: "offline-capable music playlist manager",
    start_url: "./",
    display: "standalone",
    background_color: "#000000",
    theme_color: "#000000",
    orientation: "portrait-primary",
    scope: "./",
    icons: [
      {
        src: iconPng,
        sizes: "192x192",
        type: "image/png",
        purpose: "any maskable",
      },
      {
        src: iconPng,
        sizes: "512x512",
        type: "image/png",
        purpose: "any maskable",
      },
    ],
    categories: ["music", "entertainment"],
    lang: "en",
  };

  // Create manifest blob and URL
  const manifestBlob = new Blob([JSON.stringify(manifest)], {
    type: "application/manifest+json",
  });
  const manifestURL = URL.createObjectURL(manifestBlob);

  // Add manifest link to head
  const existingLink = document.querySelector('link[rel="manifest"]');
  if (existingLink) {
    existingLink.remove();
  }

  const link = document.createElement("link");
  link.rel = "manifest";
  link.href = manifestURL;
  document.head.appendChild(link);

  // Add iOS-specific meta tags for better PWA support
  const iosMetaTags = [
    { name: "apple-mobile-web-app-capable", content: "yes" },
    {
      name: "apple-mobile-web-app-status-bar-style",
      content: "black-translucent",
    },
    { name: "apple-mobile-web-app-title", content: appName },
    { name: "mobile-web-app-capable", content: "yes" },
    { name: "application-name", content: appName },
    { name: "msapplication-TileColor", content: "#000000" },
    { name: "theme-color", content: "#000000" },
  ];

  iosMetaTags.forEach(({ name, content }) => {
    let existingMeta = document.querySelector(`meta[name="${name}"]`);
    if (!existingMeta) {
      existingMeta = document.createElement("meta");
      existingMeta.setAttribute("name", name);
      document.head.appendChild(existingMeta);
    }
    existingMeta.setAttribute("content", content);
  });
}

/**
 * Update PWA manifest with new playlist title
 */
export function updatePWAManifest(playlistTitle: string): void {
  generatePWAManifest(playlistTitle);
}

/**
 * Register service worker using generated sw.js file
 */
async function registerServiceWorker(): Promise<boolean> {
  // Run service worker registration asynchronously to not block the app
  setTimeout(async () => {
    try {
      if (!("serviceWorker" in navigator)) {
        console.warn("❌ Service Worker not supported");
        return;
      }

      // Service worker is always at ./sw.js (now at root level in both modes)
      const swPath = "./sw.js";

      const registration = await navigator.serviceWorker.register(swPath);
      await navigator.serviceWorker.ready;

      setServiceWorkerReady(true);

      // Listen for service worker messages
      navigator.serviceWorker.addEventListener("message", (event) => {
        const { type } = event.data;

        if (type === "SW_READY") {
          // SW is now controlling the page, cache it
          cacheCurrentPage();
        }
      });

      // Listen for SW state changes
      registration.addEventListener("updatefound", () => {
        // Service worker update found
      });

      // Check if SW is already controlling and cache page if so
      if (navigator.serviceWorker.controller) {
        cacheCurrentPage();
      } else {
        // Send message to SW to take control
        const newWorker =
          registration.active ||
          registration.installing ||
          registration.waiting;
        if (newWorker) {
          newWorker.postMessage({ type: "CLAIM_CLIENTS" });
        }
      }
    } catch (error) {
      console.error("❌ Service worker registration failed:", error);
    }
  }, 100);

  // Return false immediately to not block app initialization
  return false;
}

/**
 * Cache the current page for offline access
 */
async function cacheCurrentPage(): Promise<void> {
  try {
    const cache = await caches.open(CACHE_NAME);
    const currentUrl = window.location.href;

    // Check if already cached
    const cached = await cache.match(currentUrl);
    if (!cached) {
      await cache.add(currentUrl);
    }
  } catch (error) {
    console.warn("⚠️ Failed to auto-cache page:", error);
  }
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

    // Try using service worker message if available
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: "CACHE_URL",
        data: { url },
      });
      return;
    }

    // Fallback to direct cache API
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
export async function initializeOfflineSupport(
  playlistTitle?: string
): Promise<void> {
  // Set up online/offline listeners
  const updateOnlineStatus = () => {
    const online = navigator.onLine;
    setIsOnline(online);
  };

  window.addEventListener("online", updateOnlineStatus);
  window.addEventListener("offline", updateOnlineStatus);

  // Generate and register PWA manifest
  generatePWAManifest(playlistTitle);

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

    // Check cache
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

/**
 * Get cache status and information
 */
export async function getCacheStatus(): Promise<any> {
  try {
    if (!("caches" in window)) {
      return { supported: false };
    }

    const cache = await caches.open(CACHE_NAME);
    const keys = await cache.keys();

    return {
      supported: true,
      entryCount: keys.length,
      urls: keys.map((req) => req.url),
      serviceWorkerReady: serviceWorkerReady(),
      isOnline: isOnline(),
      persistentStorage: persistentStorageGranted(),
    };
  } catch (error) {
    console.error("❌ Error getting cache status:", error);
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
