// shared "is edge-swipe navigation turned on" check - used by both
// useEdgeSwipeNavigation.ts (the gesture recognizer) and
// EdgeSwipeShiftLayer.tsx (its visual companion), so the two always
// agree on when the feature is active without duplicating the
// platform-gating logic in two places.
import { appState } from "./storage/db";
import { isCharnelMode, isAndroidTauri, isIosTauri } from "./charnel";
import { getDesktopEdgeSwipeNavigationEnabled } from "./desktopEdgeSwipeNavigation";

/** desktop charnel has no reachable spume "local library"/"storage"
 *  settings page as its primary settings surface, so this one platform
 *  controls the setting from the wizard app instead (charnel-config.toml,
 *  see desktopEdgeSwipeNavigation.ts) - everyone else (web, android, ios)
 *  uses spume's own `AppState.edge_swipe_navigation_enabled`. */
export function edgeSwipeNavigationEnabled(): boolean {
  if (isCharnelMode() && !isAndroidTauri() && !isIosTauri()) {
    return getDesktopEdgeSwipeNavigationEnabled();
  }
  return appState()?.edge_swipe_navigation_enabled ?? false;
}
