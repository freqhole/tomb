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

  const scrollRestoration = useScrollRestoration({
    key: gridId,
    enabled,
  });

  // Set up scroll listener when element is available
  createEffect(() => {
    const element = scrollElement();
    if (!element || !enabled) return;

    // Debounced save function
    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    const handleScroll = () => {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        scrollRestoration.saveScrollPosition();
        saveTimer = null;
      }, 100);
    };

    element.addEventListener("scroll", handleScroll, { passive: true });

    onCleanup(() => {
      element.removeEventListener("scroll", handleScroll);
      if (saveTimer) clearTimeout(saveTimer);
    });
  });

  // Connect scroll element to core restoration
  createEffect(() => {
    const element = scrollElement();
    scrollRestoration.setScrollElement(element);
  });

  return {
    setScrollElement: (el: HTMLElement | null) => {
      setScrollElement(el);
    },
    saveNow: () => scrollRestoration.saveScrollPosition(),
  };
}
