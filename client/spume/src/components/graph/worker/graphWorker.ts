/// <reference lib="webworker" />
// graphWorker — dedicated web worker hosting the deterministic
// graph layout pipeline.
//
// owns:
//  - the current node + link payload (kept across init/update)
//  - the active pivot id
//  - the most-recent layout snapshot (positions per visible node)
//  - the animator that lerps from snapshot-to-snapshot when the
//    pivot or topology changes
//  - the quadtree hit cache (rebuilt lazily after each tick)
//  - the relation-edge derivation pipeline (cached from sim era;
//    the layout itself doesn't use links, but the main thread still
//    consumes derived edges for ui + cross-tier rendering)
//
// see [docs/graph-deterministic-layout-plan.md](../../../../../../../docs/graph-deterministic-layout-plan.md)

import { buildRelationEdges } from "../relations";
import { createHitTreeCache } from "./hit/hitTreeCache";
import { createAnimator } from "./graphLayout/animate";
import { graphLayout } from "./graphLayout/graphLayout";
import type { LayoutEdge, LayoutNode } from "./graphLayout/types";
import type {
  AlbumNodeData,
  ArtistNodeData,
  GraphEdge,
  GraphNodeData,
} from "../types";
import type {
  EdgeDeriveConfig,
  MainToWorker,
  SimConfig,
  SimNodeInit,
  WorkerToMain,
} from "./messages";

const ctx: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

function post(msg: WorkerToMain, transfer: Transferable[] = []) {
  ctx.postMessage(msg, transfer);
}

// node shape the hit-tree cache + position emitter operate on. owns
// the live x/y for each input node, updated on every animator tick.
interface WorkerNode {
  id: string;
  kind: "album" | "artist" | "hub";
  x: number;
  y: number;
}

// ---------- state -------------------------------------------------------

let config: SimConfig = { nodeSize: 56, width: 800, height: 600 };
let nodes: WorkerNode[] = [];
let nodeInits: SimNodeInit[] = [];
let pivotId: string | null = null;
const stubToggles = new Map<string, number>();

// derived edges (cross-tier, navigation). the deterministic layout
// walks structural edges via the same adjacency so we don't keep a
// separate "structural-only" list; the full derived edges feed both
// the layout's bfs and the main thread's renderer.
let edgeConfig: EdgeDeriveConfig | null = null;
let derivedEdges: GraphEdge[] = [];
let edgeNodes: GraphNodeData[] = [];

// uninitialized-position sentinel. nodes start at NaN until the
// first layout runs; snapshotPositions() then omits them from the
// animator's `from` map so they snap-fade-in at their destination
// rather than streaking across the canvas from an arbitrary point.
const UNINIT = Number.NaN;

const animator = createAnimator();
const hitCache = createHitTreeCache<WorkerNode>();
let tick = 0;
let frameTimer: ReturnType<typeof setInterval> | null = null;

// ---------- helpers -----------------------------------------------------

function toLayoutNodes(): LayoutNode[] {
  return nodeInits.map((n) => ({
    id: n.id,
    kind: n.kind,
    albumCount: n.albumCount,
  }));
}

function toLayoutEdges(): LayoutEdge[] {
  // prefer derived edges when edge derivation is on; fall back to
  // whatever the most recent update passed in via `simLinks`.
  if (derivedEdges.length > 0) {
    return derivedEdges.map((e) => ({
      source: typeof e.source === "string" ? e.source : e.source.id,
      target: typeof e.target === "string" ? e.target : e.target.id,
    }));
  }
  return lastLinks.map((l) => ({ source: l.source, target: l.target }));
}

// retained-only for the no-derive fallback path.
let lastLinks: { source: string; target: string }[] = [];

function ensurePivot(): string | null {
  if (pivotId && nodes.some((n) => n.id === pivotId)) return pivotId;
  // desired pivot isn't present in the node list (yet). DON'T
  // overwrite `pivotId` here — a subsequent update may bring the
  // node in, and we want the very next relayout to honor the
  // original request. compute a temporary fallback for *this*
  // pass only.
  const ledges = toLayoutEdges();
  if (ledges.length > 0) {
    const degree = new Map<string, number>();
    for (const e of ledges) {
      degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
      degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
    }
    // prefer a hub-kind node with neighbors (matches the historical
    // "start on a hub triangle" feel); fall back to any node with
    // neighbors.
    let bestHub: string | null = null;
    let bestHubDeg = 0;
    let bestAny: string | null = null;
    let bestAnyDeg = 0;
    for (const n of nodes) {
      const d = degree.get(n.id) ?? 0;
      if (d === 0) continue;
      if (n.kind === "hub" && d > bestHubDeg) {
        bestHubDeg = d;
        bestHub = n.id;
      }
      if (d > bestAnyDeg) {
        bestAnyDeg = d;
        bestAny = n.id;
      }
    }
    const fallback = bestHub ?? bestAny;
    if (fallback) return fallback;
  }
  // no edges (or no connected nodes): fall back to first hub, then
  // first node, so the layout still has *some* center.
  const firstHub = nodes.find((n) => n.kind === "hub");
  return firstHub?.id ?? nodes[0]?.id ?? null;
}

