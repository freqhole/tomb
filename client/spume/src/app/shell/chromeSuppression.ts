// generic registry for "hide the window-chrome buttons" (the chromeless
// title-bar strip's traffic-light/stoplight buttons - see
// components/layout/TitleBarStrip.tsx) while some full-bleed overlay wants
// an unobstructed view. any component can opt in via `useChromeSuppression`
// - multiple suppressors can be active at once (a ref-counted set, not a
// single boolean), so e.g. two independent maximized overlays stacking
// doesn't cause one's cleanup to wrongly re-show the buttons while the
// other is still active.
//
// TitleBarStrip still shows its buttons on hover regardless of suppression
// (see its own `hovered()` signal) - this only controls the "not currently
// hovered" default state.

import { createSignal, createEffect, onCleanup } from "solid-js";

const suppressors = new Set<string>();
const [suppressorCount, setSuppressorCount] = createSignal(0);

/** true when some component has asked to hide window-chrome buttons. */
export const chromeButtonsSuppressed = () => suppressorCount() > 0;

/** suppress window-chrome buttons for as long as `active()` returns true.
 * `id` must be unique per call site (e.g. a component name) so unrelated
 * suppressors don't clobber each other's registration. */
export function useChromeSuppression(id: string, active: () => boolean): void {
  createEffect(() => {
    const shouldSuppress = active();
    const alreadySuppressing = suppressors.has(id);
    if (shouldSuppress && !alreadySuppressing) {
      suppressors.add(id);
      setSuppressorCount((n) => n + 1);
    } else if (!shouldSuppress && alreadySuppressing) {
      suppressors.delete(id);
      setSuppressorCount((n) => n - 1);
    }
  });
  onCleanup(() => {
    if (suppressors.has(id)) {
      suppressors.delete(id);
      setSuppressorCount((n) => n - 1);
    }
  });
}
