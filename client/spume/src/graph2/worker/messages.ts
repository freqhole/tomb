// graph2/worker/messages.ts — slim message protocol between main thread and walker worker.

import type { WalkGraph, NodeRole } from "../types";

// ---- visible node descriptor (sent in topology messages) -------------------

export interface VisibleNode {
  id: string;
  role: NodeRole;
  label: string;
  childCount: number;
  isPivot: boolean;
  /** true if this node is on the breadcrumb path from root to pivot */
  isBreadcrumb: boolean;
  imageUrl?: string;
}

export interface TopologyEdge {
  /** index into the VisibleNode array from the most recent topology message */
  sourceIdx: number;
  targetIdx: number;
  /** breadcrumb edges are drawn differently (highlighted path) */
  isBreadcrumb: boolean;
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

export type MainToWorker = MsgInit | MsgExpand | MsgResize | MsgHitTest;

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

export type WorkerToMain = MsgReady | MsgTopology | MsgFrame | MsgHitResult;
