// viewport utilities for handling safari's dynamic toolbar
//
// safari's toolbar expands/collapses during scroll, changing the visible viewport height.
// we track visualViewport.height reactively so lists can adjust their height in real-time.

import { createSignal, onCleanup, onMount } from "solid-js";
import { debug } from "./logger";
import { isNarrowViewport } from "../config/breakpoints";

// debug logging - set to true to diagnose viewport issues
const DEBUG_VIEWPORT = true;

function logViewport(event: string) {
  if (!DEBUG_VIEWPORT || typeof window === "undefined") return;

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
  const isStandalone = "standalone" in window.navigator && (window.navigator as any).standalone;

  debug("viewport", `${event}`, {
    visualViewport: window.visualViewport?.height,
    innerHeight: window.innerHeight,
    outerHeight: window.outerHeight,
    documentHeight: document.documentElement.clientHeight,
    isIOS,
    isSafari,
    isStandalone,
    userAgent: navigator.userAgent.substring(0, 80),
  });
}

// shared state - only one listener even if multiple components use this
let listenerCount = 0;
let cleanupFn: (() => void) | null = null;

const [viewportHeight, setViewportHeight] = createSignal(
  typeof window !== "undefined" ? (window.visualViewport?.height ?? window.innerHeight) : 800
);

function setupViewportListener() {
  if (typeof window === "undefined" || !window.visualViewport) return;

  const updateHeight = () => {
    const newHeight = window.visualViewport?.height ?? window.innerHeight;
    logViewport(`resize -> ${newHeight}px`);
    setViewportHeight(newHeight);
  };

  // initial value
  logViewport("setup");
  updateHeight();

  // listen for viewport changes (safari toolbar expand/collapse)
  window.visualViewport.addEventListener("resize", updateHeight);

  // also listen for window resize (orientation change, etc)
  window.addEventListener("resize", updateHeight);

  cleanupFn = () => {
    window.visualViewport?.removeEventListener("resize", updateHeight);
    window.removeEventListener("resize", updateHeight);
  };
}

function teardownViewportListener() {
  if (cleanupFn) {
    cleanupFn();
    cleanupFn = null;
  }
}

/**
 * get the current viewport height, reactive to safari toolbar changes.
 * call this in a component to get a signal that updates when the viewport resizes.
 */
export function useViewportHeight(): () => number {
  onMount(() => {
    listenerCount++;
    if (listenerCount === 1) {
      setupViewportListener();
    }
  });

  onCleanup(() => {
    listenerCount--;
    if (listenerCount === 0) {
      teardownViewportListener();
    }
  });

  return viewportHeight;
}

/**
 * get the viewport height once (non-reactive, for initial values).
 * useful for SSR fallback or one-time calculations.
 */
export function getViewportHeight(): number {
  if (typeof window === "undefined") return 800;
  return window.visualViewport?.height ?? window.innerHeight;
}

const NAV_HEIGHT = 42;

/**
 * get the nav height to subtract from viewport for content areas.
 * returns 0 on wide/desktop views where nav is part of the flex layout.
 * on narrow/mobile, reads the live `--nav-height` CSS var (kept in sync by
 * TopNav's ResizeObserver, and includes `--safe-area-top` via theme.css's
 * `calc(42px + var(--safe-area-top))`) instead of a bare constant - on
 * android, `--safe-area-top` is a real, nonzero status-bar inset (see
 * index.tsx), so a hardcoded 42 under-reserves scroll padding by exactly
 * that amount and lets list content render partly behind the nav bar.
 * falls back to the bare constant if the var isn't set yet (e.g. before
 * TopNav's first mount) or can't be parsed.
 */
export function getNavHeight(): number {
  if (typeof window === "undefined") return 0;
  if (!isNarrowViewport()) return 0;
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--nav-height").trim();
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : NAV_HEIGHT;
}
