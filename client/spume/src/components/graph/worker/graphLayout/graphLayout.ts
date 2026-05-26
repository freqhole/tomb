// the deterministic, pivot-anchored bloom layout.
//
// see [docs/graph-deterministic-layout-plan.md](../../../../../../../../docs/graph-deterministic-layout-plan.md)
//
// pure function: same `(nodes, edges, pivotId, viewport)` → same
// `Map<id, {x,y,wedge,tier}>`. no state, no convergence loop, no
// randomness.

import type {
  LayoutEdge,
  LayoutNode,
  LayoutOptions,
  LayoutResult,
  NodeLayout,
  StubInfo,
  Wedge,
} from "./types";
import { nodeRadiusFor, placeChildrenInWedge } from "./wedge";

/** tiers rendered out from the pivot. effectively-unlimited default
 *  for v1: the original `2` was designed for a "drill-in deeper"
 *  ux where most of the graph stays hidden until clicked. without a
 *  ui surface to bump it the library view collapses everything
 *  past the second hop onto the pivot, which is brutal. raise this
 *  (or wire a per-view override via `LayoutOptions.hopHorizon`) once
 *  the drill-in affordance exists. */
export const HOP_HORIZON_DEFAULT = 32;

/** distance from the pivot to tier-1 ring, as a fraction of the
 *  smaller viewport dimension. */
export const TIER1_RADIUS_FRAC = 0.22;

/** distance from a tier-1 node to its tier-2 ring, as a fraction of
 *  the smaller viewport dimension. */
export const TIER2_RADIUS_FRAC = 0.18;

/** baseline node diameter when caller omits `nodeSize`. matches
 *  graphWorker's default `SimConfig.nodeSize`. */
export const NODE_SIZE_DEFAULT = 56;

/** hard cap on a non-pivot node's bloom wedge. π/2 = a child can
 *  fan kids across at most a half-circle facing outward, never
 *  wrapping back toward its parent. only the pivot is allowed the
 *  full π half-width. */
export const MAX_BLOOM_HALFWIDTH = Math.PI / 2;

export function graphLayout(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  opts: LayoutOptions,
): LayoutResult {
  const positions = new Map<string, NodeLayout>();
  const stubs: StubInfo[] = [];
  const visibleIds: string[] = [];

  const nodeById = new Map<string, LayoutNode>(nodes.map((n) => [n.id, n]));
  if (!nodeById.has(opts.pivotId)) {
    return { positions, visibleIds, stubs };
  }

  const hopHorizon = opts.hopHorizon ?? HOP_HORIZON_DEFAULT;
  const baseSize = opts.nodeSize ?? NODE_SIZE_DEFAULT;
  const stubToggles = opts.stubToggles ?? new Map<string, number>();

  // precompute max hub count so node-radius scaling is consistent
  // across the layout, matching the renderer's normalization.
  let maxHubCount = 0;
  for (const n of nodes) {
    if (n.kind === "hub" && (n.albumCount ?? 0) > maxHubCount) {
      maxHubCount = n.albumCount ?? 0;
    }
  }

  // adjacency from edges (undirected).
  const adj = buildAdjacency(edges);

  // bfs from pivot, recording tier (= hop distance) for every node
  // within the horizon.
  const tier = bfsTiers(opts.pivotId, adj, hopHorizon);

  // place pivot at viewport center.
  const cx = opts.viewport.width / 2;
  const cy = opts.viewport.height / 2;
  const pivotWedge: Wedge = { center: 0, halfWidth: Math.PI };
  positions.set(opts.pivotId, {
    x: cx,
    y: cy,
    wedge: pivotWedge,
    tier: 0,
  });
  visibleIds.push(opts.pivotId);

  // ring radii derived from viewport. uses a sqrt curve so deep
  // tiers grow gracefully instead of marching to infinity — tier 1
  // sits at TIER1_RADIUS_FRAC * minDim and each subsequent ring
  // adds a shrinking band. fitToContent() rescues the camera if
  // the deepest visible ring lands off-screen.
  const minDim = Math.min(opts.viewport.width, opts.viewport.height);
  const ringForTier = (t: number) => {
    if (t <= 0) return 0;
    return minDim * TIER1_RADIUS_FRAC * Math.sqrt(t);
  };

  // bloom outward, tier by tier. at each step the parent already
  // has a wedge; we ask `placeChildrenInWedge` to fan its kids
  // inside it. surplus kids collapse into a stub.
  for (let t = 1; t <= hopHorizon; t++) {
    const parentsAtPrevTier = [...positions.entries()]
      .filter(([, layout]) => layout.tier === t - 1)
      .map(([id]) => id);

    for (const parentId of parentsAtPrevTier) {
      const parentLayout = positions.get(parentId)!;
      const parent = nodeById.get(parentId)!;

      // children of `parent` at tier `t`: adjacency intersected
      // with the tier map. dedup against already-placed ids so we
      // never double-place a node that's reachable two ways.
      const kidIds = (adj.get(parentId) ?? [])
        .filter((id) => tier.get(id) === t)
        .filter((id) => !positions.has(id));

      if (kidIds.length === 0) continue;

      // toggle: when the user has flipped this parent's stub, we
      // show the surplus set instead of the visible set. v1: one
      // toggle bit (0 or 1).
      const toggleIdx = stubToggles.get(parentId) ?? 0;
      const orderedKidIds =
        toggleIdx === 0 ? kidIds : rotateStubSet(kidIds, parent, baseSize, parentLayout, ringForTier(t));

      // child entries with subtree-count weights and per-node radius.
      const kidEntries = orderedKidIds.map((id) => {
        const k = nodeById.get(id)!;
        return {
          id,
          subtreeCount: subtreeCountOf(id, adj, tier, t, hopHorizon),
          radius: nodeRadiusFor(k, baseSize, maxHubCount),
        };
      });

      const ringR = ringForTier(t);
      const placement = placeChildrenInWedge(
        { x: parentLayout.x, y: parentLayout.y },
        parentLayout.wedge,
        ringR,
        kidEntries,
      );

      const fits = placement.surplus.length === 0;
      const visibleCount = fits ? placement.placed.length : placement.placed.length - 1;

      for (let i = 0; i < visibleCount; i++) {
        const p = placement.placed[i];
        // recompute the child's bloom wedge so its center is the
        // actual outward direction (parent → child), and cap the
        // half-width so kids can never wrap back through the parent.
        const outwardCenter = Math.atan2(p.y - parentLayout.y, p.x - parentLayout.x);
        const cappedHalf = Math.min(p.wedge.halfWidth, MAX_BLOOM_HALFWIDTH);
        positions.set(p.id, {
          x: p.x,
          y: p.y,
          wedge: { center: outwardCenter, halfWidth: cappedHalf },
          tier: t,
        });
        visibleIds.push(p.id);
      }

      if (!fits) {
        const stubSlot = placement.placed[placement.placed.length - 1];
        const stubId = stubIdFor(parentId);
        const outwardCenter = Math.atan2(stubSlot.y - parentLayout.y, stubSlot.x - parentLayout.x);
        const cappedHalf = Math.min(stubSlot.wedge.halfWidth, MAX_BLOOM_HALFWIDTH);
        positions.set(stubId, {
          x: stubSlot.x,
          y: stubSlot.y,
          wedge: { center: outwardCenter, halfWidth: cappedHalf },
          tier: t,
        });
        visibleIds.push(stubId);
        stubs.push({
          id: stubId,
          parentId,
          hiddenIds: placement.surplus,
        });
      }
    }
  }

  return { positions, visibleIds, stubs };
}

