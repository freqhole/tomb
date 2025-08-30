/* @jsxImportSource solid-js */
import { createSignal, onMount, onCleanup } from "solid-js";

export function useUIState() {
  const [isMobile, setIsMobile] = createSignal(false);

  const [sidebarCollapsed, setSidebarCollapsed] = createSignal(
    (window as any).STANDALONE_MODE || false
  );

  const [isDragOver, setIsDragOver] = createSignal(false);

  const [backgroundImageUrl, setBackgroundImageUrl] = createSignal<
    string | null
  >(null);

  const [imageUrlCache] = createSignal(new Map<string, string>());

  const checkMobile = () => {
    const mobile = window.innerWidth < 900;
    setIsMobile(mobile);
    if (mobile && sidebarCollapsed()) {
      setSidebarCollapsed(true);
    }
  };

  // window resize for mobile detection
  const handleResize = () => {
    checkMobile();
  };

  // escape key for closing modals/dialogs
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      // this can be extended by components using this hook
      return { key: e.key, preventDefault: () => e.preventDefault() };
    }
    return undefined;
  };

  // init + cleanup for mobile detection
  onMount(() => {
    checkMobile();
    window.addEventListener("resize", handleResize);
    document.addEventListener("keydown", handleKeyDown);

    onCleanup(() => {
      window.removeEventListener("resize", handleResize);
      document.removeEventListener("keydown", handleKeyDown);
    });
  });

  // trash image URLs when component unmounts
  onCleanup(() => {
    const cache = imageUrlCache();
    cache.forEach((url) => {
      if (url.startsWith("blob:")) {
        URL.revokeObjectURL(url);
      }
    });
    cache.clear();
  });

  return {
    isMobile,
    sidebarCollapsed,
    isDragOver,
    backgroundImageUrl,
    imageUrlCache,

    // setterz
    setIsMobile,
    setSidebarCollapsed,
    setIsDragOver,
    setBackgroundImageUrl,

    // utilz
    checkMobile,
  };
}
