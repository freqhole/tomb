import { createSignal } from "solid-js";
import { useLocation, useBeforeLeave } from "@solidjs/router";

interface ScrollState {
  scrollTop: number;
  pagesLoaded: number;
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

  // Save current scroll state to history
  const saveScrollState = (pagesLoaded: number) => {
    if (!enabled) return;

    const element = scrollElement();
    if (!element) return;

    const scrollState: ScrollState = {
      scrollTop: element.scrollTop,
      pagesLoaded,
    };

    // Update current history entry with scroll state
    const currentState = history.state || {};
    const newState = {
      ...currentState,
      [`scroll_${key}`]: scrollState,
    };

    history.replaceState(newState, "", location.pathname + location.search);
  };

  // Get saved scroll state from history
  const getSavedScrollState = (): ScrollState | null => {
    if (!enabled) return null;

    const state = history.state;
    if (state && state[`scroll_${key}`]) {
      return state[`scroll_${key}`] as ScrollState;
    }
    return null;
  };

  // Save before navigation
  useBeforeLeave(() => {
    // saveScrollState will be called by the component with pages context
    return true;
  });

  // Restore scroll position after data loads
  const restoreScrollPosition = (currentDataLength: number) => {
    if (!enabled) return;

    const element = scrollElement();
    const savedState = getSavedScrollState();

    if (element && savedState && savedState.scrollTop > 0) {
      // Only restore if we have enough data loaded
      if (currentDataLength >= savedState.pagesLoaded * 50) {
        // estimate 50 items per page
        element.scrollTop = savedState.scrollTop;
      }
    }
  };

  return {
    // Element management
    setScrollElement,

    // State management
    saveScrollState,
    restoreScrollPosition,

    // Restoration values
    initialScrollTop: () => getSavedScrollState()?.scrollTop || 0,
    initialPagesLoaded: () => getSavedScrollState()?.pagesLoaded || 1,
    hasSavedState: () => getSavedScrollState() !== null,
  };
}
