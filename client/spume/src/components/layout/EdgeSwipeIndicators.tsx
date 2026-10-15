// visual companion to useEdgeSwipeNavigation.ts - renders the two
// edge-pinned arrow icons that grow/fade in as an edge-swipe drag
// progresses, and turn accent-colored once letting go would actually
// navigate. the gesture hook drives this purely through
// edgeSwipeVisual.ts's imperative setters, so a drag's many pointermove
// events never touch solid's reactivity system.
//
// mounted once at the app root (see App.tsx), as a plain sibling -
// deliberately NOT wrapping any app content. an earlier version also
// shifted the actual page content sideways via `transform` to visually
// "reveal" these icons, first around the whole app, then narrowed to
// just the routed view content once that broke things - both wrapped
// *something* shared with this app's pre-existing position:fixed chrome
// (TopNav, PlayerBar, QueueSidebar, view-level absolutely-positioned
// controls anchored off TopNav's own measured height, ...), and per CSS
// spec, `transform` (and `will-change: transform`) on *any* shared
// ancestor of a `position: fixed` element becomes that element's new
// containing block - not an implementation detail, the actual rule.
// both attempts caused real regressions (controls becoming unclickable)
// that weren't fully resolved even after narrowing scope once. rather
// than keep guessing at an app with this much existing fixed/z-indexed
// UI, dropped the content-shift effect entirely - these two icons are
// now just independent overlay elements (the same category as a toast
// or modal), with zero exposure to this whole bug class since nothing
// here wraps or shares an ancestor with anything that needs to keep
// working.
//
// vertically centered via `top: 50%; transform: translateY(-50%)`
// rather than flexbox inside a viewport-height container - an earlier
// version used the flex approach, which bounded the icon to a fixed
// cross-axis size it could grow past (with `overflow: hidden` clipping
// it), causing a "moving" visual artifact on long drags once the icon's
// size exceeded that bound. transform-centering has no such bound - the
// icon can grow arbitrarily large, with anything past the actual screen
// edge just naturally clipped by the viewport itself, same as any other
// oversized fixed element.
//
// z-index is set deliberately very high (9999) - this needs to paint
// above literally everything else in the app, including QueueSidebar's
// own overlay panel (z-1140) and backdrop (z-1130), which otherwise hid
// the forward-direction icon whenever the queue was open.
//
// renders a plain no-op (nothing at all) whenever the feature is turned
// off (default) - must have zero footprint for the vast majority of
// users who never enable the setting.
import { onCleanup, onMount, Show } from "solid-js";
import { Icon } from "../icons/registry";
import { edgeSwipeNavigationEnabled } from "../../app/services/edgeSwipeSettings";
import { registerEdgeSwipeIconEl } from "../../app/services/edgeSwipeVisual";

const Z_INDEX = 9999;

export function EdgeSwipeIndicators() {
  return (
    <Show when={edgeSwipeNavigationEnabled()}>
      <EdgeSwipeIndicatorsActive />
    </Show>
  );
}

// split out from EdgeSwipeIndicators itself so its onMount/onCleanup are
// scoped to exactly when THIS subtree is created/torn down by the <Show>
// above - putting them directly in EdgeSwipeIndicators's own body would
// only ever fire once, at that outer (always-mounted) component's own
// lifetime, which (since `appState()` loads asynchronously) almost always
// happens BEFORE the setting's real value is known and this branch ever
// actually renders - registering refs that are still unset at that point,
// then never again once the real divs below do mount. a real, confirmed
// bug from an earlier version of this file.
function EdgeSwipeIndicatorsActive() {
  let backIconRef: HTMLDivElement | undefined;
  let forwardIconRef: HTMLDivElement | undefined;

  onMount(() => {
    registerEdgeSwipeIconEl("back", backIconRef ?? null);
    registerEdgeSwipeIconEl("forward", forwardIconRef ?? null);
  });
  onCleanup(() => {
    registerEdgeSwipeIconEl("back", null);
    registerEdgeSwipeIconEl("forward", null);
  });

  return (
    <>
      {/* always mounted (not gated behind a <Show>) - width/height/
          opacity alone handle "hidden at rest", same reasoning as
          EdgeSwipeIndicatorsActive's own onMount/onCleanup split above.
          width/height/opacity/color are all driven live
          (edgeSwipeVisual.ts), uncapped, on this one element. */}
      <div
        ref={backIconRef}
        class="pointer-events-none"
        style={{
          position: "fixed",
          left: "0px",
          top: "50%",
          transform: "translate(0, -50%)",
          width: "0px",
          height: "0px",
          "z-index": Z_INDEX,
          opacity: 0,
        }}
      >
        {/* semi-opaque triangular backdrop, pointing the same direction
            as the arrow (left) - flat edge on the content-facing side,
            apex at the screen edge. plain percentage clip-path, so it
            auto-scales with the parent's own js-driven size with no
            extra js needed for this part. */}
        <div
          class="absolute inset-0"
          style={{
            "clip-path": "polygon(100% 0%, 100% 100%, 0% 50%)",
            "background-color": "rgba(0, 0, 0, 0.45)",
          }}
        />
        {/* icon layer, inset so it reads as centered within the
            triangle rather than touching its edges. `size="100%"`
            makes the svg fill whatever pixel size this resolves to;
            `fill="currentColor"` (Icon's default) is what makes this
            element's own inherited `color` (set on the ref'd parent
            above) apply to it. */}
        <div class="absolute inset-[15%] flex items-center justify-center">
          <Icon name="arrowLeft" size="100%" />
        </div>
      </div>
      <div
        ref={forwardIconRef}
        class="pointer-events-none"
        style={{
          position: "fixed",
          right: "0px",
          top: "50%",
          transform: "translate(0, -50%)",
          width: "0px",
          height: "0px",
          "z-index": Z_INDEX,
          opacity: 0,
        }}
      >
        <div
          class="absolute inset-0"
          style={{
            "clip-path": "polygon(0% 0%, 0% 100%, 100% 50%)",
            "background-color": "rgba(0, 0, 0, 0.45)",
          }}
        />
        <div class="absolute inset-[15%] flex items-center justify-center">
          <Icon name="arrowRight" size="100%" />
        </div>
      </div>
    </>
  );
}
