import { createSignal, createEffect, onCleanup } from "solid-js";

export function useGridLayout() {
  const [containerRef, setContainerRef] = createSignal<HTMLDivElement>();
  const [scrollTop, setScrollTop] = createSignal(0);
  const [containerHeight, setContainerHeight] = createSignal(0);

  // use ResizeObserver for dynamic height tracking with fallback
  createEffect(() => {
    const container = containerRef();
    if (!container) return;

    // First, try to get height immediately
    const updateHeight = () => {
      const rect = container.getBoundingClientRect();
      if (rect.height > 0) {
        setContainerHeight(rect.height);
      }
    };

    // Initial height check
    updateHeight();

    // Set up ResizeObserver for dynamic changes
    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setContainerHeight(entry.contentRect.height);
      }
    });

    resizeObserver.observe(container);

    // Fallback: check height on next frame if still 0
    const rafId = requestAnimationFrame(() => {
      if (containerHeight() === 0) {
        updateHeight();
      }
    });

    onCleanup(() => {
      resizeObserver.disconnect();
      cancelAnimationFrame(rafId);
    });
  });

  const handleScroll = (e: Event) => {
    const target = e.target as HTMLDivElement;
    setScrollTop(target.scrollTop);
  };

  return {
    containerRef: setContainerRef,
    scrollTop,
    containerHeight,
    handleScroll,
  };
}
