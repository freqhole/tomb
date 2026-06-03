// graph2/worker/messages.ts — slim message protocol between main thread and walker worker.

import type { WalkGraph, WalkNode, WalkEdge, NodeRole } from "../types";

// ---- visible node descriptor (sent in topology messages) -------------------

export interface VisibleNode {
  id: string;
  role: NodeRole;
  label: string;
  childCount: number;
  isPivot: boolean;
  /** true if this node is on the breadcrumb path from root to pivot */
  isBreadcrumb: boolean;
  /** when an artist is hovered, its connected albums get coHovered = true */
  coHovered?: boolean;
  /** when an artist is selected, its connected albums get coSelected = true */
  coSelected?: boolean;
  /** optional hex color override for node fill (e.g. taxon kind colors). */
  tint?: string;
  /** true when this remote-hub node represents a charnel-managed remote.
   *  the canvas renderer draws a home glyph next to its label. only
   *  meaningful when `role === "remote"`. */
  isCharnelManaged?: boolean;
  /** strategy A — cross-remote cluster aggregation. when this node is the
   *  visual representative ("leader") for a set of matched artists/albums
   *  spread across N remotes, contributorRemotes holds the sorted list of
   *  contributing remote ids. the renderer draws a per-contributor accent
   *  dot ring around the node and the detail panel reads this list to
   *  surface a multi-remote edit/open dropdown. absent or length<=1 means
   *  the node is a normal single-remote entity. */
  contributorRemotes?: string[];
}

export interface TopologyEdge {
  /** index into the VisibleNode array from the most recent topology message */
  sourceIdx: number;
  targetIdx: number;
  /** breadcrumb edges are drawn differently (highlighted path) */
  isBreadcrumb: boolean;
  /** synthesized link between matched nodes in different remotes (artist or
   *  album). drawn amber-dashed so federation is visually obvious. */
  isCrossRemote?: boolean;
  /** lazy-loaded related-artist relationship sourced from
   *  related_artistz. drawn in a dedicated color with a mid-edge label. */
  isRelatedArtist?: boolean;
  /** true when the related-artist row is in `pending` review status
   *  (proposed but not yet accepted). only meaningful alongside
   *  `isRelatedArtist`. */
  isPending?: boolean;
}

// ---- main → worker ---------------------------------------------------------

export interface MsgInit {
  type: "init";
  graph: WalkGraph;
  /** initial pivot node id */
  pivot: string;
  /** optional pre-seeded breadcrumb (used by stories to start mid-walk) */
  breadcrumb?: string[];
  width: number;
  height: number;
}

/** click on a node — walk forward (if child of pivot) or walk back (if ancestor) */
export interface MsgExpand {
  type: "expand";
  nodeId: string;
}

export interface MsgResize {
  type: "resize";
  width: number;
  height: number;
}

/** point hit test — (x, y) are in WORLD coordinates; `k` is the
 *  current viewport scale so the worker can apply the min-screen-px
 *  hit floor. worker replies with MsgHitResult. */
export interface MsgHitTest {
  type: "hitTest";
  reqId: number;
  x: number;
  y: number;
  k: number;
}

/** pop one breadcrumb step (no-op if breadcrumb length is 1) */
export interface MsgBack {
  type: "back";
}

/** request the bounding box of all currently visible sim nodes */
export interface MsgGetBounds {
  type: "getBounds";
  reqId: number;
}

/** add nodes and edges to the full graph without discarding positions */
export interface MsgMerge {
  type: "merge";
  addNodes: WalkNode[];
  addEdges: WalkEdge[];
}

/** drop nodes (and any edges referencing them) from the full graph.
 *  used by refreshHub to evict stale taxon nodes/edges before re-merge
 *  so re-parented children don't keep their old hub edge. */
export interface MsgRemove {
  type: "remove";
  nodeIds: string[];
}

/** mark nodes as hidden without removing them from the full graph.
 *  hidden nodes are skipped by getVisible() (breadcrumb is exempt) so
 *  the sim re-lays out the remaining nodes more tightly. used by the
 *  edit-mode taxon filter. pass an empty array to clear. */
export interface MsgSetHidden {
  type: "setHidden";
  nodeIds: string[];
}

/** jump to a new pivot; optionally reset breadcrumb instead of pushing */
export interface MsgRepivot {
  type: "repivot";
  nodeId: string;
  /** when true, breadcrumb is reset to [nodeId]; when false (default), nodeId is pushed */
  resetBreadcrumb?: boolean;
}

/** pause or resume the simulation */
export interface MsgSetPaused {
  type: "setPaused";
  paused: boolean;
}

/** debug overlay — update runtime sim tuning multipliers. partial
 *  patch: any missing keys keep their current value. */
export interface MsgSetTuning {
  type: "setTuning";
  tuning: Partial<{
    albumArtistDistance: number;
    albumArtistStrength: number;
    relatedArtistDistance: number;
    relatedArtistStrength: number;
    artistHubDistance: number;
    artistHubStrength: number;
    albumCollide: number;
    artistCollide: number;
    clusterCohesion: number;
    artistCharge: number;
    albumCharge: number;
    gravity: number;
  }>;
}

/** expand the entire immediate child subtree of a node. for group/value
 *  hub nodes this surfaces all child taxons + any artist children + each
 *  artist's albums. cleared on `back`. */
export interface MsgExpandSubtree {
  type: "expandSubtree";
  nodeId: string;
}

/** clear every eager subtree expansion at once. fired by the host on
 *  single-selection of an unrelated node so the previously-expanded
 *  groups collapse back to normal pivot-driven visibility. */
export interface MsgCollapseSubtrees {
  type: "collapseSubtrees";
}

/** pin a set of node ids so they (and every ancestor on the path back
 *  to root) stay visible regardless of where the breadcrumb pivot is.
 *  used by search to keep all hits on-screen while the user drills
 *  into a single one. pass an empty array to clear. */
export interface MsgSetPinned {
  type: "setPinned";
  nodeIds: string[];
}

export type MainToWorker =
  | MsgBack
  | MsgExpand
  | MsgExpandSubtree
  | MsgCollapseSubtrees
  | MsgGetBounds
  | MsgHitTest
  | MsgInit
  | MsgMerge
  | MsgRemove
  | MsgRepivot
  | MsgResize
  | MsgSetHidden
  | MsgSetPaused
  | MsgSetPinned
  | MsgSetTuning;

// ---- worker → main ---------------------------------------------------------

export interface MsgReady {
  type: "ready";
}

/** sent whenever the visible node/edge set changes */
export interface MsgTopology {
  type: "topology";
  nodes: VisibleNode[];
  edges: TopologyEdge[];
}

/** sent on every simulation tick; positions[i*2], positions[i*2+1] = x,y for
 *  topologyNodes[i] from the most recent MsgTopology */
export interface MsgFrame {
  type: "frame";
  positions: Float32Array;
  alpha: number;
}

export interface MsgHitResult {
  type: "hitResult";
  reqId: number;
  nodeId: string | null;
}

/** response to MsgGetBounds */
export interface MsgBoundsResult {
  type: "boundsResult";
  reqId: number;
  /** null when there are no visible nodes */
  bounds: { minX: number; minY: number; maxX: number; maxY: number } | null;
}

/** emitted after every topology change; ids of nodes in the current visible set */
export interface MsgVisibleIds {
  type: "visibleIds";
  ids: string[];
}

export type WorkerToMain =
  | MsgBoundsResult
  | MsgFrame
  | MsgHitResult
  | MsgReady
  | MsgTopology
  | MsgVisibleIds;
