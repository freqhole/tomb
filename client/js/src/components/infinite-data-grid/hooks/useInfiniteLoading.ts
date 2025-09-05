import { createEffect } from "solid-js";

export function useInfiniteLoading(props: {
  scrollTop: () => number;
  containerHeight: () => number;
  totalContentHeight: () => number;
  onScrollNearBottom?: () => void;
  threshold?: number;
}) {
  const threshold = props.threshold || 200; // pixels from bottom

  createEffect(() => {
    const scrollTop = props.scrollTop();
    const containerHeight = props.containerHeight();
    const totalHeight = props.totalContentHeight();

    // only check if we have valid dimensions
    if (containerHeight <= 0 || totalHeight <= 0) return;

    const scrollBottom = scrollTop + containerHeight;
    const distanceFromBottom = totalHeight - scrollBottom;

    if (distanceFromBottom <= threshold && props.onScrollNearBottom) {
      props.onScrollNearBottom();
    }
  });

  return {
    // helper to check if near bottom
    isNearBottom: () => {
      const scrollTop = props.scrollTop();
      const containerHeight = props.containerHeight();
      const totalHeight = props.totalContentHeight();

      if (containerHeight <= 0 || totalHeight <= 0) return false;

      const scrollBottom = scrollTop + containerHeight;
      const distanceFromBottom = totalHeight - scrollBottom;

      return distanceFromBottom <= threshold;
    },
  };
}
