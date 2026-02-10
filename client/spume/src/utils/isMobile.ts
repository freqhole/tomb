// detect if device is mobile based on screen width and touch support
export function isMobile(): boolean {
  return window.innerWidth <= 768 || "ontouchstart" in window;
}

// reactive signal version for solid-js
import { createSignal, onCleanup, onMount } from "solid-js";

export function createIsMobile() {
  const [mobile, setMobile] = createSignal(isMobile());

  onMount(() => {
    const handleResize = () => {
      setMobile(isMobile());
    };

    window.addEventListener("resize", handleResize);

    onCleanup(() => {
      window.removeEventListener("resize", handleResize);
    });
  });

  return mobile;
}
