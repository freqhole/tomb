// graph worker message protocol
//
// shared message type definitions used by both the main thread
// (graphWorkerClient) and the worker entry (graphWorker). every
// message has a `type` discriminator so both sides can narrow with
// a switch.
//
// see [docs/graph-web-worker-plan.md](../../../../../../../docs/graph-web-worker-plan.md)
// for the architecture overview and the rationale for using
// Transferable `Float32Array` buffers (rather than SAB) for the
// per-tick position stream.

import type { GraphEdge, GraphNodeData, RelationKind, RelationKindLike } from "../types";

/** minimum subset of node fields the worker needs to run the sim.
 *  the main thread sends these on init/update; the worker owns its
 *  own sim-side node objects.
 *
 *  phase 4: when `edgeConfig` is set on init/update the worker also
 *  derives relation edges from the optional taxonomy fields below
 *  (genres/tagLabels/moods/styles/label/era/etc.). callers that don't
 *  want worker-side edge derivation can leave those fields out and
 *  keep posting pre-built `links` in MsgInit/MsgUpdate. */
export interface SimNodeInit {
  id: string;
  kind: "album" | "artist";
  /** optional initial position hint; if absent the sim seeds
   *  positions via phyllotaxis on its side. */
  x?: number;
  y?: number;
  /** pinned position; non-null means the node is fixed there until
   *  unpinned. carried in init/update so a fresh worker session
   *  preserves any in-flight drag-pin state. */
  fx?: number | null;
  fy?: number | null;

  // ---- phase 4: taxonomy fields for worker-side edge derivation ----
  /** artist id this node belongs to (album) or *is* (artist). */
  artistId?: string;
  /** for album nodes: artist display name (drives same_artist label). */
  artistName?: string;
  /** for artist nodes: artist display name (drives artist_album +
   *  related_artist labels). */
  name?: string;
  isFavorite?: boolean;
  genres?: string[];
  /** tag labels only — weights aren't needed for edge derivation, and
   *  stripping them keeps the per-topology payload smaller. */
  tagLabels?: string[];
  moods?: string[];
  styles?: string[];
  label?: string | null;
  era?: string | null;
  /** for artist (incl. hub) nodes: the album-count this node
   *  represents. used in the worker to scale link strength + shorten
   *  link distance for high-count endpoints so popular artists /
   *  heavy hubs render as tight visual clusters. */
  albumCount?: number;
}

/** edge as carried over the wire. d3-force tolerates string source/target
 *  on construction and replaces with node refs after init. */
export interface SimLinkInit {
  source: string;
  target: string;
  kind: RelationKindLike;
  weight: number;
  label?: string;
}

/** sim-tuning knobs forwarded from the main thread. allows the parent
 *  view to override defaults if needed (lockNodes etc. land here). */
export interface SimConfig {
  /** world-units node size; drives link distance + collide radius. */
  nodeSize: number;
  /** viewport center anchor for forceCenter. */
  width: number;
  height: number;
  /** start the sim paused? */
  paused?: boolean;
}

/** phase 4: tells the worker to derive relation edges from the node
 *  taxonomy fields in `SimNodeInit` rather than using the legacy
 *  `links` payload. when set, the worker also emits `MsgEdges` after
 *  every topology change so the main thread's ui (counts, popovers,
 *  carousel, edge picker) can stay in sync with the sim. */
export interface EdgeDeriveConfig {
  /** which relation kinds participate in the sim. omitted = all.
   *  the worker still emits the full unfiltered edge list to the
   *  main thread for ui consumption; this only filters the subset
   *  used as sim links. */
  enabledKinds?: RelationKind[];
  /** per-shared-value chain length cap. default 3. */
  fanout?: number;
  /** drop groups smaller than this. default 2. */
  minGroupSize?: number;
  /** resolved related-artist relationships, keyed by source artist
   *  id. structured-clone copies the Map. omitted = no
   *  `related_artist` edges. */
  relatedArtists?: Map<string, Set<string>>;
}

/** how aggressively a topology change should reheat the sim.
 *  - `fresh`: full energy (alpha=1, restart). first build only.
 *  - `nudge`: low alpha (0.08, restart). default for incremental
 *    updates so nodes barely shuffle.
 *  - `quiet`: no reheat (alpha=0, stop). user is inspecting and
 *    paginated batches shouldn't disturb the layout. */
export type UpdateMode = "fresh" | "nudge" | "quiet";

// ----- main → worker ----------------------------------------------------

