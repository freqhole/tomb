import { createSignal, createEffect, onCleanup } from "solid-js";

export function useGridLayout() {
  const [containerRef, setContainerRef] = createSignal<HTMLDivElement>();
  const [scrollTop, setScrollTop] = createSignal(0);
  const [containerHeight, setContainerHeight] = createSignal(0);

  // use ResizeObserver for dynamic height tracking
  createEffect(() => {
    const container = containerRef();
    if (!container) return;

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setContainerHeight(entry.contentRect.height);
      }
    });

    resizeObserver.observe(container);

    onCleanup(() => resizeObserver.disconnect());
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
