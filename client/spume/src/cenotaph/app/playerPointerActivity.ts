import { createEffect, createSignal, on, onCleanup, onMount } from "solid-js";
import { isCharnelMode } from "../../app/services/charnel/mode";
import { getTargetOs, setNativeCursorVisible } from "../../app/services/charnel/commands";

const CONTROLS_IDLE_MS = 3000;
const CURSOR_IDLE_MS = 5000;

// only linux charnel needs the native hide (see setNativeCursorVisible);
// macOS/windows webviews already honor the CSS cursor without motion.
let nativeCursorOs: Promise<boolean> | undefined;
function nativeCursorSupported(): Promise<boolean> {
  if (!isCharnelMode()) return Promise.resolve(false);
  nativeCursorOs ??= getTargetOs().then((os) => os === "linux");
  return nativeCursorOs;
}

/**
 * tracks pointer idleness for full-screen player surfaces: controls fade
 * after 3s, the cursor hides after 5s, and any pointer move/press shows both
 * again. `enabled` (default always) lets a surface that is only sometimes
 * full-screen (the expanded mini video player) opt in while it is.
 */
export function usePlayerPointerActivity(enabled: () => boolean = () => true) {
  const [pointerActive, setPointerActive] = createSignal(true);
  const [cursorHidden, setCursorHidden] = createSignal(false);
  let controlsTimer: ReturnType<typeof setTimeout> | undefined;
  let cursorTimer: ReturnType<typeof setTimeout> | undefined;
  let nativeHidden = false;

  const markPointerActive = () => {
    setPointerActive(true);
    setCursorHidden(false);
    clearTimeout(controlsTimer);
    clearTimeout(cursorTimer);
    if (!enabled()) return;
    controlsTimer = setTimeout(() => setPointerActive(false), CONTROLS_IDLE_MS);
    cursorTimer = setTimeout(() => setCursorHidden(true), CURSOR_IDLE_MS);
  };

  const syncNativeCursor = (hidden: boolean) => {
    if (hidden === nativeHidden) return;
    nativeHidden = hidden;
    void nativeCursorSupported().then((supported) => {
      // a later change may have superseded this one while the os lookup ran.
      if (supported && nativeHidden === hidden) void setNativeCursorVisible(!hidden);
    });
  };

  createEffect(on(enabled, markPointerActive, { defer: true }));
  createEffect(() => syncNativeCursor(cursorHidden()));

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
    syncNativeCursor(false);
  });

  return { pointerActive, cursorHidden };
}
