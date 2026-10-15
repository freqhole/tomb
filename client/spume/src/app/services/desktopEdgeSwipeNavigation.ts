// edge_swipe_navigation_enabled (charnel config, desktop-only) - lets a
// desktop-charnel user turn on edge-started drag/swipe navigation (see
// useEdgeSwipeNavigation.ts), mirroring spume's own
// `AppState.edge_swipe_navigation_enabled` (web/android/ios, set via
// LocalLibrarySettingsView/StorageSettingsView). desktop doesn't surface
// those spume settings pages as the primary way to reach settings, so the
// wizard's own settings view controls this one instead - see
// `FreqholeAppConfig.edge_swipe_navigation_enabled`'s doc comment. mirrors
// desktopBackgroundImages.ts's plain signal pattern.
import { createSignal } from "solid-js";

const [desktopEdgeSwipeNavigationEnabled, setDesktopEdgeSwipeNavigationEnabledSignal] =
  createSignal(false);

export function setDesktopEdgeSwipeNavigationEnabled(enabled: boolean) {
  setDesktopEdgeSwipeNavigationEnabledSignal(enabled);
}

export function getDesktopEdgeSwipeNavigationEnabled(): boolean {
  return desktopEdgeSwipeNavigationEnabled();
}
