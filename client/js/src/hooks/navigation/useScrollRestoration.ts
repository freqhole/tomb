import { createSignal, createEffect, onCleanup } from "solid-js";
import { useLocation, useBeforeLeave } from "@solidjs/router";

interface ViewState {
  scrollTop: number;
  pagesLoaded: number;
  timestamp: number;
}

interface UseScrollRestorationOptions {
  key?: string;
  enabled?: boolean;
}

const STORAGE_PREFIX = "view_";
const STORAGE_TTL = 30 * 60 * 1000; // 30 minutes

export function useScrollRestoration(
  options: UseScrollRestorationOptions = {}
) {
  const { key = "default", enabled = true } = options;
  const location = useLocation();

  const [scrollElement, setScrollElement] = createSignal<HTMLElement | null>(
    null
  );
  const [restoredState, setRestoredState] = createSignal<ViewState | null>(
    null
  );

  // Get storage key for current route
  const getStorageKey = () => {
    const route = location.pathname + location.search;
    const normalizedRoute = route === "/" ? "/songs" : route;
    return `${STORAGE_PREFIX}${key}_${normalizedRoute}`;
  };

  // Save current view state
  const saveViewState = (pagesLoaded: number) => {
    if (!enabled) return;

    const element = scrollElement();
    if (!element || element.offsetParent === null) return;

    const state: ViewState = {
      scrollTop: element.scrollTop,
      pagesLoaded,
      timestamp: Date.now(),
    };

    try {
      sessionStorage.setItem(getStorageKey(), JSON.stringify(state));
      console.log(
        `[SCROLL RESTORE] Saved: scrollTop=${state.scrollTop}, pages=${state.pagesLoaded} to key="${getStorageKey()}"`
      );
    } catch (e) {
      console.warn("Failed to save view state:", e);
    }
  };

  // Load saved view state
  const loadViewState = (): ViewState | null => {
    if (!enabled) return null;

    try {
      const stored = sessionStorage.getItem(getStorageKey());
      if (stored) {
        const state: ViewState = JSON.parse(stored);
        const now = Date.now();
        if (now - state.timestamp < STORAGE_TTL) {
          console.log(
            `[SCROLL RESTORE] Loaded: scrollTop=${state.scrollTop}, pages=${state.pagesLoaded} from key="${getStorageKey()}"`
          );
          return state;
        } else {
          console.log(`[SCROLL RESTORE] Expired state removed`);
          sessionStorage.removeItem(getStorageKey());
        }
      } else {
        console.log(`[SCROLL RESTORE] No saved state found in storage`);
      }
    } catch (e) {
      console.warn("Failed to load view state:", e);
    }
    return null;
  };

  // Save before navigation
  useBeforeLeave(() => {
    // Can't save here without context - rely on manual saves
    return true;
  });

  // Load state on route change
  createEffect(() => {
    location.pathname + location.search; // Track route changes
    const state = loadViewState();
    setRestoredState(state);
  });

  // Auto-save scroll changes with debouncing
  createEffect(() => {
    const element = scrollElement();
    if (!element || !enabled) return;

    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    const handleScroll = () => {
      // We need pages context to save - this will be provided by caller
    };

    element.addEventListener("scroll", handleScroll, { passive: true });

    onCleanup(() => {
      element.removeEventListener("scroll", handleScroll);
      if (saveTimer) clearTimeout(saveTimer);
    });
  });

  return {
    // Element management
    setScrollElement,

    // State management
    saveViewState,

    // Restoration values
    initialScrollTop: () => restoredState()?.scrollTop || 0,
    initialPagesLoaded: () => restoredState()?.pagesLoaded || 1,
    hasSavedState: () => restoredState() !== null,
  };
}
