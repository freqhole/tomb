// force-tuning constants for the d3-force simulation running in the
// graph web worker.
//
// phase 2.5 (2026-05-26): collapsed further toward stock d3 defaults.
// the absolute scales used to be 4–6× d3 default link distance and
// 15–20× d3 default charge (since everything multiplied nodeSize=56).
// that meant tightly-knit clusters drifted apart and never re-converged.
// the new scales target near-stock spacing (linkDistance ≈ nodeSize,
// charge ≈ -2.5 * nodeSize) so the layout actually pulls in. the
// weight-driven link-strength override + the density bump on big
// graphs were both removed — d3's degree-aware default link strength
// + uniform charge gives a clean radial tree out of the box.
//
// previously deleted exports (phase 1): HUB_DIRECTIONAL, ENTITY_OUTWARD,
// HUB_RING_RADIUS, HUB_LINK_DISTANCE_MUL, REMOTE_HUB_LINK_STRENGTH_BUMP,
// RELATION_HUB_CHARGE_MUL, VALUE_HUB_CHARGE_MUL, ENDPOINT_COUNT_TUNING,
// RELATION_CURVE.
// phase 2.5 also dropped: LINK_STRENGTH_CURVE, LINK_STRENGTH_MIX.

/** link-distance multiplier vs the configured node size. phase 2.5
 *  (2026-05-26) shrunk 2.2 → 1.2 so connected nodes sit just over
 *  one node-width apart (d3 stock default is 30 px regardless of
 *  node size; this keeps it node-relative for visual consistency
 *  while landing in the same ballpark). */
export const LINK_DISTANCE_NODE_SIZE_MUL = 1.2;

/** baseline charge (negative = repulsion) per node size. phase 2.5
 *  (2026-05-26) softened -8.0 → -2.5. with nodeSize=56 this yields
 *  ≈ -140 (vs d3's stock -30) — still a touch stronger so node
 *  sprites have visible breathing room, but no longer the 15×
 *  blow-up that pushed clusters off-canvas. */
export const CHARGE_PER_NODE_SIZE = -2.5;

/** padding (as fraction of node size) added to hub collide radius so
 *  hub silhouettes don't kiss neighbours. */
export const HUB_COLLIDE_PADDING_MUL = 0.08;

/** collide radius for leaf (album / artist) nodes, as a fraction of
 *  node size. */
export const LEAF_COLLIDE_RADIUS_MUL = 0.52;

/** simulation cool-down knobs. velocityDecay + alphaDecay are exposed
 *  live via TuningOverrides; alphaMin stays hard-coded since it just
 *  stops the sim from spinning at low energy. pinned to d3 defaults. */
export const SIM_COOLDOWN = {
  alphaMin: 0.0015,
  velocityDecay: 0.4,
  alphaDecay: 0.0228,
} as const;