function snapshotPositions(): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  for (const n of nodes) {
    if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) continue;
    out.set(n.id, { x: n.x, y: n.y });
  }
  return out;
}

function relayout(): {
  positions: Map<string, { x: number; y: number }>;
  order: string[];
} {
  const pivot = ensurePivot();
  if (!pivot) return { positions: new Map(), order: [] };
  const lnodes = toLayoutNodes();
  const ledges = toLayoutEdges();
  const layout = graphLayout(lnodes, ledges, {
    pivotId: pivot,
    viewport: { width: config.width, height: config.height },
    nodeSize: config.nodeSize,
    stubToggles,
  });
  // every visible node gets its computed layout position. invisible
  // nodes (disconnected from pivot in the edge graph, or trimmed by
  // hopHorizon) get a deterministic outer-ring slot so they stay
  // browsable instead of stacking onto pivot. ring index + angle are
  // derived from a stable hash of the node id so re-layouts don't
  // jitter them and so the same node lands in the same spot every
  // time. packing is intentionally dense (small step, many per ring)
  // because in the current data model most entity nodes have no
  // structural edge to the scaffold and would otherwise dominate the
  // viewport.
  const pivotPos = layout.positions.get(pivot) ?? {
    x: config.width / 2,
    y: config.height / 2,
  };
  const baseSize = config.nodeSize ?? 56;
  // ring 0 sits just past the deepest visible bloom ring; subsequent
  // rings step out by roughly one node diameter so neighbors don't
  // physically overlap. count per ring scales with circumference so
  // packing density stays roughly constant.
  const minDim = Math.min(config.width, config.height);
  const orphanRing0 = Math.max(minDim * 0.32, baseSize * 3.2);
  const orphanRingStep = baseSize * 1.1;
  const orphansPerRing = (ring: number): number => {
    const r = orphanRing0 + ring * orphanRingStep;
    return Math.max(8, Math.floor((2 * Math.PI * r) / (baseSize * 1.05)));
  };
  let orphanIdx = 0;
  let orphanRing = 0;
  let orphanRingCap = orphansPerRing(0);
  let orphanRingStart = 0;
  const out = new Map<string, { x: number; y: number }>();
  for (const n of nodes) {
    const p = layout.positions.get(n.id);
    if (p) {
      out.set(n.id, { x: p.x, y: p.y });
      continue;
    }
    if (orphanIdx - orphanRingStart >= orphanRingCap) {
      orphanRing++;
      orphanRingStart = orphanIdx;
      orphanRingCap = orphansPerRing(orphanRing);
    }
    const slot = orphanIdx - orphanRingStart;
    const r = orphanRing0 + orphanRing * orphanRingStep;
    // golden-angle offset per ring so adjacent rings don't line up
    // radially; per-id hash jitter within the slot so reorderings
    // don't shuffle everyone.
    const idHash = hashStringToUnit(n.id);
    const angle =
      (slot / orphanRingCap) * Math.PI * 2 +
      orphanRing * 2.39996 +
      idHash * ((Math.PI * 2) / orphanRingCap);
    out.set(n.id, {
      x: pivotPos.x + Math.cos(angle) * r,
      y: pivotPos.y + Math.sin(angle) * r,
    });
    orphanIdx++;
  }
  return { positions: out, order: nodes.map((n) => n.id) };
}

// stable string → [0,1) hash. fnv-1a 32-bit, scaled. used to give
// orphan nodes deterministic angle jitter inside their ring slot.
function hashStringToUnit(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) % 1000) / 1000;
}

function emitPositions(): void {
  const tickStart = performance.now();
  performance.mark("graph-tick-start");
  const frame = animator.tick(performance.now());
  // copy into a fresh Float32Array (worker.tick already returns one)
  // and apply to local nodes so hit-test sees the latest geometry.
  for (let i = 0; i < nodes.length; i++) {
    nodes[i].x = frame.buf[i * 2];
    nodes[i].y = frame.buf[i * 2 + 1];
  }
  tick++;
  hitCache.markStale();
  const tickMs = performance.now() - tickStart;
  post(
    { type: "positions", buf: frame.buf, tick, alpha: frame.done ? 0 : 1, tickMs },
    [frame.buf.buffer],
  );
  performance.measure("graph-tick", "graph-tick-start");
  performance.clearMarks("graph-tick-start");
  if (frame.done) stopFrameTimer();
}

