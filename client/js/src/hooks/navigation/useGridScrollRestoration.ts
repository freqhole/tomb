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

  return {
    // For InfiniteGrid
    initialScrollTop: scrollRestoration.initialScrollTop,
    setScrollElement: scrollRestoration.setScrollElement,

    // For search restoration
    initialPagesLoaded: scrollRestoration.initialPagesLoaded,
    hasSavedState: scrollRestoration.hasSavedState,
    saveViewState: scrollRestoration.saveViewState,

    // Manual save
    saveNow: () => {
      // This will need pages context from caller
    },
  };
}
