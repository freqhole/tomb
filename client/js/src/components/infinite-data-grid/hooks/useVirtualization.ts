import { createMemo } from "solid-js";

export interface VirtualizationConfig {
  containerHeight: () => number;
  rowHeight: number;
  totalItems: () => number;
  bufferSize?: number;
  scrollTop: () => number;
}

export function useVirtualization(config: VirtualizationConfig) {
  // simple virtual window calculation
  const startIndex = createMemo(() => {
    if (config.containerHeight() <= 0) return 0;
    return Math.max(
      0,
      Math.floor(config.scrollTop() / config.rowHeight) -
        (config.bufferSize || 5)
    );
  });

  const endIndex = createMemo(() => {
    // For infinite loading to work properly, render all available items
    // Instead of virtualizing, show everything we have
    return config.totalItems();
  });

  const visibleRange = createMemo(() => ({
    start: startIndex(),
    end: endIndex(),
  }));

  const totalContentHeight = createMemo(() => {
    // Simple approach: create height for all available items
    // This ensures proper scrolling and infinite loading detection
    const height = config.totalItems() * config.rowHeight;
    return height;
  });

  const visibleItems = createMemo(() => {
    const range = visibleRange();
    const items: Array<{ data: any; index: number }> = [];

    for (let i = 0; i < config.totalItems(); i++) {
      items.push({
        data: null, // will be populated by parent component
        index: i,
      });
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
