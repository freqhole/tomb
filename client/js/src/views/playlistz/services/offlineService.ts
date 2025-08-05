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
function generatePWAManifest(): void {
  const manifest = {
    name: "Playlistz",
    short_name: "Playlistz",
    description: "Offline-capable music playlist manager",
    start_url: "/",
    display: "standalone",
    background_color: "#000000",
    theme_color: "#000000",
    orientation: "portrait-primary",
    scope: "/",
    icons: [
      {
        src: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ccircle cx='50' cy='50' r='40' fill='%23fff'/%3E%3Ctext x='50' y='60' text-anchor='middle' font-size='40' fill='%23000'%3E♪%3C/text%3E%3C/svg%3E",
        sizes: "192x192",
        type: "image/svg+xml",
        purpose: "any maskable",
      },
      {
        src: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ccircle cx='50' cy='50' r='40' fill='%23fff'/%3E%3Ctext x='50' y='60' text-anchor='middle' font-size='40' fill='%23000'%3E♪%3C/text%3E%3C/svg%3E",
        sizes: "512x512",
        type: "image/svg+xml",
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
    { name: "apple-mobile-web-app-title", content: "Playlistz" },
    { name: "mobile-web-app-capable", content: "yes" },
    { name: "application-name", content: "Playlistz" },
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

  console.log("✅ PWA manifest generated and registered");
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

      console.log("🔄 Registering service worker:", swPath);
      console.log("🔍 Current URL:", window.location.href);
      console.log("🔍 STANDALONE_MODE:", (window as any).STANDALONE_MODE);

      const registration = await navigator.serviceWorker.register(swPath);
      console.log("✅ Service worker registered:", registration);

      await navigator.serviceWorker.ready;
      console.log("✅ Service worker ready");

      setServiceWorkerReady(true);

      // Force the SW to take control immediately
      if (!navigator.serviceWorker.controller) {
        console.log("🔄 Claiming SW control...");
        const newWorker =
          registration.active ||
          registration.installing ||
          registration.waiting;
        if (newWorker) {
          newWorker.postMessage({ type: "SKIP_WAITING" });
        }
        // Force reload to get SW control
        setTimeout(() => {
          if (!navigator.serviceWorker.controller) {
            console.log("🔄 Reloading to activate service worker...");
            window.location.reload();
          }
        }, 1000);
      } else {
        console.log("✅ Service worker is controlling this page");
      }

      // Listen for service worker messages
      navigator.serviceWorker.addEventListener("message", (event) => {
        const { type, data } = event.data;
        console.log("📨 Message from SW:", type, data);
      });

      // Listen for SW state changes
      registration.addEventListener("updatefound", () => {
        console.log("🔄 Service worker update found");
      });
    } catch (error) {
      console.error("❌ Service worker registration failed:", error);
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
    console.log(`✅ Cached audio file: ${title}`);
  } catch (error) {
    console.error(`❌ Failed to cache audio file ${title}:`, error);
    throw error;
  }
}

/**
 * Initialize offline support
 */
export async function initializeOfflineSupport(): Promise<void> {
  console.log("🔄 Initializing offline support...");

  // Set up online/offline listeners
  const updateOnlineStatus = () => {
    const online = navigator.onLine;
    setIsOnline(online);
    console.log(`📡 Connection status: ${online ? "online" : "offline"}`);
  };

  window.addEventListener("online", updateOnlineStatus);
  window.addEventListener("offline", updateOnlineStatus);

  // Generate and register PWA manifest
  generatePWAManifest();

  // Request persistent storage
  await requestPersistentStorage();

  // Register service worker asynchronously (don't block initialization)
  registerServiceWorker();

  console.log("✅ Offline support initialized");
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
      console.log("✅ All caches cleared");
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
    return { error: error.message };
  }
}

/**
 * Debug cache contents - useful for troubleshooting
 */
export async function debugCache(): Promise<void> {
  try {
    console.log("🔍 DEBUG: Cache debugging started");

    if (!("caches" in window)) {
      console.log("❌ DEBUG: Cache API not supported");
      return;
    }

    const cacheNames = await caches.keys();
    console.log("📂 DEBUG: Available caches:", cacheNames);

    for (const cacheName of cacheNames) {
      const cache = await caches.open(cacheName);
      const keys = await cache.keys();
      console.log(
        `📦 DEBUG: Cache "${cacheName}" contains ${keys.length} items:`
      );

      keys.forEach((request, index) => {
        console.log(`  ${index + 1}. ${request.url}`);
      });
    }

    console.log("🔍 DEBUG: Service Worker status:");
    console.log("  - SW supported:", "serviceWorker" in navigator);
    console.log("  - SW ready:", serviceWorkerReady());
    console.log("  - SW controller:", !!navigator.serviceWorker?.controller);
    console.log("  - Online:", isOnline());
    console.log("  - Persistent storage:", persistentStorageGranted());

    console.log("✅ DEBUG: Cache debugging complete");
  } catch (error) {
    console.error("❌ DEBUG: Error debugging cache:", error);
  }
}

// Make debug functions available on window for easy testing
if (typeof window !== "undefined") {
  (window as any).debugPlaylistzCache = debugCache;
  (window as any).testCacheNow = async () => {
    try {
      console.log("🧪 Testing cache manually...");
      const cache = await caches.open(CACHE_NAME);
      const currentUrl = window.location.href;

      // Try to cache current page
      console.log("💾 Manually caching current page:", currentUrl);
      await cache.add(currentUrl);
      console.log("✅ Manual cache successful");

      // Check what's cached
      const keys = await cache.keys();
      console.log("📦 Cache now contains:", keys.length, "items");
      keys.forEach((req, i) => console.log(`  ${i + 1}. ${req.url}`));

      return true;
    } catch (error) {
      console.error("❌ Manual cache test failed:", error);
      return false;
    }
  };
  console.log(
    "🔧 Debug functions available: debugPlaylistzCache(), testCacheNow()"
  );
}
