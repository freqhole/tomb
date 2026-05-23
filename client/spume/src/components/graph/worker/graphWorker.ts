/// <reference lib="webworker" />
// graphWorker — dedicated web worker hosting the graph viz compute
// pipeline (force-sim, quadtree hit-testing, relation-edge derivation).
//
// PHASE 2: owns the d3-force simulation. ticks the sim, writes node
// positions into a ping-pong `Float32Array` buffer, and transfers
// ownership of the buffer to the main thread on each tick. the main
// thread renders + returns the buffer for reuse.
//
// quadtree hit-testing moves here in phase 3; relation-edge
// derivation in phase 4.
//
// see [docs/graph-web-worker-plan.md](../../../../../../../docs/graph-web-worker-plan.md)

import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { quadtree, type Quadtree } from "d3-quadtree";
import { buildRelationEdges } from "../relations";
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
  SimLinkInit,
  SimNodeInit,
  UpdateMode,
  WorkerToMain,
} from "./messages";

const ctx: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

function post(msg: WorkerToMain, transfer: Transferable[] = []) {
  ctx.postMessage(msg, transfer);
}

// sim-side node + link types. nodes carry kind so collide radius can
// vary; links keep the optional weight from the main thread for link
// strength scaling.
type SimNode = SimNodeInit & SimulationNodeDatum;
type SimLink = SimulationLinkDatum<SimNode> & {
  weight?: number;
};

// ----- sim state --------------------------------------------------------

let config: SimConfig = { nodeSize: 56, width: 800, height: 600 };
let sim: Simulation<SimNode, SimLink> | null = null;
let simNodes: SimNode[] = [];
let simLinks: SimLink[] = [];

// phase 4: edge derivation state. when `edgeConfig` is provided on
// init/update we keep the full derived edge list cached so a
// `setEnabledKinds` message can re-filter the sim-link subset
// without re-deriving edges from scratch.
let edgeConfig: EdgeDeriveConfig | null = null;
let derivedEdges: GraphEdge[] = [];
/** node payloads from the most recent init/update — kept around so
 *  edges can be re-derived if needed. references the same SimNode
 *  objects, just typed as GraphNodeData for `buildRelationEdges`. */
let edgeNodes: GraphNodeData[] = [];

// ping-pong position buffers. owned by the worker except while a
// `positions` message is in-flight to the main thread (where the
// ArrayBuffer is detached on this side). when main returns a buffer
// via `{type:"return"}` it goes back into the pool.
const bufPool: Float32Array[] = [];
let tick = 0;

// quadtree for hit-testing. rebuilt lazily on first query after the
// sim emits a fresh position frame (or topology change). marking
// stale on every tick is cheap; the rebuild only happens when the
// main thread actually asks (pointer hover / down / contextmenu /
// lasso).
let hitTree: Quadtree<SimNode> | null = null;
let hitTreeStale = true;

function ensureHitTree(): Quadtree<SimNode> {
  if (hitTree && !hitTreeStale) return hitTree;
  performance.mark("graph-hittree-start");
  hitTree = quadtree<SimNode>()
    .x((d) => d.x ?? 0)
    .y((d) => d.y ?? 0)
    .addAll(simNodes);
  hitTreeStale = false;
  performance.measure("graph-hittree-build", "graph-hittree-start");
  performance.clearMarks("graph-hittree-start");
  return hitTree;
}

function obtainBuf(n: number): Float32Array {
  for (let i = bufPool.length - 1; i >= 0; i--) {
    const candidate = bufPool[i];
    if (candidate.length === n * 2) {
      bufPool.splice(i, 1);
      return candidate;
    }
  }
  return new Float32Array(n * 2);
}

function releaseToPool(buf: Float32Array) {
  // cap pool at 4 so we don't accumulate stale-sized buffers across
  // topology changes that resize the position array.
  if (buf.length === simNodes.length * 2 && bufPool.length < 4) {
    bufPool.push(buf);
  }
}

function emitPositions() {
  performance.mark("graph-tick-start");
  const buf = obtainBuf(simNodes.length);
  for (let i = 0; i < simNodes.length; i++) {
    const n = simNodes[i];
    buf[i * 2] = n.x ?? 0;
    buf[i * 2 + 1] = n.y ?? 0;
  }
  tick++;
  hitTreeStale = true;
  post({ type: "positions", buf, tick, alpha: sim?.alpha() ?? 0 }, [buf.buffer]);
  performance.measure("graph-tick", "graph-tick-start");
  performance.clearMarks("graph-tick-start");
}

// ----- build / rebuild --------------------------------------------------