export interface MsgInit {
  type: "init";
  nodes: SimNodeInit[];
  /** legacy: pre-built links. ignored when `edgeConfig` is set. */
  links: SimLinkInit[];
  config: SimConfig;
  /** optional per-kind strength sliders (0..1). affects link
   *  distance + spring strength regardless of derive mode. */
  relationStrengths?: Record<string, number>;
  /** phase 4: when present the worker derives edges from node
   *  taxonomy and emits `MsgEdges`. */
  edgeConfig?: EdgeDeriveConfig;
}

export interface MsgUpdate {
  type: "update";
  nodes: SimNodeInit[];
  links: SimLinkInit[];
  mode: UpdateMode;
  relationStrengths?: Record<string, number>;
  edgeConfig?: EdgeDeriveConfig;
}

export interface MsgResize {
  type: "resize";
  width: number;
  height: number;
  /** reheat after resize? main thread sets false during quietUpdates. */
  reheat: boolean;
}

export interface MsgPin {
  type: "pin";
  nodeId: string;
  x: number;
  y: number;
}

export interface MsgUnpin {
  type: "unpin";
  nodeId: string;
}

export interface MsgAlphaTarget {
  type: "alphaTarget";
  target: number;
  /** when true (and target > 0), also restart the sim. */
  restart?: boolean;
}

export interface MsgPause {
  type: "pause";
}

export interface MsgResume {
  type: "resume";
  /** optional alpha bump on resume. */
  alpha?: number;
}

export interface MsgHitTest {
  type: "hitTest";
  /** caller-supplied id so the worker's response can be matched up. */
  id: number;
  x: number;
  y: number;
  radius: number;
}

export interface MsgHitRect {
  type: "hitRect";
  id: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface MsgReheat {
  type: "reheat";
  alpha: number;
}

/** phase 4: change which relation kinds are active in the sim
 *  without resending the full topology. worker re-derives its filtered
 *  sim-link subset from cached edges and nudges the sim. */
export interface MsgSetEnabledKinds {
  type: "setEnabledKinds";
  /** which relation kinds are currently enabled. omit (undefined)
   *  to disable the filter entirely (= all kinds enabled). an empty
   *  array filters everything out (= no edges). */
  kinds?: RelationKind[];
  /** how aggressively to reheat after re-filtering. default "nudge". */
  mode?: UpdateMode;
}

/** hand a position buffer back to the worker for reuse. zero-copy
 *  via transfer list. the worker owns these buffers; the main thread
 *  only borrows them long enough to render. */
export interface MsgReturn {
  type: "return";
  buf: Float32Array;
}

export interface MsgQuit {
  type: "quit";
}

export type MainToWorker =
  | MsgInit
  | MsgUpdate
  | MsgResize
  | MsgPin
  | MsgUnpin
  | MsgAlphaTarget
  | MsgPause
  | MsgResume
  | MsgHitTest
  | MsgHitRect
  | MsgReheat
  | MsgSetEnabledKinds
  | MsgReturn
  | MsgQuit;

// ----- worker → main ----------------------------------------------------

export interface MsgReady {
  type: "ready";
}

export interface MsgTopology {
  type: "topology";
  nodeCount: number;
  edgeCount: number;
  alpha: number;
}

/** node positions snapshot. `buf` is a `Float32Array` of length
 *  `nodeCount * 2`, indexed `[i*2] = x, [i*2+1] = y`, in the same
 *  order as the most-recent `init`/`update` `nodes[]` payload. */
export interface MsgPositions {
  type: "positions";
  buf: Float32Array;
  tick: number;
  alpha: number;
  /** milliseconds the worker spent in the most recent sim tick
   *  (force compute + buffer copy). main forwards into perfLog so
   *  the worker side of the cost shows up alongside `draw.frame`. */
  tickMs?: number;
}

export interface MsgHitResult {
  type: "hitResult";
  id: number;
  nodeId: string | null;
}

export interface MsgHitRectResult {
  type: "hitRectResult";
  id: number;
  nodeIds: string[];
}

/** derived relation edges (post phase-4). main thread caches this
 *  for rendering until the next topology change. */
export interface MsgEdges {
  type: "edges";
  edges: GraphEdge[];
}

export type WorkerToMain =
  | MsgReady
  | MsgTopology
  | MsgPositions
  | MsgHitResult
  | MsgHitRectResult
  | MsgEdges;

// re-export common types so callers don't need to import from
// "../types" separately when they only deal with the worker
// boundary.
export type { GraphNodeData, GraphEdge };
