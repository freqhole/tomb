// shared browser back/forward navigation-availability tracking - used by
// both TopNav.tsx (its own back/forward buttons) and
// useEdgeSwipeNavigation.ts (so the edge-swipe reveal icon only turns
// "this will navigate" magenta when there's actually somewhere to go).
// extracted from TopNav.tsx's own prior inline implementation so the
// underlying history.pushState/replaceState monkey-patching + popstate
// listening happens exactly once, globally, for the app's whole
// lifetime - rather than being independently re-implemented per
// consumer, which would mean two unrelated layers each wrapping the
// same global functions (fragile: correct only if each wrap carefully
// chains to whichever "original" it captured, and harder to reason
// about the more of these pile up).
//
// a nice side effect of making this a permanent, module-lifetime
// singleton (versus TopNav's own `onMount`/`onCleanup`-scoped version):
// TopNav itself isn't mounted on every route (settings/the cenotaph
// player route use different top-level layouts without it) - the old
// per-component version would reset its own position/depth tracking
// back to 0 every time TopNav happened to unmount and remount across
// such navigations, even though the browser's real history kept
// accumulating underneath. tracking this once, independent of any one
// component's mount lifetime, fixes that for free.
//
// prefers the modern Navigation API (chromium) for accurate state.
// otherwise falls back to stamping history.state + intercepting
// pushState/replaceState (works in safari/firefox) - only counts
// navigations observed within this tab since the app loaded; browser
// history entries from before the app loaded aren't countable (no site
// can inspect prior entries), so "back" reads false until the user has
// actually navigated within the app at least once.
import { createSignal } from "solid-js";

const [canGoBack, setCanGoBack] = createSignal(false);
const [canGoForward, setCanGoForward] = createSignal(false);

export { canGoBack, canGoForward };

const nav = (
  window as unknown as {
    navigation?: EventTarget & { canGoBack?: boolean; canGoForward?: boolean };
  }
).navigation;

if (nav) {
  const updateNavState = () => {
    setCanGoBack(nav.canGoBack ?? false);
    setCanGoForward(nav.canGoForward ?? false);
  };
  updateNavState();
  nav.addEventListener("currententrychange", updateNavState);
} else {
  type StampedState = { __historyNavIdx?: number } & Record<string, unknown>;
  let position = 0;
  let depth = 1;

  const origPush = window.history.pushState.bind(window.history);
  const origReplace = window.history.replaceState.bind(window.history);

  const readIdx = (): number | undefined => {
    const s = window.history.state as StampedState | null;
    return typeof s?.__historyNavIdx === "number" ? s.__historyNavIdx : undefined;
  };

  const update = () => {
    setCanGoBack(position > 0);
    setCanGoForward(position < depth - 1);
  };

  // adopt or stamp the current entry
  const existing = readIdx();
  if (existing !== undefined) {
    position = existing;
    if (depth <= position) depth = position + 1;
  } else {
    const s = (window.history.state as StampedState | null) ?? {};
    origReplace({ ...s, __historyNavIdx: position }, "");
  }
  update();

  // wrap pushState: new entry truncates forward stack
  window.history.pushState = function (state, title, url) {
    position += 1;
    depth = position + 1;
    const merged: StampedState = {
      ...((state as StampedState | null) ?? {}),
      __historyNavIdx: position,
    };
    origPush(merged, title, url);
    update();
  };

  // wrap replaceState: keep the same position, preserve our stamp
  window.history.replaceState = function (state, title, url) {
    const merged: StampedState = {
      ...((state as StampedState | null) ?? {}),
      __historyNavIdx: position,
    };
    origReplace(merged, title, url);
    update();
  };

  window.addEventListener("popstate", () => {
    const idx = readIdx();
    if (typeof idx === "number") {
      position = idx;
      if (position >= depth) depth = position + 1;
    }
    update();
  });
}