/** synthetic stub id. deterministic so the renderer can track it
 *  across re-layouts. */
export function stubIdFor(parentId: string): string {
  return `__more__:${parentId}`;
}

function buildAdjacency(edges: LayoutEdge[]): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (!adj.has(e.source)) adj.set(e.source, []);
    if (!adj.has(e.target)) adj.set(e.target, []);
    adj.get(e.source)!.push(e.target);
    adj.get(e.target)!.push(e.source);
  }
  return adj;
}

function bfsTiers(
  rootId: string,
  adj: Map<string, string[]>,
  maxDepth: number,
): Map<string, number> {
  const tier = new Map<string, number>();
  tier.set(rootId, 0);
  const queue: string[] = [rootId];
  while (queue.length) {
    const id = queue.shift()!;
    const t = tier.get(id)!;
    if (t >= maxDepth) continue;
    for (const next of adj.get(id) ?? []) {
      if (tier.has(next)) continue;
      tier.set(next, t + 1);
      queue.push(next);
    }
  }
  return tier;
}

/** count of in-horizon descendants below `id`. used as a wedge
 *  weight so fat subtrees claim more angle. */
function subtreeCountOf(
  id: string,
  adj: Map<string, string[]>,
  tier: Map<string, number>,
  fromTier: number,
  maxTier: number,
): number {
  if (fromTier >= maxTier) return 0;
  let count = 0;
  for (const next of adj.get(id) ?? []) {
    if (tier.get(next) === fromTier + 1) count++;
  }
  return count;
}

/** when a stub is toggled, swap which half of `kidIds` renders.
 *  v1: capacity-1 visible, surplus hidden; toggle swaps the two
 *  halves. simpler than recomputing capacity here — we just rotate
 *  by the visible-set size from the untoggled layout, so the
 *  second toggle pass renders the surplus first.
 *
 *  computing the exact split requires knowing capacity, which is
 *  itself a function of the parent's wedge and ring radius — we
 *  recompute a quick capacity estimate here to find the rotation
 *  offset. it's cheap and stays consistent with the placement pass. */
function rotateStubSet(
  kidIds: string[],
  parent: LayoutNode,
  baseSize: number,
  parentLayout: NodeLayout,
  ringR: number,
): string[] {
  void parent;
  void baseSize;
  // rough capacity estimate: same formula as placeChildrenInWedge.
  const arcLength = 2 * parentLayout.wedge.halfWidth * ringR;
  const avgR = baseSize * 0.55;
  const slotWidth = 2 * avgR + 0.25 * avgR;
  const capacity = Math.max(1, Math.floor(arcLength / slotWidth));
  if (kidIds.length <= capacity) return kidIds;
  const offset = capacity - 1;
  return [...kidIds.slice(offset), ...kidIds.slice(0, offset)];
}

// re-export so external imports only need `./graphLayout`.
export { distributeWedges, nodeRadiusFor, placeChildrenInWedge } from "./wedge";
export type { LayoutNode, LayoutEdge, LayoutOptions, LayoutResult, NodeLayout, StubInfo, Wedge };
