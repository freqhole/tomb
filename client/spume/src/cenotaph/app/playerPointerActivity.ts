import { createSignal, onCleanup, onMount } from "solid-js";

export function usePlayerPointerActivity() {
  const [pointerActive, setPointerActive] = createSignal(true);
  const [cursorHidden, setCursorHidden] = createSignal(false);
  let controlsTimer: ReturnType<typeof setTimeout> | undefined;
  let cursorTimer: ReturnType<typeof setTimeout> | undefined;

  const markPointerActive = () => {
    setPointerActive(true);
    setCursorHidden(false);
    clearTimeout(controlsTimer);
    clearTimeout(cursorTimer);
    controlsTimer = setTimeout(() => setPointerActive(false), 3000);
    cursorTimer = setTimeout(() => setCursorHidden(true), 5000);
  };

  onMount(() => {
    markPointerActive();
    window.addEventListener("pointermove", markPointerActive);
    window.addEventListener("pointerdown", markPointerActive);
  });
  onCleanup(() => {
    clearTimeout(controlsTimer);
    clearTimeout(cursorTimer);
    window.removeEventListener("pointermove", markPointerActive);
    window.removeEventListener("pointerdown", markPointerActive);
  });

  return { pointerActive, cursorHidden };
}