function startFrameTimer(): void {
  if (frameTimer != null) return;
  // ~60Hz. dedicated workers don't have requestAnimationFrame; this
  // is the standard substitute. cheap when the animator is at rest
  // since we stop the interval once it's done.
  frameTimer = setInterval(emitPositions, 16);
}

function stopFrameTimer(): void {
  if (frameTimer == null) return;
  clearInterval(frameTimer);
  frameTimer = null;
}

function rePivot(durationMs?: number): void {
  const from: Map<string, { x: number; y: number }> = snapshotPositions();
  const to = relayout();
  animator.start(
    { order: nodes.map((n) => n.id), positions: from },
    { order: to.order, positions: to.positions },
    durationMs,
  );
  startFrameTimer();
  post({
    type: "topology",
    nodeCount: nodes.length,
    edgeCount: derivedEdges.length || lastLinks.length,
    alpha: 1,
  });
}

function mergeNodes(incoming: SimNodeInit[]): WorkerNode[] {
  const prev = new Map(nodes.map((n) => [n.id, n] as const));
  return incoming.map((n) => {
    const p = prev.get(n.id);
    if (p) {
      p.kind = n.kind;
      return p;
    }
    return {
      id: n.id,
      kind: n.kind,
      x: n.x ?? UNINIT,
      y: n.y ?? UNINIT,
    };
  });
}

// ---------- edge derivation (carried over from sim era) -----------------

function adaptNodesForEdgeDerivation(incoming: SimNodeInit[]): GraphNodeData[] {
  return incoming.map((n) => {
    const tags = (n.tagLabels ?? []).map((label) => ({ label, weight: 0 }));
    if (n.kind === "artist" || n.kind === "hub") {
      return {
        id: n.id,
        kind: "artist",
        artistId: n.artistId ?? n.id,
        name: n.name ?? "",
        abbreviation: "",
        imageUrl: null,
        image: null,
        albumCount: 0,
        genres: n.genres ?? [],
        tags,
        moods: n.moods ?? [],
        styles: n.styles ?? [],
        label: n.label ?? null,
        era: n.era ?? null,
        isFavorite: n.isFavorite,
      } satisfies ArtistNodeData;
    }
    return {
      id: n.id,
      kind: "album",
      title: "",
      artistId: n.artistId ?? "",
      artistName: n.artistName ?? "",
      year: null,
      imageUrl: null,
      image: null,
      genres: n.genres ?? [],
      tags,
      moods: n.moods ?? [],
      styles: n.styles ?? [],
      label: n.label ?? null,
      era: n.era ?? null,
      trackCount: 0,
      totalDurationSec: 0,
      isFavorite: n.isFavorite,
    } satisfies AlbumNodeData;
  });
}

function deriveAndEmitEdges(): void {
  if (!edgeConfig) return;
  performance.mark("graph-edges-start");
  derivedEdges = buildRelationEdges(edgeNodes, {
    perGroupFanout: edgeConfig.fanout,
    minGroupSize: edgeConfig.minGroupSize,
    relatedArtists: edgeConfig.relatedArtists,
  });
  performance.measure("graph-edges-build", "graph-edges-start");
  performance.clearMarks("graph-edges-start");
  post({ type: "edges", edges: derivedEdges });
}

// ---------- message dispatch --------------------------------------------