function buildSim(mode: UpdateMode) {
  performance.mark("graph-build-start");
  if (sim) sim.stop();

  const sz = config.nodeSize;
  // dense libraries pile nodes on top of each other even with collide
  // enabled, because link + charge balance was tuned for ~hundreds.
  // scale the layout out as node count grows so 2k+ node graphs
  // spread their clusters apart enough to read. breakpoints are
  // gentle so small libraries don't suddenly explode outward on a
  // few new nodes.
  const nCount = simNodes.length;
  const densityMul = nCount >= 3000 ? 1.6 : nCount >= 1500 ? 1.35 : nCount >= 800 ? 1.15 : 1;
  const linkDist = sz * 2.8 * densityMul;
  const chargeStr = -sz * 8 * densityMul;
  const collideAlbum = sz * 0.95 * densityMul;
  const collideArtist = sz * 0.65 * densityMul;

  sim = forceSimulation<SimNode, SimLink>(simNodes)
    .force(
      "link",
      forceLink<SimNode, SimLink>(simLinks)
        .id((d) => d.id)
        .distance(linkDist)
        .strength((l) => 0.15 + 0.35 * ((l.weight ?? 0.5) as number)),
    )
    .force("charge", forceManyBody().strength(chargeStr))
    .force("center", forceCenter(config.width / 2, config.height / 2))
    // collide: hard non-overlap. radius depends on node kind so the
    // album's square corners (which extend to sz*sqrt(2)/2 from
    // center along the diagonal) don't visually intersect an adjacent
    // artist circle.
    .force(
      "collide",
      forceCollide<SimNode>()
        .radius((n) => (n.kind === "album" ? collideAlbum : collideArtist))
        .strength(1)
        .iterations(3),
    )
    // faster cool-down (~90 ticks vs d3 default ~300).
    .alphaDecay(0.05)
    .velocityDecay(0.55);

  sim.on("tick", emitPositions);

  if (mode === "fresh") {
    sim.alpha(1).restart();
  } else if (mode === "quiet") {
    sim.alpha(0).stop();
    // still emit one frame so main can render any new nodes.
    emitPositions();
  } else {
    sim.alpha(0.08).restart();
  }

  post({
    type: "topology",
    nodeCount: simNodes.length,
    edgeCount: simLinks.length,
    alpha: sim.alpha(),
  });
  performance.measure("graph-build", "graph-build-start");
  performance.clearMarks("graph-build-start");
}

/** merge incoming nodes by id with the current sim nodes, preserving
 *  x/y/vx/vy/fx/fy of survivors so the sim doesn't visibly shuffle on
 *  every topology update. brand-new nodes are seeded from the
 *  caller-provided x/y (main thread does phyllotaxis up there). */
function mergeNodes(incoming: SimNodeInit[]): SimNode[] {
  const prev = new Map(simNodes.map((n) => [n.id, n] as const));
  return incoming.map((n) => {
    const p = prev.get(n.id);
    if (p) {
      p.kind = n.kind;
      if (n.fx !== undefined) p.fx = n.fx;
      if (n.fy !== undefined) p.fy = n.fy;
      return p;
    }
    return {
      id: n.id,
      kind: n.kind,
      x: n.x,
      y: n.y,
      fx: n.fx ?? null,
      fy: n.fy ?? null,
    } as SimNode;
  });
}

function rebuildLinks(incoming: SimLinkInit[]) {
  const byId = new Map(simNodes.map((n) => [n.id, n]));
  simLinks = incoming
    .map((l) => {
      const s = byId.get(l.source);
      const t = byId.get(l.target);
      if (!s || !t) return null;
      return { source: s, target: t, weight: l.weight } as SimLink;
    })
    .filter((x): x is SimLink => x !== null);
}

/** phase 4: build `GraphNodeData`-shaped node payloads from the
 *  taxonomy fields the main thread sent on `SimNodeInit`. lets us
 *  call `buildRelationEdges` directly without round-tripping through
 *  the main thread. fields missing from incoming nodes default to
 *  empty arrays / nulls so the edge builder treats them as
 *  participating in no taxonomic groups. */
