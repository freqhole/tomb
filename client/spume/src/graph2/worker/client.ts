// graph2/worker/client.ts — typed wrapper around the walker web worker.

import WalkerWorker from "./walker.worker?worker";
import type {
  MainToWorker,
  WorkerToMain,
  VisibleNode,
  TopologyEdge,
} from "./messages";
import type { WalkGraph } from "../types";

export type TopologyListener = (nodes: VisibleNode[], edges: TopologyEdge[]) => void;
export type FrameListener = (positions: Float32Array, alpha: number) => void;

export interface WalkerClient {
  init(graph: WalkGraph, pivot: string, width: number, height: number, breadcrumb?: string[]): void;
  expand(nodeId: string): void;
  resize(width: number, height: number): void;
  hitTest(x: number, y: number): Promise<string | null>;
  onTopology(fn: TopologyListener): () => void;
  onFrame(fn: FrameListener): () => void;
  dispose(): void;
}

export function createWalkerClient(): WalkerClient {
  const worker = new WalkerWorker();

  const topologyListeners = new Set<TopologyListener>();
  const frameListeners = new Set<FrameListener>();

  let hitReqId = 0;
  const hitCallbacks = new Map<number, (id: string | null) => void>();

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
    hitTest(x, y) {
      return new Promise<string | null>((resolve) => {
        const reqId = ++hitReqId;
        hitCallbacks.set(reqId, resolve);
        post({ type: "hitTest", reqId, x, y });
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
    dispose() {
      worker.terminate();
    },
  };
}
