import { createSignal, createEffect, onCleanup } from "solid-js";
import { useScrollRestoration } from "./useScrollRestoration";

interface UseGridScrollRestorationOptions {
  gridId?: string;
  enabled?: boolean;
}

export function useGridScrollRestoration(
  options: UseGridScrollRestorationOptions = {}
) {
  const { gridId = "grid", enabled = true } = options;

  const [scrollElement, setScrollElement] = createSignal<HTMLElement | null>(
    null
  );
  const [hasRestored, setHasRestored] = createSignal(false);

  const scrollRestoration = useScrollRestoration({
    key: gridId,
    enabled,
  });

  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  // Debounced save function
  const debouncedSave = () => {
    if (!enabled) return;

    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const element = scrollElement();
      if (element && hasRestored()) {
        console.log(
          `SCROLL_DEBUG [${gridId}] Saving scroll position: ${element.scrollTop}px`
        );
        scrollRestoration.saveScrollPosition(element);
      } else {
        console.log(
          `SCROLL_DEBUG [${gridId}] Not saving - element: ${!!element}, hasRestored: ${hasRestored()}`
        );
      }
      saveTimer = null;
    }, 100);
  };

  // Set up scroll listener when element is available
  createEffect(() => {
    const element = scrollElement();
    if (!element || !enabled) return;

    console.log(
      `SCROLL_DEBUG [${gridId}] Setting up scroll listener on element:`,
      element
    );

    const handleScroll = () => {
      if (hasRestored()) {
        console.log(
          `SCROLL_DEBUG [${gridId}] Scroll event - position: ${element.scrollTop}px`
        );
        debouncedSave();
      } else {
        console.log(
          `SCROLL_DEBUG [${gridId}] Scroll event ignored - not restored yet`
        );
      }
    };

    element.addEventListener("scroll", handleScroll, { passive: true });

    onCleanup(() => {
      element.removeEventListener("scroll", handleScroll);
    });
  });

  // Auto-restore when ready
  createEffect(() => {
    if (!scrollRestoration.isReady() || !enabled) return;

    const element = scrollElement();
    if (element && !hasRestored()) {
      console.log(
        `SCROLL_DEBUG [${gridId}] Attempting to restore scroll position`
      );
      const restored = scrollRestoration.restoreScrollPosition(element);
      console.log(
        `SCROLL_DEBUG [${gridId}] Restore result: ${restored}, position now: ${element.scrollTop}px`
      );
      setHasRestored(true);

      if (!restored) {
        console.log(
          `SCROLL_DEBUG [${gridId}] No saved position, enabling saving`
        );
        return;
      }
    }
  });

  // Cleanup timer
  onCleanup(() => {
    if (saveTimer) {
      clearTimeout(saveTimer);
    }
  });

  return {
    setScrollElement: (el: HTMLElement | null) => {
      console.log(`SCROLL_DEBUG [${gridId}] Setting scroll element:`, el);
      setScrollElement(el);
    },
    getScrollElement: () => scrollElement(),
    saveNow: () => {
      const element = scrollElement();
      if (element && enabled) {
        console.log(
          `SCROLL_DEBUG [${gridId}] Manual save - position: ${element.scrollTop}px`
        );
        scrollRestoration.saveScrollPosition(element);
      }
    },
    hasRestored,
  };
}
