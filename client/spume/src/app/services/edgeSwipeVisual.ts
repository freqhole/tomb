// imperative, ref-driven visual feedback for edge-swipe navigation (see
// useEdgeSwipeNavigation.ts, EdgeSwipeIndicators.tsx). deliberately NOT
// solid signals/reactivity - a drag can fire pointermove many times a
// second, and routing every one of those through solid's reactivity
// system just to mutate a couple of style properties would be wasted
// re-render overhead for no visual benefit. the icon dom nodes
// themselves are always mounted (see EdgeSwipeIndicators.tsx's own doc
// comment on why gating them behind a reactive <Show> is a trap here) -
// width/opacity alone drive "hidden at rest", so this module is pure
// direct style mutation, no signals at all.
//
// one ref per direction, driving everything (width, height, opacity,
// color) on the same element - an earlier version split this across
// three separate refs (a "reveal window", an "icon box", and a
// "color layer") on the theory that size and color shouldn't share one
// element's style object, which wasn't actually true (nothing conflicts
// about setting several style properties in one place) and just made
// this harder to follow for no benefit - `color` is a normal inherited
// css property, so setting it here cascades down to the icon's own
// `fill="currentColor"` regardless of how many children are in between.
export type EdgeSwipeDirection = "back" | "forward";

const iconEls: Record<EdgeSwipeDirection, HTMLElement | null> = {
  back: null,
  forward: null,
};
// which direction's element `resetEdgeSwipeVisual` should animate back
// to rest - set on every progress update, read once on release/cancel.
let lastDirection: EdgeSwipeDirection | null = null;

export function registerEdgeSwipeIconEl(direction: EdgeSwipeDirection, el: HTMLElement | null) {
  iconEls[direction] = el;
}

const COMMITTED_COLOR = "var(--color-accent-500)";
const PENDING_COLOR = "var(--color-text-secondary)";

/** called continuously while an armed drag is in progress (see the
 *  gesture hook). `distance` is the raw (unsigned) drag distance so far -
 *  used directly, uncapped, as the icon's width AND height, so it keeps
 *  growing for as long as the user keeps dragging. safe to leave
 *  uncapped: the icon is centered via `top: 50%; transform:
 *  translateY(-50%)` (see EdgeSwipeIndicators.tsx), not a bounded flex
 *  container, so there's no fixed-size box for it to overflow out of -
 *  it just keeps growing until it goes past the actual screen edge,
 *  at which point the browser's own normal viewport clipping takes over
 *  (the same thing that happens to any oversized fixed element - no
 *  special handling needed). `progress` is 0..1 driving opacity;
 *  `willCommit` mirrors the same distance-or-velocity check release
 *  would use, right now, live - so the icon can change color the instant
 *  letting go would actually navigate, not just at release. */
export function updateEdgeSwipeProgress(
  direction: EdgeSwipeDirection,
  distance: number,
  progress: number,
  willCommit: boolean
) {
  lastDirection = direction;
  const el = iconEls[direction];
  if (!el) return;
  el.style.transition = "none";
  el.style.width = `${distance}px`;
  el.style.height = `${distance}px`;
  el.style.opacity = String(Math.min(1, Math.max(0, progress)));
  el.style.color = willCommit ? COMMITTED_COLOR : PENDING_COLOR;
}

/** called once on release/cancel - fades/shrinks the icon back to rest. */
export function resetEdgeSwipeVisual() {
  if (!lastDirection) return;
  const el = iconEls[lastDirection];
  if (!el) return;
  el.style.transition = "opacity 180ms ease, width 180ms ease, height 180ms ease";
  el.style.opacity = "0";
  el.style.width = "0px";
  el.style.height = "0px";
}
