// endpointCountTuning — pure per-link helpers that scale forceLink
// distance + strength by the heavier endpoint's child count.
//
// extracted from `graphWorker.ts` as the third worker slice
// (phase 12). intent: popular artists / fat hubs should pull
// their satellites in tighter and lock them in stiffer than
// sparse endpoints, but without collapsing huge hubs to a point.
//
// the helpers take a structural "link with album-count endpoints"
// shape rather than the worker's local `SimLink` type so they're
// trivially unit-testable.

import { ENDPOINT_COUNT_TUNING } from "../forceTuning";

/** minimal endpoint shape we need: an `albumCount` field. d3
 *  resolves string ids to node refs after sim init, and only the
 *  object form contributes a count — string endpoints fall through
 *  as zero. */
export interface CountedEndpoint {
  albumCount?: number;
}

/** link-shaped record. matches d3's source/target swap behaviour:
 *  before init the endpoints are string ids, after init they're
 *  resolved node objects. only the object form contributes. */
export interface CountedLink {
  source: CountedEndpoint | string | number | null | undefined;
  target: CountedEndpoint | string | number | null | undefined;
}

/** larger of the two endpoint album counts. returns 0 for unresolved
 *  links (both endpoints still strings) or genuinely empty endpoints. */
export function endpointMaxCount(l: CountedLink): number {
  const src = l.source;
  const tgt = l.target;
  const sc =
    typeof src === "object" && src !== null
      ? ((src as CountedEndpoint).albumCount ?? 0)
      : 0;
  const tc =
    typeof tgt === "object" && tgt !== null
      ? ((tgt as CountedEndpoint).albumCount ?? 0)
      : 0;
  const c = Math.max(sc, tc);
  return c > 0 ? c : 0;
}

/** shrink link target distance for high-count endpoints. sqrt curve
 *  so the first few albums move the needle a lot and the curve
 *  flattens out for very large hubs. floored at the configured
 *  `distanceShrinkFloor` so even huge hubs don't collapse to a
 *  single point. */
export function endpointCountDistanceShrink(l: CountedLink): number {
  const c = endpointMaxCount(l);
  if (c <= 0) return 1;
  return Math.max(
    ENDPOINT_COUNT_TUNING.distanceShrinkFloor,
    1 - Math.sqrt(c) / ENDPOINT_COUNT_TUNING.distanceShrinkDivisor,
  );
}

/** boost link spring strength for high-count endpoints. companion
 *  to the distance-shrink so heavy hubs lock their satellites in
 *  tightly instead of just declaring a shorter rest length. capped
 *  at the configured `strengthBoostCeiling`. */
export function endpointCountStrengthBoost(l: CountedLink): number {
  const c = endpointMaxCount(l);
  if (c <= 0) return 1;
  return Math.min(
    ENDPOINT_COUNT_TUNING.strengthBoostCeiling,
    1 + Math.sqrt(c) / ENDPOINT_COUNT_TUNING.strengthBoostDivisor,
  );
}
