// graphWorkerClient — typed wrapper around the graph compute worker.
//
// owns:
//  - the `Worker` instance (vite-bundled via `?worker` import)
//  - the readiness promise (resolves after the worker posts `ready`)
//  - request/response correlation for hit-test queries (each call
//    gets a monotonically-increasing id; the worker echoes it back)
//  - dispatch of position / topology / edges messages to listeners
//
// position-buffer recycling: `onPositions` listeners receive borrowed
// ownership of the `Float32Array` and MUST call `release(buf)` after
// they're done reading it. callers that defer drawing to rAF should
// coalesce: if a newer buffer arrives before the rAF fires, release
// the older one without drawing. when nobody is listening, the
// client auto-releases on the receive side to keep ticks flowing.
//
// see [docs/graph-web-worker-plan.md](../../../../../../../docs/graph-web-worker-plan.md)

import GraphWorker from "./graphWorker?worker";
import type {
  EdgeDeriveConfig,
  GraphEdge,
  MainToWorker,
  MsgEdges,
  MsgPositions,
  MsgTopology,
  SimConfig,
  SimLinkInit,
  SimNodeInit,
  TuningOverrides,
  UpdateMode,
  WorkerToMain,
} from "./messages";
export type { TuningOverrides };
import type { RelationKind } from "../types";
import { timing } from "../perfLog";

export type PositionsListener = (
  buf: Float32Array,
  tick: number,
  alpha: number,
) => void;
export type EdgesListener = (edges: GraphEdge[]) => void;
export type TopologyListener = (info: {
  nodeCount: number;
  edgeCount: number;
  alpha: number;
}) => void;

export interface GraphWorkerClient {
  /** resolves once the worker has processed `init` and posted `ready`. */
  ready(): Promise<void>;
  init(
    nodes: SimNodeInit[],
    links: SimLinkInit[],
    config: SimConfig,
    edgeConfig?: EdgeDeriveConfig,
    relationStrengths?: Record<string, number>,
  ): void;
  update(
    nodes: SimNodeInit[],
    links: SimLinkInit[],
    mode: UpdateMode,
    edgeConfig?: EdgeDeriveConfig,
    relationStrengths?: Record<string, number>,
  ): void;
  resize(width: number, height: number, reheat: boolean): void;
  pin(nodeId: string, x: number, y: number): void;
  unpin(nodeId: string): void;
  /** mirrors d3-force `simulation.alphaTarget(target).restart()` */
  alphaTarget(target: number, restart?: boolean): void;
  pause(): void;
  resume(alpha?: number): void;
  reheat(alpha: number): void;
  /** phase 4: change which relation kinds the sim uses without
   *  resending nodes. worker re-filters its cached derived edges
   *  and reheats with `mode` (default "nudge"). */
  setEnabledKinds(kinds: RelationKind[] | undefined, mode?: UpdateMode): void;
  /** debug: push live force-tuning overrides; worker rebuilds sim
   *  immediately. send `{}` to reset all overrides to compiled-in
   *  defaults. */
  sendTuning(overrides: TuningOverrides): void;
  /** debug: push live force-tuning overrides; worker rebuilds sim
   *  immediately. send `{}` to reset all overrides to compiled-in
   *  defaults. */
  sendTuning(overrides: TuningOverrides): void;
  hitTest(x: number, y: number, radius: number, signal?: AbortSignal): Promise<string | null>;
  hitRect(x0: number, y0: number, x1: number, y1: number, signal?: AbortSignal): Promise<string[]>;
  /** subscribe to position ticks. listener owns `buf` and MUST call
   *  `release(buf)` once done. when there are no listeners the
   *  client auto-releases incoming buffers so the worker keeps
   *  ticking. */
  onPositions(listener: PositionsListener): () => void;
  /** hand a previously-received positions buffer back to the worker
   *  for reuse. zero-copy via transfer list. safe to call even after
   *  the buffer's ArrayBuffer is detached (no-op in that case). */
  release(buf: Float32Array): void;
  onEdges(listener: EdgesListener): () => void;
  onTopology(listener: TopologyListener): () => void;
  dispose(): void;
}

