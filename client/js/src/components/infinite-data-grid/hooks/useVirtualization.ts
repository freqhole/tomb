import { createMemo } from "solid-js";

export interface VirtualizationConfig {
  containerHeight: number;
  rowHeight: number;
  totalItems: number;
  bufferSize?: number;
  scrollTop: number;
}

export function useVirtualization(config: VirtualizationConfig) {
  // simple virtual window calculation
  const startIndex = createMemo(() => {
    if (config.containerHeight <= 0) return 0;
    return Math.max(
      0,
      Math.floor(config.scrollTop / config.rowHeight) - (config.bufferSize || 5)
    );
  });

  const endIndex = createMemo(() => {
    if (config.containerHeight <= 0) {
      return Math.min(config.totalItems, 20); // show first 20 items on initial load
    }

    const visibleCount = Math.ceil(config.containerHeight / config.rowHeight);
    return Math.min(
      config.totalItems,
      startIndex() + visibleCount + (config.bufferSize || 5) * 2
    );
  });

  const visibleRange = createMemo(() => ({
    start: startIndex(),
    end: endIndex(),
  }));

  const totalContentHeight = createMemo(() => {
    const height = config.totalItems * config.rowHeight;
    return height;
  });

  const visibleItems = createMemo(() => {
    const range = visibleRange();
    const items: Array<{ data: any; index: number }> = [];

    for (let i = range.start; i < range.end; i++) {
      if (i >= 0 && i < config.totalItems) {
        items.push({
          data: null, // will be populated by parent component
          index: i,
        });
      }
    }

    return items;
  });

  return {
    visibleRange,
    totalContentHeight,
    startIndex,
    endIndex,
    visibleItems,
  };
}
