// hub size scaling helpers.
//
// idea: hubs with more children should render bigger so the user
// can scan the canvas and immediately see which buckets are heavy
// vs sparse. scale is applied to the rendered diameter only — the
// physics sim still uses the base node size (cheaper, and the small
// visual overflow at the largest hubs is fine within the layout's
// natural padding).

/** smallest scale a hub can shrink to. floors at 0.7 so empty/
 *  near-empty hubs stay legible. */
export const HUB_SIZE_MIN_MUL = 0.7;
/** largest scale a hub can grow to. capped at 1.6 so a single very
 *  fat hub doesn't dominate the canvas. */
export const HUB_SIZE_MAX_MUL = 1.6;

/** map a hub's count to a size multiplier relative to its peer
 *  group. uses a square-root curve so the difference between
 *  small (5) and medium (50) hubs reads clearly without the
 *  largest hubs (500+) ballooning out of proportion.
 *
 *  - `count`: this hub's child count (e.g. `artist.albumCount`).
 *  - `maxCount`: largest count among visible peer hubs in the
 *    current frame. caller is responsible for computing this once
 *    per draw pass so every hub is normalized to the same scale.
 */
export function hubSizeMul(count: number, maxCount: number): number {
  if (!Number.isFinite(count) || count <= 0) return HUB_SIZE_MIN_MUL;
  if (!Number.isFinite(maxCount) || maxCount <= 1) return HUB_SIZE_MIN_MUL;
  // sqrt curve compresses the long tail. ratio in [0, 1].
  const ratio = Math.sqrt(count) / Math.sqrt(maxCount);
  return HUB_SIZE_MIN_MUL + (HUB_SIZE_MAX_MUL - HUB_SIZE_MIN_MUL) * ratio;
}
