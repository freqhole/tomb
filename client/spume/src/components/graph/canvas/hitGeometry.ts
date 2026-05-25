// shape-aware hit-test geometry for the graph canvas.
//
// extracted from `GraphCanvas.tsx` as the first slice of phase 12
// (decompose the canvas component). these are pure functions over
// the sim node list + viewport scale — no solid signals, no closures
// over component state — so they can be unit-tested in isolation and
// shared with whatever per-feature hooks land next under `canvas/`.
//
// hit-test paths used to use a single worst-case radius
// (`nodeSize() * 0.55 * HUB_SIZE_MAX_MUL`) for every node, which
// gave huge slop around small/medium hubs — clicks far outside an
// octagon's silhouette would still register on it. these helpers
// compute the actual rendered size per node (factoring hub count
// scaling) and a shape-matched inradius (via the per-role factor
// from `draw/shared/hitRadius.ts`) so the hit area tracks the
// visible polygon.

import type { SimulationNodeDatum } from "d3-force";
import { nodeRole } from "../draw/shared/roleDispatch";
import { hitRadiusFor } from "../draw/shared/hitRadius";
import { isAnyHubId } from "../hubNodes";
import { hubSizeMul } from "../hubSize";
import type { ArtistNodeData, GraphNode } from "../types";

/** sim node alias matching `GraphCanvas.tsx`. */
export type SimNode = GraphNode & SimulationNodeDatum;

/** largest `albumCount` across all hub nodes in `nodes`. used as
 *  the denominator of `hubSizeMul`. returns 0 when no hubs exist. */
export function currentMaxHubCount(nodes: readonly SimNode[]): number {
  let m = 0;
  for (const n of nodes) {
    if (!isAnyHubId(n.id)) continue;
    const c = (n as ArtistNodeData).albumCount ?? 0;
    if (c > m) m = c;
  }
  return m;
}

/** rendered size of a node in world units. non-hub nodes use the
 *  configured base `nodeSize`; hubs scale by `hubSizeMul(count, max)`
 *  so larger hubs render bigger. */
export function effectiveNodeSize(
  n: SimNode,
  baseSize: number,
  maxHub: number,
): number {
  if (!isAnyHubId(n.id)) return baseSize;
  const c = (n as ArtistNodeData).albumCount ?? 0;
  return baseSize * hubSizeMul(c, maxHub);
}

/** per-node hit radius in world units. shape multipliers come from
 *  the per-role `HIT_INRADIUS_FACTOR` constants in `draw/roles/*.ts`
 *  (consolidated by `draw/shared/hitRadius.ts`). floored at 12 screen
 *  pixels so small nodes stay clickable when zoomed out. */
export function effectiveHitRadius(
  n: SimNode,
  k: number,
  baseSize: number,
  maxHub: number,
): number {
  const size = effectiveNodeSize(n, baseSize, maxHub);
  return Math.max(hitRadiusFor(nodeRole(n), size), 12 / k);
}

/** post-filter a coarse worker / local hit-test result: drop hits
 *  whose center is outside the node's effective shape radius. */
export function refineHit(
  n: SimNode | null,
  wx: number,
  wy: number,
  k: number,
  baseSize: number,
  maxHub: number,
): SimNode | null {
  if (!n) return null;
  const r = effectiveHitRadius(n, k, baseSize, maxHub);
  const dx = (n.x ?? 0) - wx;
  const dy = (n.y ?? 0) - wy;
  if (dx * dx + dy * dy > r * r) return null;
  return n;
}