export function createGraphWorkerClient(): GraphWorkerClient {
  const worker = new GraphWorker();

  let readyResolve: (() => void) | null = null;
  const readyPromise = new Promise<void>((resolve) => {
    readyResolve = resolve;
  });

  const positionsListeners = new Set<PositionsListener>();
  const edgesListeners = new Set<EdgesListener>();
  const topologyListeners = new Set<TopologyListener>();

  let nextHitId = 1;
  const pendingHitTests = new Map<number, (id: string | null) => void>();
  const pendingHitRects = new Map<number, (ids: string[]) => void>();

  function post(msg: MainToWorker, transfer: Transferable[] = []) {
    worker.postMessage(msg, transfer);
  }

  function safeRelease(buf: Float32Array) {
    // ArrayBuffer may already be detached (e.g. release called twice).
    // postMessage with a detached transfer throws — guard it.
    if (buf.buffer.byteLength === 0) return;
    try {
      post({ type: "return", buf }, [buf.buffer]);
    } catch {
      // ignore: buffer was detached by another path.
    }
  }

  worker.addEventListener("message", (e: MessageEvent<WorkerToMain>) => {
    const msg = e.data;
    switch (msg.type) {
      case "ready": {
        readyResolve?.();
        readyResolve = null;
        break;
      }
      case "topology": {
        const info: MsgTopology = msg;
        for (const l of topologyListeners) {
          l({
            nodeCount: info.nodeCount,
            edgeCount: info.edgeCount,
            alpha: info.alpha,
          });
        }
        break;
      }
      case "positions": {
        const pos: MsgPositions = msg;
        if (typeof pos.tickMs === "number") {
          timing("worker.tick.ms", pos.tickMs);
        }
        if (positionsListeners.size === 0) {
          safeRelease(pos.buf);
          break;
        }
        for (const l of positionsListeners) {
          l(pos.buf, pos.tick, pos.alpha);
        }
        // listeners must call release() when done.
        break;
      }
      case "edges": {
        const e2: MsgEdges = msg;
        for (const l of edgesListeners) l(e2.edges);
        break;
      }
      case "hitResult": {
        const cb = pendingHitTests.get(msg.id);
        if (cb) {
          pendingHitTests.delete(msg.id);
          cb(msg.nodeId);
        }
        break;
      }
      case "hitRectResult": {
        const cb = pendingHitRects.get(msg.id);
        if (cb) {
          pendingHitRects.delete(msg.id);
          cb(msg.nodeIds);
        }
        break;
      }
      default: {
        const _exhaustive: never = msg;
        void _exhaustive;
      }
    }
  });

  return {
    ready: () => readyPromise,
    init(nodes, links, config, edgeConfig, relationStrengths) {
      post({ type: "init", nodes, links, config, edgeConfig, relationStrengths });
    },
    update(nodes, links, mode, edgeConfig, relationStrengths) {
      post({ type: "update", nodes, links, mode, edgeConfig, relationStrengths });
    },
    resize(width, height, reheat) {
      post({ type: "resize", width, height, reheat });
    },
    pin(nodeId, x, y) {
      post({ type: "pin", nodeId, x, y });
    },
    unpin(nodeId) {
      post({ type: "unpin", nodeId });
    },
    alphaTarget(target, restart) {
      post({ type: "alphaTarget", target, restart });
    },
    pause() {
      post({ type: "pause" });
    },
    resume(alpha) {
      post({ type: "resume", alpha });
    },
    reheat(alpha) {
      post({ type: "reheat", alpha });
    },
    setEnabledKinds(kinds, mode) {
      post({ type: "setEnabledKinds", kinds, mode });
    },
    sendTuning(overrides) {
      post({ type: "tuning", overrides });
    },
    hitTest(x, y, radius, signal) {
      if (signal?.aborted) return Promise.reject(new DOMException("aborted", "AbortError"));
      const id = nextHitId++;
      return new Promise<string | null>((resolve, reject) => {
        const onAbort = () => {
          pendingHitTests.delete(id);
          signal?.removeEventListener("abort", onAbort);
          reject(new DOMException("aborted", "AbortError"));
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        pendingHitTests.set(id, (nodeId) => {
          signal?.removeEventListener("abort", onAbort);
          resolve(nodeId);
        });
        post({ type: "hitTest", id, x, y, radius });
      });
    },
    hitRect(x0, y0, x1, y1, signal) {
      if (signal?.aborted) return Promise.reject(new DOMException("aborted", "AbortError"));
      const id = nextHitId++;
      return new Promise<string[]>((resolve, reject) => {
        const onAbort = () => {
          pendingHitRects.delete(id);
          signal?.removeEventListener("abort", onAbort);
          reject(new DOMException("aborted", "AbortError"));
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        pendingHitRects.set(id, (ids) => {
          signal?.removeEventListener("abort", onAbort);
          resolve(ids);
        });
        post({ type: "hitRect", id, x0, y0, x1, y1 });
      });
    },
    onPositions(listener) {
      positionsListeners.add(listener);
      return () => {
        positionsListeners.delete(listener);
      };
    },
    release: safeRelease,
    onEdges(listener) {
      edgesListeners.add(listener);
      return () => {
        edgesListeners.delete(listener);
      };
    },
    onTopology(listener) {
      topologyListeners.add(listener);
      return () => {
        topologyListeners.delete(listener);
      };
    },
    dispose() {
      post({ type: "quit" });
      worker.terminate();
      positionsListeners.clear();
      edgesListeners.clear();
      topologyListeners.clear();
      pendingHitTests.clear();
      pendingHitRects.clear();
    },
  };
}
