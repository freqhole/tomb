// force-tuning constants for the d3-force simulation running in the
// graph web worker. centralized here so adjusting layout feel doesn't
// require hunting through 900 lines of `buildSim` to find the magic
// number you want to nudge.
//
// the breakpoints in `densityMultiplierForCount`, `collideRadiiForCount`,
// link-strength piecewise, alpha-decay piecewise, and collide-iterations
// piecewise live alongside their helpers in `graphWorker.ts` for now —
// extracting them here would force every helper to take a settings
// object, trading one indirection for another. the scalar knobs below
// are the high-signal ones: change a single number and the whole
// layout reflows.

/** link-distance multiplier vs the configured node size. higher = more
 *  breathing room between connected nodes. lowered 2026-05-25 from
 *  2.6 → 2.05 to pull connected nodes visibly closer now that the
 *  drilldown topology keeps the rendered subgraph small enough that
 *  long links read as "adrift" rather than "spacious". */
export const LINK_DISTANCE_NODE_SIZE_MUL = 2.05;

/** baseline charge (negative = repulsion) per node size. multiplied by
 *  the count-driven density multiplier in `buildSim`. bumped
 *  2026-05-25 from -7.8 → -8.6 so non-connected nodes still push apart
 *  cleanly under the tighter link distance + stiffer springs. */
export const CHARGE_PER_NODE_SIZE = -8.6;

/** relation hubs cluster tightly around their parent remote, so their
 *  long-range repulsion is much weaker than leaves. multiplier applied
 *  to the baseline charge. */
export const RELATION_HUB_CHARGE_MUL = 0.25;

/** value hubs sit on the outer canvas and want moderate separation
 *  from siblings — between leaf charge and relation-hub charge. */
export const VALUE_HUB_CHARGE_MUL = 0.5;

/** hub-to-hub link distance multipliers applied on top of the base
 *  `linkDist`. lower = scaffold collapses tighter. */
export const HUB_LINK_DISTANCE_MUL = {
  /** remote-root → relation-hub or relation-hub → remote-root. */
  remoteToRelation: 0.22,
  /** any other hub↔hub edge (kind hex → value octagon, etc.). */
  kindToKind: 0.45,
} as const;

/** spring-strength bump for remote↔kind-hub edges so the half-dozen
 *  relation hexagons per remote stay glued to their triangle. */
export const REMOTE_HUB_LINK_STRENGTH_BUMP = 2.2;

/** padding (as fraction of node size) added to hub collide radius so
 *  hub silhouettes don't kiss neighbours. label chips that overflow
 *  the silhouette are allowed to render over neighbours — that's a
 *  visual concern, not a layout one. */
export const HUB_COLLIDE_PADDING_MUL = 0.08;

/** base ring radius for hub directional pull: nodeSize *
 *  max(BASE_MIN, sqrt(nCount) * SQRT_FACTOR). */
export const HUB_RING_RADIUS = {
  baseMin: 8,
  sqrtFactor: 1.4,
} as const;

/** per-hub-class directional pull configuration. each hub gets a
 *  stable angular slot around the canvas centre and is pulled outward
 *  to a target ring along that angle. */
export const HUB_DIRECTIONAL = {
  remote: {
    /** ring radius multiplier (1.0 = baseline ring). */
    radiusFactor: 1.0,
    /** forceX/Y strength on this class. */
    strength: 0.22,
  },
  relation: {
    /** shares the parent remote's angle + radius so kind hexagons
     *  cluster around their triangle. */
    radiusFactor: 1.0,
    strength: 0.22,
  },
  relationValue: {
    /** pushed outside the remote ring so value octagons spread on the
     *  outer canvas. */
    radiusFactor: 1.3,
    strength: 0.14,
  },
} as const;

/** simulation cool-down. lower alphaDecay = sim runs longer, more
 *  time for collide to untangle overlaps. velocityDecay lowered
 *  2026-05-25 from 0.64 → 0.46 to restore springy / elastic motion
 *  — prior value was tuned for huge graphs (3k+ nodes) where
 *  bouncy layouts felt chaotic; with the drilldown subgraph
 *  staying small, the extra damping just made layout feel sticky. */
export const SIM_COOLDOWN = {
  /** raised above d3 default 0.001 so the sim doesn't freeze with
   *  residual link/charge tension still pushing collide-constrained
   *  pairs apart. */
  alphaMin: 0.0015,
  velocityDecay: 0.46,
} as const;

/** link spring strength: base + slope * weight. stiffened 2026-05-25
 *  (base 0.15 → 0.24, slope 0.35 → 0.52) so connected nodes pull
 *  visibly closer instead of drifting on a slack spring. */
export const LINK_STRENGTH_CURVE = {
  base: 0.24,
  slope: 0.52,
} as const;

/** count-aware link tweaks for heavy hubs. */
export const ENDPOINT_COUNT_TUNING = {
  /** floor for distance shrink so huge hubs don't collapse to a point. */
  distanceShrinkFloor: 0.55,
  /** divisor in the sqrt(c) / X curve for distance shrink. */
  distanceShrinkDivisor: 28,
  /** ceiling for strength boost. */
  strengthBoostCeiling: 2.4,
  /** divisor in the sqrt(c) / X curve for strength boost. */
  strengthBoostDivisor: 10,
} as const;

/** non-linear exponent curves for per-relation distance/strength
 *  multipliers (see `relationDistanceMultiplier` /
 *  `relationStrengthMultiplier` in graphWorker.ts). */
export const RELATION_CURVE = {
  distance: {
    exponent: 1.2,
    base: 1.52,
    slope: 1.12,
  },
  strength: {
    exponent: 1.35,
    base: 0.22,
    slope: 3.05,
  },
} as const;

/** phase 20 — radial / conical fan-out for entity leaves.
 *
 *  every non-hub node whose strongest link is to a hub gets a
 *  per-leaf outward target along the parent hub's directional
 *  angle, spread within a wedge so siblings don't stack on a
 *  shared point. forceX/Y pulls them gently toward that target
 *  so the entity-tier fanout actually opens outward into the
 *  canvas instead of curling back through the root cluster.
 *
 *  the wedge is intentionally wide (±60°) so the spread reads
 *  as a soft cone rather than a strict ring — collide + link
 *  still own the local pixel-perfect arrangement; this force
 *  just biases the overall direction. */
export const ENTITY_OUTWARD = {
  /** half-angle of the wedge entities fan into around their
   *  parent hub's directional angle. π/3 = 60° → 120° total. */
  wedgeHalfAngleRad: Math.PI / 3,
  /** ring radius multiplier (vs the base hub ring radius). > 1
   *  pushes entities further out than value hubs (1.3) so the
   *  fanout reads as descending from the hub. */
  radiusFactor: 1.6,
  /** forceX / forceY strength on leaves with an outward target.
   *  intentionally gentle so collide + link still dominate the
   *  local arrangement; this is a directional bias, not a
   *  position lock. */
  strength: 0.05,
} as const;
