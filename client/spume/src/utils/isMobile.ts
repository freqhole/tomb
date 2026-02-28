// detect if device is mobile based on screen width and touch support
export function isMobile(): boolean {
  return window.innerWidth <= 768 || "ontouchstart" in window;
}

// detect if device has touch capability (for hiding hover-dependent UI on touch devices)
export function isTouchDevice(): boolean {
  if (typeof window === "undefined") return false;
  return "ontouchstart" in window || navigator.maxTouchPoints > 0;
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
