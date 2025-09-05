import { createEffect } from "solid-js";

export function useInfiniteLoading(props: {
  scrollTop: () => number;
  containerHeight: () => number;
  totalContentHeight: () => number;
  onScrollNearBottom?: () => void;
  threshold?: number;
}) {
  const threshold = props.threshold || 1000; // pixels from bottom - trigger much earlier

  createEffect(() => {
    const scrollTop = props.scrollTop();
    const containerHeight = props.containerHeight();
    const totalHeight = props.totalContentHeight();

    console.log("infinite loading hook running:", {
      scrollTop,
      containerHeight,
      totalHeight,
      threshold,
    });

    // only check if we have valid dimensions
    if (containerHeight <= 0 || totalHeight <= 0) {
      console.log("invalid dimensions, skipping");
      return;
    }

    const scrollBottom = scrollTop + containerHeight;
    const distanceFromBottom = totalHeight - scrollBottom;

    console.log("distance check:", {
      scrollBottom,
      distanceFromBottom,
      nearBottom: distanceFromBottom <= threshold,
    });

    if (distanceFromBottom <= threshold && props.onScrollNearBottom) {
      console.log("TRIGGERING INFINITE LOAD!");
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
