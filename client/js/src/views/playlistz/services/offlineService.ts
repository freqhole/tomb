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
 * Generate and register PWA manifest - simplified approach
 */
function generatePWAManifest(playlistTitle?: string): void {
  const appName = playlistTitle || "playlistz";

  // Create a super simple manifest object
  const manifest = {
    name: appName,
    short_name: appName.length > 12 ? appName.substring(0, 12) : appName,
    description: "Offline music playlist manager",
    start_url: "./",
    display: "standalone",
    background_color: "#000000",
    theme_color: "#000000",
    icons: [
      {
        src: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192" viewBox="0 0 192 192"><rect width="192" height="192" fill="#000000"/><text x="96" y="125" text-anchor="middle" font-size="100" font-family="Arial,sans-serif" font-weight="bold" fill="magenta">z</text></svg>')}`,
        sizes: "192x192",
        type: "image/svg+xml",
      },
    ],
  };

  // Clear any existing manifest and apple-touch-icons for iOS refresh
  const existingLink = document.querySelector('link[rel="manifest"]');
  if (existingLink) {
    existingLink.remove();
  }

  // Force iOS to refresh by removing all apple-touch-icons
  const existingAppleIcons = document.querySelectorAll(
    'link[rel="apple-touch-icon"]'
  );
  existingAppleIcons.forEach((icon) => icon.remove());

  // Create new manifest with cache busting
  const manifestJSON = JSON.stringify(manifest);
  const manifestBlob = new Blob([manifestJSON], {
    type: "application/manifest+json",
  });
  const manifestURL = URL.createObjectURL(manifestBlob);

  const link = document.createElement("link");
  link.rel = "manifest";
  link.href = `${manifestURL}?v=${Date.now()}`;
  document.head.appendChild(link);

  // Add iOS meta tags
  const metaTags = [
    { name: "apple-mobile-web-app-capable", content: "yes" },
    {
      name: "apple-mobile-web-app-status-bar-style",
      content: "black-translucent",
    },
    { name: "apple-mobile-web-app-title", content: appName },
    { name: "theme-color", content: "#000000" },
  ];

  metaTags.forEach(({ name, content }) => {
    let meta = document.querySelector(`meta[name="${name}"]`);
    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", name);
      document.head.appendChild(meta);
    }
    meta.setAttribute("content", content);
  });

  // Add fresh apple-touch-icons for iOS (multiple sizes with cache busting)
  const iconSizes = [
    "57x57",
    "60x60",
    "72x72",
    "76x76",
    "114x114",
    "120x120",
    "144x144",
    "152x152",
    "180x180",
  ];
  const iconSvg = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180"><rect width="180" height="180" fill="#000000"/><text x="90" y="117" text-anchor="middle" font-size="94" font-family="Arial,sans-serif" font-weight="bold" fill="magenta">z</text></svg>')}`;

  iconSizes.forEach((size) => {
    const iconLink = document.createElement("link");
    iconLink.rel = "apple-touch-icon";
    iconLink.sizes = size;
    iconLink.href = `${iconSvg}#${Date.now()}`;
    document.head.appendChild(iconLink);
  });

  // Default apple-touch-icon
  const defaultIcon = document.createElement("link");
  defaultIcon.rel = "apple-touch-icon";
  defaultIcon.href = `${iconSvg}#${Date.now()}`;
  document.head.appendChild(defaultIcon);
}

/**
 * Update PWA manifest with new playlist title
 */
export function updatePWAManifest(playlistTitle: string): void {
  generatePWAManifest(playlistTitle);
}

/**
 * Register service worker
 */
async function registerServiceWorker(): Promise<boolean> {
  setTimeout(async () => {
    try {
      if (!("serviceWorker" in navigator)) {
        return;
      }

      const swPath = "./sw.js";
      const registration = await navigator.serviceWorker.register(swPath);
      await navigator.serviceWorker.ready;

      setServiceWorkerReady(true);

      // Listen for service worker messages
      navigator.serviceWorker.addEventListener("message", (event) => {
        const { type } = event.data;
        if (type === "SW_READY") {
          cacheCurrentPage();
        }
      });

      // Check if SW is already controlling and cache page if so
      if (navigator.serviceWorker.controller) {
        cacheCurrentPage();
      } else {
        const newWorker =
          registration.active ||
          registration.installing ||
          registration.waiting;
        if (newWorker) {
          newWorker.postMessage({ type: "CLAIM_CLIENTS" });
        }
      }
    } catch (error) {
      console.warn("⚠️ Service worker registration failed:", error);
    }
  }, 100);

  return false;
}

/**
 * Cache the current page for offline access
 */
async function cacheCurrentPage(): Promise<void> {
  try {
    const cache = await caches.open(CACHE_NAME);
    const currentUrl = window.location.href;

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

    if (window.location.protocol === "file:") {
      return;
    }

    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: "CACHE_URL",
        data: { url },
      });
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
export async function initializeOfflineSupport(
  playlistTitle?: string
): Promise<void> {
  const updateOnlineStatus = () => {
    setIsOnline(navigator.onLine);
  };

  window.addEventListener("online", updateOnlineStatus);
  window.addEventListener("offline", updateOnlineStatus);

  generatePWAManifest(playlistTitle);
  await requestPersistentStorage();
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
  error?: string;
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
    return { error: error instanceof Error ? error.message : String(error) };
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
