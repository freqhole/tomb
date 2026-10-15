// shared "double-click-to-play"-style tap/click helper. touch devices get
// a single tap (a real double-tap is unreliable/absent on touch, and can
// fight with double-tap-to-zoom in some browser contexts), desktop/mouse
// requires an actual double-click so a plain click can still select/
// inspect the row without triggering playback. centralizes the
// `isMobile()` branch that used to be hand-duplicated per row/card
// component - the touch-vs-mouse decision now lives in exactly one place.
//
// not a fit for every row/card: some (SongCard, VideosTable) already give
// their plain onClick a different, real meaning (navigate to album, select
// row for bulk actions) - those should keep handling clicks themselves
// rather than using this helper.
import { isMobile } from "./isMobile";

/** `onDblClick` defaults to `onTap` - pass it explicitly only when a
 *  component already has separate onClick/onDoubleClick props to wire
 *  through unchanged. */
export function tapOrDblClick(
  onTap: () => void,
  onDblClick: () => void = onTap
): {
  onClick: () => void;
  onDblClick: () => void;
} {
  return {
    onClick: () => {
      if (isMobile()) onTap();
    },
    onDblClick: () => {
      if (!isMobile()) onDblClick();
    },
  };
}
