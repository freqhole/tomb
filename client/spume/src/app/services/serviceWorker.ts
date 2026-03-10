// service worker registration and update management
// only active in production builds, not in dev or tauri mode

import { createSignal } from "solid-js";
import { isTauriMode } from "./tauri";
import { debug } from "../../utils/logger";

// reactive state for SW updates
const [updateAvailable, setUpdateAvailable] = createSignal(false);
const [swVersion, setSwVersion] = createSignal<string | null>(null);
const [swRegistration, setSwRegistration] = createSignal<ServiceWorkerRegistration | null>(null);

// store waiting worker reference
let waitingWorker: ServiceWorker | null = null;

/**
 * check if service worker should be enabled
 * - not in dev mode
 * - not in tauri mode (tauri handles its own caching)
 * - browser supports service workers
 */
export function shouldEnableServiceWorker(): boolean {
  if (import.meta.env.DEV) {
    debug("serviceWorker", "disabled in dev mode");
    return false;
  }

  if (isTauriMode()) {
    debug("serviceWorker", "disabled in tauri mode");
    return false;
  }

  if (!("serviceWorker" in navigator)) {
    debug("serviceWorker", "not supported by browser");
    return false;
  }

  return true;
}

/**
 * register service worker and set up update detection
 */
export async function registerServiceWorker(): Promise<void> {
  if (!shouldEnableServiceWorker()) {
    return;
  }

  try {
    const registration = await navigator.serviceWorker.register("/sw.js", {
      scope: "/",
    });

    setSwRegistration(registration);
    debug("serviceWorker", `registered with scope: ${registration.scope}`);

    // force check for updates on every page load (bypasses 24h browser cache)
    registration.update().catch((err) => {
      console.warn("[sw] initial update check failed:", err);
    });

    // get current SW version
    const activeWorker = registration.active;
    if (activeWorker) {
      requestSwVersion(activeWorker);
    }

    // check if there's already a waiting worker (update installed but not activated)
    if (registration.waiting) {
      debug("serviceWorker", "update already waiting");
      waitingWorker = registration.waiting;
      setUpdateAvailable(true);
    }

    // listen for new workers becoming available
    registration.addEventListener("updatefound", () => {
      const newWorker = registration.installing;
      if (!newWorker) return;

      debug("serviceWorker", "new version installing...");

      newWorker.addEventListener("statechange", () => {
        if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
          // new version installed and ready to take over
          debug("serviceWorker", "new version ready, update available");
          waitingWorker = newWorker;
          setUpdateAvailable(true);
        }
      });
    });

    // listen for controller change (when new SW takes over)
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      debug("serviceWorker", "controller changed, reloading...");
      window.location.reload();
    });

    // check for updates periodically (every 30 minutes)
    setInterval(
      () => {
        registration.update().catch((err) => {
          console.warn("[sw] update check failed:", err);
        });
      },
      30 * 60 * 1000
    );
  } catch (error) {
    console.error("[sw] registration failed:", error);
  }
}

/**
 * request version from a service worker via message
 */
function requestSwVersion(worker: ServiceWorker): void {
  const channel = new MessageChannel();
  channel.port1.onmessage = (event) => {
    if (event.data && event.data.version) {
      setSwVersion(event.data.version);
      debug("serviceWorker", `current version: ${event.data.version}`);
    }
  };
  worker.postMessage({ type: "GET_VERSION" }, [channel.port2]);
}

/**
 * activate the waiting service worker (apply the update)
 * this will trigger a page reload via controllerchange event
 */
export function applyServiceWorkerUpdate(): void {
  if (!waitingWorker) {
    debug("serviceWorker", "no waiting worker to apply");
    return;
  }

  debug("serviceWorker", "applying update...");
  waitingWorker.postMessage({ type: "SKIP_WAITING" });
}

/**
 * dismiss the update notification (defer until next visit)
 */
export function dismissUpdate(): void {
  setUpdateAvailable(false);
}

/**
 * manually check for service worker updates
 * returns true if an update was found
 */
export async function checkForUpdates(): Promise<boolean> {
  const registration = swRegistration();
  if (!registration) {
    debug("serviceWorker", "no registration, cannot check for updates");
    return false;
  }

  try {
    debug("serviceWorker", "manually checking for updates...");
    await registration.update();
    
    // check if there's now a waiting worker
    if (registration.waiting) {
      debug("serviceWorker", "update found");
      waitingWorker = registration.waiting;
      setUpdateAvailable(true);
      return true;
    }
    
    debug("serviceWorker", "no update available");
    return false;
  } catch (error) {
    console.error("[sw] update check failed:", error);
    return false;
  }
}

/**
 * force refresh: clear caches and reload
 * useful for getting latest version
 */
export async function forceRefresh(): Promise<void> {
  await clearServiceWorkerCaches();
  window.location.reload();
}

/**
 * unregister service worker and clear all caches
 */
export async function unregisterServiceWorker(): Promise<void> {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (registration) {
      await registration.unregister();
      debug("serviceWorker", "unregistered");
    }
  } catch (error) {
    console.error("[sw] unregister failed:", error);
  }
}

/**
 * clear all service worker caches
 */
export async function clearServiceWorkerCaches(): Promise<void> {
  try {
    const cacheNames = await caches.keys();
    const swCaches = cacheNames.filter((name) => name.startsWith("freqhole-"));
    await Promise.all(swCaches.map((name) => caches.delete(name)));
    debug("serviceWorker", `cleared ${swCaches.length} caches`);
  } catch (error) {
    console.error("[sw] clear caches failed:", error);
  }
}

// export reactive state
export { updateAvailable, swVersion, swRegistration };
