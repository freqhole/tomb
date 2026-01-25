// scroll restoration using browser history state
import { onCleanup, onMount } from "solid-js";

interface ScrollState {
  [viewKey: string]: number;
}

/**
 * hook to save/restore scroll position using browser history state
 * 
 * usage:
 * ```tsx
 * const { restoreScroll, saveScroll } = useScrollRestore('albums');
 * 
 * onMount(() => {
 *   if (scrollContainer) {
 *     restoreScroll(scrollContainer);
 *   }
 * });
 * ```
 */
export function useScrollRestore(viewKey: string) {
  let scrollContainer: HTMLElement | null = null;
  let savedOffset = 0;

  // get current scroll state from history
  const getScrollState = (): ScrollState => {
    return (window.history.state?.scrollPositions || {}) as ScrollState;
  };

  // update scroll state in history
  const updateScrollState = (offset: number) => {
    const currentState = window.history.state || {};
    const scrollPositions = getScrollState();
    scrollPositions[viewKey] = offset;

    window.history.replaceState(
      {
        ...currentState,
        scrollPositions,
      },
      "",
    );
  };

  // save scroll position to history state
  const saveScroll = (container: HTMLElement | null) => {
    if (container) {
      scrollContainer = container;
      savedOffset = container.scrollTop;
      updateScrollState(savedOffset);
    }
  };

  // restore scroll position from history state
  const restoreScroll = (container: HTMLElement | null) => {
    if (!container) return;

    scrollContainer = container;
    const scrollPositions = getScrollState();
    const savedPosition = scrollPositions[viewKey];

    if (savedPosition !== undefined && savedPosition > 0) {
      // use queueMicrotask to ensure DOM is ready
      queueMicrotask(() => {
        if (container) {
          container.scrollTop = savedPosition;
        }
      });
    }
  };

  // save scroll position before page unload
  onMount(() => {
    const handleBeforeUnload = () => {
      if (scrollContainer) {
        saveScroll(scrollContainer);
      }
    };

    // save on popstate (browser back/forward)
    const handlePopState = () => {
      if (scrollContainer) {
        restoreScroll(scrollContainer);
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("popstate", handlePopState);

    onCleanup(() => {
      // save scroll position when component unmounts
      if (scrollContainer) {
        saveScroll(scrollContainer);
      }

      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("popstate", handlePopState);
    });
  });

  return {
    saveScroll,
    restoreScroll,
  };
}