ctx.addEventListener("message", (e: MessageEvent<MainToWorker>) => {
  const msg = e.data;
  switch (msg.type) {
    case "init": {
      config = msg.config;
      nodeInits = msg.nodes;
      nodes = mergeNodes(msg.nodes);
      if (msg.edgeConfig) {
        edgeConfig = msg.edgeConfig;
        edgeNodes = adaptNodesForEdgeDerivation(msg.nodes);
        deriveAndEmitEdges();
      } else {
        edgeConfig = null;
        derivedEdges = [];
        lastLinks = msg.links.map((l) => ({ source: l.source, target: l.target }));
      }
      // honor an explicit initial pivot from the parent (e.g. the
      // library view's active remote). when omitted, ensurePivot()
      // falls back to a smart default.
      pivotId = msg.pivotId ?? null;
      stubToggles.clear();
      hitCache.markStale();
      post({ type: "ready" });
      rePivot();
      break;
    }
    case "update": {
      nodeInits = msg.nodes;
      nodes = mergeNodes(msg.nodes);
      if (msg.edgeConfig) {
        edgeConfig = msg.edgeConfig;
        edgeNodes = adaptNodesForEdgeDerivation(msg.nodes);
        deriveAndEmitEdges();
      } else {
        edgeConfig = null;
        derivedEdges = [];
        lastLinks = msg.links.map((l) => ({ source: l.source, target: l.target }));
      }
      hitCache.markStale();
      // a `quiet` update means: don't re-pivot, just absorb the new
      // node set. emit one frame at current geometry so the main
      // thread sees newcomers (placed off-screen until next layout).
      if (msg.mode === "quiet") {
        emitOneStaticFrame();
      } else {
        rePivot();
      }
      break;
    }
    case "setPivot": {
      pivotId = msg.nodeId;
      stubToggles.clear();
      rePivot();
      break;
    }
    case "setStubToggle": {
      stubToggles.set(msg.parentId, msg.index);
      rePivot();
      break;
    }
    case "resize": {
      config.width = msg.width;
      config.height = msg.height;
      if (msg.reheat) rePivot();
      break;
    }
    case "setEnabledKinds": {
      // edge filtering still flows through; layout consumes adjacency
      // built from `derivedEdges`, so a kind change can shift which
      // edges contribute to the bfs walk.
      if (edgeConfig) {
        edgeConfig = { ...edgeConfig, enabledKinds: msg.kinds };
        // re-derive with the new filter to refresh adjacency.
        deriveAndEmitEdges();
        rePivot();
      }
      break;
    }
    case "return": {
      // no buffer pool; new Float32Array per tick. let GC reclaim.
      void msg;
      break;
    }
    case "hitTest": {
      performance.mark("graph-hittest-start");
      const tree = hitCache.ensure(nodes);
      const hit = tree.find(msg.x, msg.y, msg.radius);
      post({ type: "hitResult", id: msg.id, nodeId: hit ? hit.id : null });
      performance.measure("graph-hittest", "graph-hittest-start");
      performance.clearMarks("graph-hittest-start");
      break;
    }
    case "hitRect": {
      performance.mark("graph-hitrect-start");
      const tree = hitCache.ensure(nodes);
      const minX = Math.min(msg.x0, msg.x1);
      const maxX = Math.max(msg.x0, msg.x1);
      const minY = Math.min(msg.y0, msg.y1);
      const maxY = Math.max(msg.y0, msg.y1);
      const out: string[] = [];
      tree.visit((node, nx0, ny0, nx1, ny1) => {
        if (!("length" in node) || !node.length) {
          let n: { data: WorkerNode; next?: { data: WorkerNode; next?: unknown } } | undefined =
            node as unknown as { data: WorkerNode; next?: { data: WorkerNode; next?: unknown } };
          do {
            const d = n.data;
            const px = d.x;
            const py = d.y;
            if (px >= minX && px <= maxX && py >= minY && py <= maxY) {
              out.push(d.id);
            }
            n = n.next as typeof n;
          } while (n);
        }
        return nx0 > maxX || nx1 < minX || ny0 > maxY || ny1 < minY;
      });
      post({ type: "hitRectResult", id: msg.id, nodeIds: out });
      performance.measure("graph-hitrect", "graph-hitrect-start");
      performance.clearMarks("graph-hitrect-start");
      break;
    }
    // legacy messages from the sim era; intentional no-ops. the
    // deterministic layout doesn't drag, doesn't reheat, doesn't
    // tune. callers stay compiling.
    case "pin":
    case "unpin":
    case "alphaTarget":
    case "pause":
    case "resume":
    case "reheat":
    case "tuning": {
      break;
    }
    case "quit": {
      stopFrameTimer();
      ctx.close();
      break;
    }
    default: {
      const _exhaustive: never = msg;
      void _exhaustive;
    }
  }
});

function emitOneStaticFrame(): void {
  // build a buffer with current node positions; no animation.
  const buf = new Float32Array(nodes.length * 2);
  for (let i = 0; i < nodes.length; i++) {
    buf[i * 2] = nodes[i].x;
    buf[i * 2 + 1] = nodes[i].y;
  }
  tick++;
  hitCache.markStale();
  post(
    { type: "positions", buf, tick, alpha: 0, tickMs: 0 },
    [buf.buffer],
  );
  post({
    type: "topology",
    nodeCount: nodes.length,
    edgeCount: derivedEdges.length || lastLinks.length,
    alpha: 0,
  });
}
