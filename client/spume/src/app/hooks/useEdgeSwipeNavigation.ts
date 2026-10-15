// hand-rolled edge-swipe navigation: an edge-started horizontal
// drag/swipe (pointer or touch) navigates browser history back/forward,
// the same gesture many mobile browsers/apps use for back navigation.
// mounted once at the app root (see App.tsx) - listens globally rather
// than being scoped to any one view.
//
// design notes (kept intentionally simple - this is NOT a general-purpose
// gesture library):
// - a session can only *start* from a narrow zone along the left/right
//   viewport edge (EDGE_PX), so it doesn't compete with ordinary content
//   interaction (drag-reorder, carousels, scrolling) anywhere else on the
//   page.
// - movement is tracked but nothing is "armed" (treated as an
//   intentional horizontal swipe rather than a tap or a vertical scroll)
//   until it clears MOVE_THRESHOLD_PX and is more horizontal than
//   vertical. a vertical-leaning drag is abandoned immediately, leaving
//   ordinary scrolling completely untouched.
// - once armed, `preventDefault()` on subsequent moves stops the page
//   from also starting a scroll/text-selection underneath the gesture.
// - commit on release requires either enough distance (COMMIT_DISTANCE_PX)
//   or a fast-enough flick (COMMIT_VELOCITY_PX_MS), with velocity measured
//   over a short trailing window rather than the whole gesture's average
//   (a slow start followed by a fast flick should still count).
// - `window.history.back()`/`forward()` are harmless no-ops when there's
//   nothing to navigate to, so there's no need to track canGoBack/
//   canGoForward state just for this.
import { createEffect, onCleanup } from "solid-js";
import { appState } from "../services/storage/db";
import { isCharnelMode, isAndroidTauri, isIosTauri } from "../services/charnel";
import { getDesktopEdgeSwipeNavigationEnabled } from "../services/desktopEdgeSwipeNavigation";
import { isAnyModalOpen } from "../../music/hooks/modals";

/** desktop charnel has no reachable spume "local library"/"storage"
 *  settings page as its primary settings surface, so this one platform
 *  controls the setting from the wizard app instead (charnel-config.toml,
 *  see desktopEdgeSwipeNavigation.ts) - everyone else (web, android, ios)
 *  uses spume's own `AppState.edge_swipe_navigation_enabled`. */
function edgeSwipeNavigationEnabled(): boolean {
  if (isCharnelMode() && !isAndroidTauri() && !isIosTauri()) {
    return getDesktopEdgeSwipeNavigationEnabled();
  }
  return appState()?.edge_swipe_navigation_enabled ?? false;
}

const EDGE_PX = 40;
const MOVE_THRESHOLD_PX = 10;
const COMMIT_DISTANCE_PX = 80;
const COMMIT_VELOCITY_PX_MS = 0.5;
const VELOCITY_WINDOW_MS = 100;

interface SwipeSession {
  pointerId: number;
  startX: number;
  startY: number;
  direction: "back" | "forward";
  armed: boolean;
  samples: Array<[time: number, x: number]>;
}

export function useEdgeSwipeNavigation() {
  createEffect(() => {
    if (!edgeSwipeNavigationEnabled()) return;

    let session: SwipeSession | null = null;

    function endSession() {
      session = null;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      document.body.style.removeProperty("user-select");
    }

    function onPointerDown(e: PointerEvent) {
      if (session || !e.isPrimary || e.button > 0) return;
      if (isAnyModalOpen()) return;
      const fromLeft = e.clientX <= EDGE_PX;
      const fromRight = window.innerWidth - e.clientX <= EDGE_PX;
      if (!fromLeft && !fromRight) return;
      session = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        direction: fromLeft ? "back" : "forward",
        armed: false,
        samples: [[performance.now(), e.clientX]],
      };
      window.addEventListener("pointermove", onPointerMove, { passive: false });
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointercancel", onPointerCancel);
    }

    function onPointerMove(e: PointerEvent) {
      if (!session || e.pointerId !== session.pointerId) return;
      const dx = e.clientX - session.startX;
      const dy = e.clientY - session.startY;

      if (!session.armed) {
        if (Math.abs(dx) < MOVE_THRESHOLD_PX && Math.abs(dy) < MOVE_THRESHOLD_PX) return;
        // vertical-leaning drag, or dragging the wrong way for this edge -
        // abandon and let ordinary scrolling/whatever-else handle it.
        const draggingInward = session.direction === "back" ? dx > 0 : dx < 0;
        if (Math.abs(dy) > Math.abs(dx) || !draggingInward) {
          endSession();
          return;
        }
        session.armed = true;
        // prevent incidental text selection for the rest of the drag.
        document.body.style.userSelect = "none";
      }

      // rolling velocity window: keep only samples from the last
      // VELOCITY_WINDOW_MS so a fast flick at the end of a slow drag
      // still reads as fast.
      const now = performance.now();
      session.samples = session.samples.filter(([t]) => now - t <= VELOCITY_WINDOW_MS);
      session.samples.push([now, e.clientX]);

      e.preventDefault();
    }

    function onPointerUp(e: PointerEvent) {
      if (!session || e.pointerId !== session.pointerId) return;
      const { armed, startX, direction, samples } = session;
      if (armed) {
        const distance = Math.abs(e.clientX - startX);
        const [t0, x0] = samples[0];
        const dt = performance.now() - t0;
        const velocity = dt > 0 ? Math.abs(e.clientX - x0) / dt : 0;
        if (distance >= COMMIT_DISTANCE_PX || velocity >= COMMIT_VELOCITY_PX_MS) {
          if (direction === "back") window.history.back();
          else window.history.forward();
        }
      }
      endSession();
    }

    function onPointerCancel() {
      endSession();
    }

    document.addEventListener("pointerdown", onPointerDown);
    onCleanup(() => {
      document.removeEventListener("pointerdown", onPointerDown);
      endSession();
    });
  });
}
