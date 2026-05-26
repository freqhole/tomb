// shared types for the deterministic graph layout.
//
// see [docs/graph-deterministic-layout-plan.md](../../../../../../../../docs/graph-deterministic-layout-plan.md)
// for the algorithm overview. this module owns only the public type
// surface; the math lives in `wedge.ts` and the orchestration in
// `graphLayout.ts`.

/** minimum node shape the layout needs. caller provides what it
 *  already has on the worker boundary (`SimNodeInit`). */
export interface LayoutNode {
  id: string;
  kind: "album" | "artist" | "hub";
  /** for hubs: child count, drives the rendered glyph size and
   *  therefore the per-node radius the layout uses for slot math.
   *  for non-hubs, ignored. */
  albumCount?: number;
}

/** undirected edge between two layout nodes. cross-tier edges are
 *  navigation links; the layout only walks structural edges via bfs
 *  but every edge contributes to adjacency. */
export interface LayoutEdge {
  source: string;
  target: string;
}

/** wedge owned by a node: the angular slice it (or its children)
 *  may occupy. `halfWidth = π` means the full circle. */
export interface Wedge {
  /** outward direction, radians, atan2-convention. */
  center: number;
  /** half-width of the wedge in radians. children fan in
   *  `[center - halfWidth, center + halfWidth]`. */
  halfWidth: number;
}

/** one node's final placement after layout. */
export interface NodeLayout {
  x: number;
  y: number;
  /** the wedge this node owns for blooming its own children at the
   *  next tier. set even for leaves (halfWidth tiny then). */
  wedge: Wedge;
  /** hop distance from the pivot. 0 = pivot itself. */
  tier: number;
}

/** synthetic "more" stub injected when a parent has more visible
 *  children than fit in its bloom wedge. v1: one stub per
 *  over-saturated parent. the stub's id is deterministic
 *  (`more:<parentId>`) so callers can map clicks back to it across
 *  layouts. */
export interface StubInfo {
  id: string;
  parentId: string;
  /** the surplus children, in the order they would have appeared.
   *  callers may render them on stub-toggle by setting
   *  `stubToggles.set(parentId, 1)` and re-running the layout. */
  hiddenIds: string[];
}

export interface LayoutOptions {
  pivotId: string;
  viewport: { width: number; height: number };
  /** tiers rendered from the pivot. default 2. */
  hopHorizon?: number;
  /** base node diameter used for slot math (matches `SimConfig.nodeSize`). */
  nodeSize?: number;
  /** if set, layout uses the surplus set for the named parents.
   *  v1: only two sets per parent (visible vs surplus). a future
   *  pass extends this to cycling indices. */
  stubToggles?: Map<string, number>;
}

export interface LayoutResult {
  positions: Map<string, NodeLayout>;
  /** ids that should be rendered this frame, in deterministic order.
   *  includes the pivot, every visible descendant within the hop
   *  horizon, and the ids of any synthetic stubs. */
  visibleIds: string[];
  stubs: StubInfo[];
}
