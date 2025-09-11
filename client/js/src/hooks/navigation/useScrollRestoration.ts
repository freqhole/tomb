import { createSignal, createEffect, onMount, onCleanup } from "solid-js";
import { useLocation, useBeforeLeave } from "@solidjs/router";

interface ScrollState {
  top: number;
  left: number;
  timestamp: number;
}

interface UseScrollRestorationOptions {
  key?: string;
  enabled?: boolean;
}

// In-memory storage for scroll positions (persists across router navigation)
const scrollStorage = new Map<string, ScrollState>();

// Clean up old entries periodically
const STORAGE_TTL = 30 * 60 * 1000; // 30 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, state] of scrollStorage.entries()) {
    if (now - state.timestamp > STORAGE_TTL) {
      scrollStorage.delete(key);
    }
  }
}, 60000); // Check every minute

export function useScrollRestoration(
  options: UseScrollRestorationOptions = {}
) {
  const { key = "default", enabled = true } = options;
  const location = useLocation();

  const [isReady, setIsReady] = createSignal(false);
  const [currentScrollElement, setCurrentScrollElement] =
    createSignal<HTMLElement | null>(null);

  // Get storage key for current route - normalize / and /songs to be the same
  const getStorageKey = () => {
    const route = location.pathname + location.search;
    const normalizedRoute = route === "/" ? "/songs" : route;
    return `${key}_${normalizedRoute}`;
  };

  // Save current scroll position to in-memory storage
  const saveScrollPosition = (element?: HTMLElement) => {
    if (!enabled) return;

    const scrollElement =
      element ||
      currentScrollElement() ||
      document.documentElement ||
      document.body;

    const scrollState: ScrollState = {
      top: scrollElement.scrollTop,
      left: scrollElement.scrollLeft,
      timestamp: Date.now(),
    };

    const storageKey = getStorageKey();
    scrollStorage.set(storageKey, scrollState);

    console.log(
      `SCROLL_DEBUG [${key}] Saved scroll position: ${scrollState.top}px to key: "${storageKey}"`
    );
  };

  // Restore scroll position from in-memory storage
  const restoreScrollPosition = (element?: HTMLElement): boolean => {
    if (!enabled) return false;

    const scrollElement =
      element ||
      currentScrollElement() ||
      document.documentElement ||
      document.body;

    const storageKey = getStorageKey();
    const scrollState = scrollStorage.get(storageKey);

    console.log(
      `SCROLL_DEBUG [${key}] Attempting restore from key: "${storageKey}"`
    );
    console.log(`SCROLL_DEBUG [${key}] Found scroll state:`, scrollState);

    if (scrollState) {
      // Check if state is not too old
      const now = Date.now();
      if (now - scrollState.timestamp < STORAGE_TTL) {
        scrollElement.scrollTo({
          top: scrollState.top,
          left: scrollState.left,
          behavior: "auto",
        });
        console.log(
          `SCROLL_DEBUG [${key}] Restored to position: ${scrollState.top}px`
        );
        return true;
      } else {
        // Remove expired state
        scrollStorage.delete(storageKey);
        console.log(`SCROLL_DEBUG [${key}] Removed expired scroll state`);
      }
    }

    console.log(`SCROLL_DEBUG [${key}] No valid scroll state found`);
    return false;
  };

  // Use router's beforeLeave hook to save scroll position before navigation
  useBeforeLeave(() => {
    console.log(
      `SCROLL_DEBUG [${key}] Router beforeLeave - saving scroll position`
    );
    saveScrollPosition();
    return true; // Allow navigation to continue
  });

  // Track route changes and handle scroll restoration
  createEffect(() => {
    const route = location.pathname + location.search;
    console.log(`SCROLL_DEBUG [${key}] Route changed to:`, route);

    // Mark ready for scroll restoration after route change
    setIsReady(false);
    // Small delay to ensure DOM is updated
    setTimeout(() => setIsReady(true), 50);
  });

  // Auto-restore on route ready
  createEffect(() => {
    if (isReady() && enabled) {
      console.log(`SCROLL_DEBUG [${key}] Route ready, attempting restore`);
      // Restore scroll position
      restoreScrollPosition();
    }
  });

  // Handle page refresh/close
  onMount(() => {
    if (!enabled) return;

    const handleBeforeUnload = () => {
      console.log(`SCROLL_DEBUG [${key}] Page unloading, saving position`);
      saveScrollPosition();
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    setIsReady(true);

    onCleanup(() => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    });
  });

  return {
    isReady,
    saveScrollPosition,
    restoreScrollPosition,
    setScrollElement: setCurrentScrollElement,
  };
}
