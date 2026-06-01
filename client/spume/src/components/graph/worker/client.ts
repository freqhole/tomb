// graph2/worker/client.ts — typed wrapper around the walker web worker.

import WalkerWorker from "./walker.worker?worker";
import type {
  MainToWorker,
  WorkerToMain,
  VisibleNode,
  TopologyEdge,
} from "./messages";
import type { WalkGraph, WalkNode, WalkEdge } from "../types";

export type TopologyListener = (nodes: VisibleNode[], edges: TopologyEdge[]) => void;
export type FrameListener = (positions: Float32Array, alpha: number) => void;
export type VisibleIdsListener = (ids: string[]) => void;

export interface WalkerClient {
  init(graph: WalkGraph, pivot: string, width: number, height: number, breadcrumb?: string[]): void;
  expand(nodeId: string): void;
  resize(width: number, height: number): void;
  merge(addNodes: WalkNode[], addEdges: WalkEdge[]): void;
  remove(nodeIds: string[]): void;
  /** mark a set of node ids as hidden in the worker. they're skipped
   *  in the visible set so the sim re-lays out without them. pass an
   *  empty array to clear. breadcrumb nodes are never hidden. */
  setHidden(nodeIds: string[]): void;
  repivot(nodeId: string, resetBreadcrumb?: boolean): void;
  setPaused(paused: boolean): void;
  /** debug overlay — push partial tuning patch to the worker. */
  setTuning(tuning: Partial<{
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
  }>): void;
  back(): void;
  /** point hit-test in WORLD coordinates. `k` is the viewport scale
   *  (defaults to 1) so the worker can apply a 12-screen-px minimum
   *  hit radius for clickability when zoomed out. */
  hitTest(x: number, y: number, k?: number): Promise<string | null>;
  /** returns the bounding box of currently visible sim nodes, or null if empty */
  getBounds(): Promise<{ minX: number; minY: number; maxX: number; maxY: number } | null>;
  onTopology(fn: TopologyListener): () => void;
  onFrame(fn: FrameListener): () => void;
  onVisibleIds(fn: VisibleIdsListener): () => void;
  dispose(): void;
}

export function createWalkerClient(): WalkerClient {
  const worker = new WalkerWorker();

  const topologyListeners = new Set<TopologyListener>();
  const frameListeners = new Set<FrameListener>();
  const visibleIdsListeners = new Set<VisibleIdsListener>();

  let hitReqId = 0;
  const hitCallbacks = new Map<number, (id: string | null) => void>();

  let boundsReqId = 0;
  const boundsCallbacks = new Map<
    number,
    (bounds: { minX: number; minY: number; maxX: number; maxY: number } | null) => void
  >();

  function post(msg: MainToWorker) {
    worker.postMessage(msg);
  }

  worker.onmessage = (evt: MessageEvent<WorkerToMain>) => {
    const msg = evt.data;
    switch (msg.type) {
      case "topology":
        for (const fn of topologyListeners) fn(msg.nodes, msg.edges);
        break;
      case "frame":
        for (const fn of frameListeners) fn(msg.positions, msg.alpha);
        break;
      case "hitResult": {
        const cb = hitCallbacks.get(msg.reqId);
        if (cb) { cb(msg.nodeId); hitCallbacks.delete(msg.reqId); }
        break;
      }
      case "boundsResult": {
        const cb = boundsCallbacks.get(msg.reqId);
        if (cb) { cb(msg.bounds); boundsCallbacks.delete(msg.reqId); }
        break;
      }
      case "visibleIds":
        for (const fn of visibleIdsListeners) fn(msg.ids);
        break;
      case "ready":
        break;
    }
  };

  return {
    init(graph, pivot, width, height, breadcrumb) {
      post({ type: "init", graph, pivot, width, height, breadcrumb });
    },
    expand(nodeId) {
      post({ type: "expand", nodeId });
    },
    resize(width, height) {
      post({ type: "resize", width, height });
    },
    merge(addNodes, addEdges) {
      post({ type: "merge", addNodes, addEdges });
    },
    remove(nodeIds) {
      post({ type: "remove", nodeIds });
    },
    setHidden(nodeIds) {
      post({ type: "setHidden", nodeIds });
    },
    repivot(nodeId, resetBreadcrumb) {
      post({ type: "repivot", nodeId, resetBreadcrumb });
    },
    setPaused(paused) {
      post({ type: "setPaused", paused });
    },
    setTuning(tuning) {
      post({ type: "setTuning", tuning });
    },
    back() {
      post({ type: "back" });
    },
    hitTest(x, y, k = 1) {
      return new Promise<string | null>((resolve) => {
        const reqId = ++hitReqId;
        hitCallbacks.set(reqId, resolve);
        post({ type: "hitTest", reqId, x, y, k });
      });
    },
    getBounds() {
      return new Promise((resolve) => {
        const reqId = ++boundsReqId;
        boundsCallbacks.set(reqId, resolve);
        post({ type: "getBounds", reqId });
      });
    },
    onTopology(fn) {
      topologyListeners.add(fn);
      return () => topologyListeners.delete(fn);
    },
    onFrame(fn) {
      frameListeners.add(fn);
      return () => frameListeners.delete(fn);
    },
    onVisibleIds(fn) {
      visibleIdsListeners.add(fn);
      return () => visibleIdsListeners.delete(fn);
    },
    dispose() {
      worker.terminate();
    },
  };
}