function adaptNodesForEdgeDerivation(incoming: SimNodeInit[]): GraphNodeData[] {
  return incoming.map((n) => {
    const tags = (n.tagLabels ?? []).map((label) => ({ label, weight: 0 }));
    if (n.kind === "artist") {
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

/** build sim links from the cached `derivedEdges`, optionally
 *  filtered by the currently-enabled relation kinds. drops any edge
 *  whose endpoints are missing from `simNodes` (can happen briefly
 *  between an `update` and the next render frame). */
function rebuildSimLinksFromDerived(): void {
  const byId = new Map(simNodes.map((n) => [n.id, n]));
  const enabled = edgeConfig?.enabledKinds
    ? new Set<string>(edgeConfig.enabledKinds as string[])
    : null;
  simLinks = derivedEdges
    .filter((e) => !enabled || enabled.has(String(e.kind)))
    .map((e) => {
      const srcId = typeof e.source === "string" ? e.source : e.source.id;
      const tgtId = typeof e.target === "string" ? e.target : e.target.id;
      const s = byId.get(srcId);
      const t = byId.get(tgtId);
      if (!s || !t) return null;
      return { source: s, target: t, weight: e.weight } as SimLink;
    })
    .filter((x): x is SimLink => x !== null);
}

/** derive edges from cached node taxonomy + emit them back to the
 *  main thread for ui consumption. also rebuilds `simLinks` filtered
 *  by `enabledKinds` so the sim picks up the new topology on its
 *  next build. */
function deriveAndEmitEdges(): void {
  if (!edgeConfig) return;
  performance.mark("graph-edges-start");
  derivedEdges = buildRelationEdges(edgeNodes, {
    perGroupFanout: edgeConfig.fanout,
    minGroupSize: edgeConfig.minGroupSize,
    relatedArtists: edgeConfig.relatedArtists,
  });
  rebuildSimLinksFromDerived();
  performance.measure("graph-edges-build", "graph-edges-start");
  performance.clearMarks("graph-edges-start");
  post({ type: "edges", edges: derivedEdges });
}

// ----- message handling -------------------------------------------------

ctx.addEventListener("message", (e: MessageEvent<MainToWorker>) => {
  const msg = e.data;
  switch (msg.type) {
    case "init": {
      config = msg.config;
      simNodes = mergeNodes(msg.nodes);
      if (msg.edgeConfig) {
        edgeConfig = msg.edgeConfig;
        edgeNodes = adaptNodesForEdgeDerivation(msg.nodes);
        deriveAndEmitEdges();
      } else {
        edgeConfig = null;
        rebuildLinks(msg.links);
      }
      hitTreeStale = true;
      post({ type: "ready" });
      buildSim("fresh");
      if (config.paused) sim?.stop();
      break;
    }
    case "update": {
      simNodes = mergeNodes(msg.nodes);
      if (msg.edgeConfig) {
        edgeConfig = msg.edgeConfig;
        edgeNodes = adaptNodesForEdgeDerivation(msg.nodes);
        deriveAndEmitEdges();
      } else {
        edgeConfig = null;
        rebuildLinks(msg.links);
      }
      hitTreeStale = true;
      buildSim(msg.mode);
      break;
    }
    case "resize": {
      config.width = msg.width;
      config.height = msg.height;
      sim?.force("center", forceCenter(msg.width / 2, msg.height / 2));
      if (msg.reheat) sim?.alpha(0.05).restart();
      break;
    }
    case "pin": {
      const n = simNodes.find((x) => x.id === msg.nodeId);
      if (n) {
        n.fx = msg.x;
        n.fy = msg.y;
      }
      break;
    }
    case "unpin": {
      const n = simNodes.find((x) => x.id === msg.nodeId);
      if (n) {
        n.fx = null;
        n.fy = null;
      }
      break;
    }
    case "alphaTarget": {
      if (!sim) break;
      sim.alphaTarget(msg.target);
      if (msg.restart && msg.target > 0) sim.restart();
      break;
    }
    case "pause": {
      sim?.stop();
      break;
    }
    case "resume": {
      if (!sim) break;
      if (msg.alpha != null) sim.alpha(msg.alpha);
      sim.restart();
      break;
    }
    case "reheat": {
      sim?.alpha(msg.alpha).restart();
      break;
    }
    case "setEnabledKinds": {
      if (!edgeConfig) break;
      edgeConfig = { ...edgeConfig, enabledKinds: msg.kinds };
      rebuildSimLinksFromDerived();
      buildSim(msg.mode ?? "nudge");
      break;
    }
    case "return": {
      releaseToPool(msg.buf);
      break;
    }
    case "hitTest": {
      performance.mark("graph-hittest-start");
      const tree = ensureHitTree();
      const hit = tree.find(msg.x, msg.y, msg.radius);
      post({ type: "hitResult", id: msg.id, nodeId: hit ? hit.id : null });
      performance.measure("graph-hittest", "graph-hittest-start");
      performance.clearMarks("graph-hittest-start");
      break;
    }
    case "hitRect": {
      performance.mark("graph-hitrect-start");
      const tree = ensureHitTree();
      const minX = Math.min(msg.x0, msg.x1);
      const maxX = Math.max(msg.x0, msg.x1);
      const minY = Math.min(msg.y0, msg.y1);
      const maxY = Math.max(msg.y0, msg.y1);
      const out: string[] = [];
      tree.visit((node, nx0, ny0, nx1, ny1) => {
        if (!("length" in node) || !node.length) {
          // leaf chain
          let n: { data: SimNode; next?: { data: SimNode; next?: unknown } } | undefined =
            node as unknown as { data: SimNode; next?: { data: SimNode; next?: unknown } };
          do {
            const d = n.data;
            const px = d.x ?? 0;
            const py = d.y ?? 0;
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
    case "quit": {
      sim?.stop();
      sim = null;
      ctx.close();
      break;
    }
    default: {
      const _exhaustive: never = msg;
      void _exhaustive;
    }
  }
});
