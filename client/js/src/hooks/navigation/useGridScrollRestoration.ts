import { useScrollRestoration } from "./useScrollRestoration";

interface UseGridScrollRestorationOptions {
  gridId?: string;
  enabled?: boolean;
}

export function useGridScrollRestoration(
  options: UseGridScrollRestorationOptions = {}
) {
  const { gridId = "grid", enabled = true } = options;

  const scrollRestoration = useScrollRestoration({
    key: gridId,
    enabled,
  });

  // Auto-save scroll state when data changes
  const saveScrollState = (dataLength: number) => {
    const pagesLoaded = Math.ceil(dataLength / 50); // estimate 50 items per page
    scrollRestoration.saveScrollState(pagesLoaded);
  };

  // Auto-restore scroll position when data loads
  const restoreWhenReady = (dataLength: number) => {
    scrollRestoration.restoreScrollPosition(dataLength);
  };

  return {
    // For InfiniteGrid
    initialScrollTop: scrollRestoration.initialScrollTop,
    setScrollElement: scrollRestoration.setScrollElement,

    // Simple API for components
    saveScrollState,
    restoreWhenReady,
    hasSavedState: scrollRestoration.hasSavedState,
  };
}
