// hand-rolled edge-swipe navigation: an edge-started horizontal
// drag/swipe (pointer or touch) navigates browser history back/forward,
// the same gesture many mobile browsers/apps use for back navigation.
// mounted once at the app root (see App.tsx) - listens globally rather
// than being scoped to any one view. EdgeSwipeIndicators.tsx is this
// hook's visual companion (the edge-icon reveal); this file is pure
// gesture recognition and knows nothing about rendering.
//
// design notes (kept intentionally simple - this is NOT a general-purpose
// gesture library):
// - a session can only *start* from a zone along the left/right viewport
//   edge (EDGE_PX), so it doesn't compete with ordinary content
//   interaction (drag-reorder, carousels, scrolling) anywhere else on the
//   page.
// - direction recognition uses hysteresis rather than a single one-shot
//   check: real swipes rarely travel in a perfectly straight line for
//   their first few pixels (a thumb/finger starting right at a screen
//   edge, especially, tends to arc a little before straightening out),
//   so judging "horizontal or vertical?" off the very first sample that
//   clears a small threshold made this gesture needlessly easy to lose
//   to normal page-scroll disambiguation. instead: once ARM_THRESHOLD_PX
//   of travel has happened, keep re-checking on every subsequent move
//   while ambiguous - armed the moment horizontal ever clearly leads,
//   rejected only once GIVE_UP_PX of travel has passed without that ever
//   being true (a real vertical scroll keeps growing in that direction,
//   so it reliably loses the race well before then).
// - once armed, `preventDefault()` on subsequent moves stops the page
//   from also starting a scroll/text-selection underneath the gesture.
// - commit on release requires either enough distance (COMMIT_DISTANCE_PX)
//   or a fast-enough flick (COMMIT_VELOCITY_PX_MS), with velocity measured
//   over a short trailing window rather than the whole gesture's average
//   (a slow start followed by a fast flick should still count).
// - that same commit check is also computed live, on every move (not
//   just at release) - the visual layer uses it to recolor the arrow
//   icon the instant letting go would actually navigate, rather than
//   only finding out after the fact. gated on the shared
//   historyNavState.ts's canGoBack()/canGoForward() too, so the icon
//   never promises a navigation that wouldn't actually happen -
//   `window.history.back()`/`forward()` are harmless no-ops when
//   there's nowhere to go, but the visual feedback shouldn't claim
//   otherwise.
// - this hook only ever drives the edge-icon reveal (EdgeSwipeIndicators.tsx)
//   - it does NOT move any page content. an earlier version also shifted
//   the actual page sideways via `transform` to "reveal" the icon, which
//   caused real regressions elsewhere in the app (position:fixed chrome
//   losing its containing block - see EdgeSwipeIndicators.tsx's own doc
//   comment for the full story) and was dropped.
import { createEffect, onCleanup } from "solid-js";
import { canGoBack, canGoForward } from "../services/historyNavState";
import { edgeSwipeNavigationEnabled } from "../services/edgeSwipeSettings";
import { resetEdgeSwipeVisual, updateEdgeSwipeProgress } from "../services/edgeSwipeVisual";
import { isAnyModalOpen } from "../../music/hooks/modals";

const EDGE_PX = 100;
// below this viewport width, two EDGE_PX-wide zones wouldn't fit without
// overlapping (meeting/crossing in the middle, leaving no safe area for
// ordinary taps/clicks at all) - skip engaging entirely rather than
// shrinking the zones, simplest correct behavior for a case that's not
// really reachable in practice anyway (a ~200px-wide window/viewport).
const MIN_VIEWPORT_WIDTH_PX = EDGE_PX * 2;
const ARM_THRESHOLD_PX = 6;
const GIVE_UP_PX = 32;
const COMMIT_DISTANCE_PX = 72;
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

