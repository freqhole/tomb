/* @jsxImportSource solid-js */
import { createSignal, createEffect, onMount, onCleanup } from "solid-js";

export function useUIState() {
  // Mobile detection
  const [isMobile, setIsMobile] = createSignal(false);

  // Sidebar state
  const [sidebarCollapsed, setSidebarCollapsed] = createSignal(
    (window as any).STANDALONE_MODE || false
  );

  // Drag and drop state
  const [isDragOver, setIsDragOver] = createSignal(false);

  // Background image state
  const [backgroundImageUrl, setBackgroundImageUrl] = createSignal<string | null>(null);

  // Image URL cache
  const [imageUrlCache] = createSignal(new Map<string, string>());

  // Mobile detection logic
  const checkMobile = () => {
    const mobile = window.innerWidth < 900;
    setIsMobile(mobile);
    if (mobile && sidebarCollapsed()) {
      setSidebarCollapsed(true);
    }
  };

  // Handle window resize for mobile detection
  const handleResize = () => {
    checkMobile();
  };

  // Handle escape key for closing modals/dialogs
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      // This can be extended by components using this hook
      return { key: e.key, preventDefault: () => e.preventDefault() };
    }
  };

  // Initialize mobile detection
  onMount(() => {
    checkMobile();
    window.addEventListener("resize", handleResize);
    document.addEventListener("keydown", handleKeyDown);

    onCleanup(() => {
      window.removeEventListener("resize", handleResize);
      document.removeEventListener("keydown", handleKeyDown);
    });
  });

  // Cleanup image URLs when component unmounts
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
    // State
    isMobile,
    sidebarCollapsed,
    isDragOver,
    backgroundImageUrl,
    imageUrlCache,

    // Setters
    setIsMobile,
    setSidebarCollapsed,
    setIsDragOver,
    setBackgroundImageUrl,

    // Utilities
    checkMobile,
  };
}
