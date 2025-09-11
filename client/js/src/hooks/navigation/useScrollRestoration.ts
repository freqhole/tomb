import { createSignal, createEffect, onCleanup } from "solid-js";
import { useLocation, useBeforeLeave } from "@solidjs/router";

interface ScrollState {
  top: number;
  left: number;
}

interface UseScrollRestorationOptions {
  key?: string;
  enabled?: boolean;
}

export function useScrollRestoration(
  options: UseScrollRestorationOptions = {}
) {
  const { key = "default", enabled = true } = options;
  const location = useLocation();

  const [scrollElement, setScrollElement] = createSignal<HTMLElement | null>(
    null
  );
  const [isReady, setIsReady] = createSignal(false);

  // Get storage key for current route
  const getStorageKey = () => {
    const route = location.pathname + location.search;
    const normalizedRoute = route === "/" ? "/songs" : route;
    return `scroll_${key}_${normalizedRoute}`;
  };

  // Save scroll position to sessionStorage
  const saveScrollPosition = () => {
    if (!enabled) return;

    const element = scrollElement();
    if (!element) return;

    // Don't save if element is hidden (handles desktop/mobile view conflicts)
    if (element.offsetParent === null) {
      return;
    }

    const scrollState: ScrollState = {
      top: element.scrollTop,
      left: element.scrollLeft,
    };

    const storageKey = getStorageKey();
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(scrollState));
    } catch (e) {
      console.warn("Failed to save scroll state:", e);
    }
  };

  // Restore scroll position from sessionStorage
  const restoreScrollPosition = () => {
    if (!enabled) return false;

    const element = scrollElement();
    if (!element) return false;

    // Don't restore if element is hidden (handles desktop/mobile view conflicts)
    if (element.offsetParent === null) {
      return false;
    }

    const storageKey = getStorageKey();
    try {
      const stored = sessionStorage.getItem(storageKey);
      if (stored) {
        const scrollState: ScrollState = JSON.parse(stored);
        element.scrollTo({
          top: scrollState.top,
          left: scrollState.left,
          behavior: "auto",
        });
        return true;
      }
    } catch (e) {
      console.warn("Failed to restore scroll state:", e);
    }

    return false;
  };

  // Save before navigation
  useBeforeLeave(() => {
    saveScrollPosition();
    return true;
  });

  // Handle route changes
  createEffect(() => {
    const route = location.pathname + location.search;
    setIsReady(false);
    // Give DOM a moment to update
    setTimeout(() => setIsReady(true), 10);
  });

  // Restore when ready
  createEffect(() => {
    if (isReady() && scrollElement()) {
      restoreScrollPosition();
    }
  });

  // Save on page unload
  createEffect(() => {
    const handleBeforeUnload = () => saveScrollPosition();
    window.addEventListener("beforeunload", handleBeforeUnload);
    onCleanup(() => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    });
  });

  return {
    setScrollElement,
    saveScrollPosition,
    restoreScrollPosition,
    isReady,
  };
}