/** same distance-or-velocity check used at release, computed live during
 *  the drag too (see the gesture hook's onPointerMove) - drives the
 *  indicator's color so it's clear *before* letting go whether doing so
 *  right now would actually navigate. `currentX`/`currentTime` are the
 *  caller's own live position/timestamp (not necessarily the last entry
 *  in `samples`, which only updates on pointermove - the caller passes
 *  its own current values explicitly so onPointerUp's exact release
 *  position is used instead of possibly-stale last-move data). */
function wouldCommit(
  distance: number,
  currentX: number,
  currentTime: number,
  samples: Array<[time: number, x: number]>
): boolean {
  if (distance >= COMMIT_DISTANCE_PX) return true;
  const [t0, x0] = samples[0];
  const dt = currentTime - t0;
  const velocity = dt > 0 ? Math.abs(currentX - x0) / dt : 0;
  return velocity >= COMMIT_VELOCITY_PX_MS;
}

export function useEdgeSwipeNavigation() {
  createEffect(() => {
    const enabled = edgeSwipeNavigationEnabled();
    // see theme.css's own doc comment on this class - scopes the
    // touch-action/overscroll-behavior CSS that keeps the browser's own
    // built-in edge-swipe gesture from racing ours to exactly when this
    // feature is actually turned on (default off).
    document.body.classList.toggle("edge-swipe-nav-enabled", enabled);
    if (!enabled) return;

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
      // two EDGE_PX-wide zones wouldn't fit without overlapping on a
      // viewport this narrow - see MIN_VIEWPORT_WIDTH_PX's own comment.
      if (window.innerWidth < MIN_VIEWPORT_WIDTH_PX) return;
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
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);

      if (!session.armed) {
        // not enough travel yet to judge direction at all - a few stray
        // pixels right at pointerdown (unavoidable jitter) shouldn't
        // decide anything.
        if (absDx < ARM_THRESHOLD_PX && absDy < ARM_THRESHOLD_PX) return;

        const draggingInward = session.direction === "back" ? dx > 0 : dx < 0;
        if (absDx >= absDy && draggingInward) {
          session.armed = true;
          // prevent incidental text selection for the rest of the drag.
          document.body.style.userSelect = "none";
        } else if (absDx >= GIVE_UP_PX || absDy >= GIVE_UP_PX) {
          // travelled far enough that this clearly isn't going to turn
          // into a horizontal swipe (dominant vertical scroll, or
          // dragging the wrong way off this edge) - give up for good so
          // normal scrolling/etc keeps working untouched.
          endSession();
          return;
        } else {
          // still ambiguous (e.g. a near-45-degree start) - don't decide
          // yet, let the gesture keep developing on the next move.
          return;
        }
      }

      // rolling velocity window: keep only samples from the last
      // VELOCITY_WINDOW_MS so a fast flick at the end of a slow drag
      // still reads as fast.
      const now = performance.now();
      session.samples = session.samples.filter(([t]) => now - t <= VELOCITY_WINDOW_MS);
      session.samples.push([now, e.clientX]);

      const hasSomewhereToGo = session.direction === "back" ? canGoBack() : canGoForward();
      const progress = Math.min(1, absDx / COMMIT_DISTANCE_PX);
      const willCommit = hasSomewhereToGo && wouldCommit(absDx, e.clientX, now, session.samples);
      updateEdgeSwipeProgress(session.direction, absDx, progress, willCommit);

      e.preventDefault();
    }

    function onPointerUp(e: PointerEvent) {
      if (!session || e.pointerId !== session.pointerId) return;
      const { armed, startX, direction, samples } = session;
      if (armed) {
        const distance = Math.abs(e.clientX - startX);
        if (wouldCommit(distance, e.clientX, performance.now(), samples)) {
          if (direction === "back") window.history.back();
          else window.history.forward();
        }
        resetEdgeSwipeVisual();
      }
      endSession();
    }

    function onPointerCancel() {
      if (session?.armed) resetEdgeSwipeVisual();
      endSession();
    }

    document.addEventListener("pointerdown", onPointerDown);
    onCleanup(() => {
      document.removeEventListener("pointerdown", onPointerDown);
      if (session?.armed) resetEdgeSwipeVisual();
      endSession();
    });
  });
}
