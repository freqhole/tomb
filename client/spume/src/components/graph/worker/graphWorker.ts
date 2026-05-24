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
  kind?: string;
  weight?: number;
  label?: string;
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
let relationStrengths: Record<string, number> | undefined;
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

function densityMultiplierForCount(nCount: number): number {
  if (nCount >= 4000) return 2.2;
  if (nCount >= 3000) return 1.95;
  if (nCount >= 2000) return 1.7;
  if (nCount >= 1200) return 1.45;
  if (nCount >= 700) return 1.24;
  return 1;
}

function collideRadiiForCount(
  nCount: number,
  sz: number,
): { album: number; artist: number } {
  const densityMul = densityMultiplierForCount(nCount);
  const collideDensityMul = 1 + (densityMul - 1) * 0.9;
  return {
    album: sz * 0.82 * collideDensityMul,
    artist: sz * 0.6 * collideDensityMul,
  };
}

function resolveResidualOverlaps(alpha: number): void {
  const nCount = simNodes.length;
  if (nCount < 700) return;
  // only spend extra overlap work while the sim is still actively
  // cooling and not on every single tick for huge graphs.
  if (alpha <= 0.004) return;
  if (nCount >= 2500 && tick % 2 !== 0) return;

  const sz = config.nodeSize;
  const radii = collideRadiiForCount(nCount, sz);
  const pad = sz * 0.06;
  const cellSize = Math.max(sz * 2.2, (radii.album + radii.artist) * 1.1);
  const passCount = nCount >= 3000 ? 3 : nCount >= 1500 ? 2 : 1;
  const neighborOffsets: Array<[number, number]> = [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
  ];

  for (let pass = 0; pass < passCount; pass++) {
    const grid = new Map<string, number[]>();
    for (let i = 0; i < simNodes.length; i++) {
      const n = simNodes[i];
      const cx = Math.floor((n.x ?? 0) / cellSize);
      const cy = Math.floor((n.y ?? 0) / cellSize);
      const key = `${cx},${cy}`;
      const bucket = grid.get(key);
      if (bucket) {
        bucket.push(i);
      } else {
        grid.set(key, [i]);
      }
    }

    for (const [key, aBucket] of grid.entries()) {
      const parts = key.split(",");
      const cx = Number(parts[0]);
      const cy = Number(parts[1]);
      for (const [ox, oy] of neighborOffsets) {
        const bKey = `${cx + ox},${cy + oy}`;
        const bBucket = grid.get(bKey);
        if (!bBucket) continue;

        for (let ai = 0; ai < aBucket.length; ai++) {
          const i = aBucket[ai];
          const a = simNodes[i];
          const ax = a.x ?? 0;
          const ay = a.y ?? 0;
          const ar = a.kind === "album" ? radii.album : radii.artist;
          const aPinned = a.fx != null || a.fy != null;

          const bjStart = bKey === key ? ai + 1 : 0;
          for (let bj = bjStart; bj < bBucket.length; bj++) {
            const j = bBucket[bj];
            if (j === i) continue;
            const b = simNodes[j];
            const bx = b.x ?? 0;
            const by = b.y ?? 0;
            const br = b.kind === "album" ? radii.album : radii.artist;
            const bPinned = b.fx != null || b.fy != null;
            if (aPinned && bPinned) continue;

            let dx = bx - ax;
            let dy = by - ay;
            let dist = Math.hypot(dx, dy);
            const minDist = ar + br + pad;
            if (dist >= minDist) continue;
            if (dist < 1e-4) {
              // deterministic tiny axis to avoid NaN when centers coincide.
              dx = i < j ? 1 : -1;
              dy = 0;
              dist = 1;
            }

            const nx = dx / dist;
            const ny = dy / dist;
            const overlap = minDist - dist;

            if (aPinned) {
              b.x = bx + nx * overlap;
              b.y = by + ny * overlap;
            } else if (bPinned) {
              a.x = ax - nx * overlap;
              a.y = ay - ny * overlap;
            } else {
              const half = overlap * 0.5;
              a.x = ax - nx * half;
              a.y = ay - ny * half;
              b.x = bx + nx * half;
              b.y = by + ny * half;
            }
          }
        }
      }
    }
  }
}

function relationStrengthValue(kind: string | undefined): number {
  if (!kind) return 0.5;
  const raw = relationStrengths?.[kind];
  if (typeof raw !== "number" || Number.isNaN(raw)) {
    if (kind === "artist_album") return 1;
    if (kind === "same_artist") return 1;
    if (kind === "favorite") return 0.82;
    if (kind === "related_artist") return 0.78;
    if (kind === "tag") return 0.22;
    return 0.5;
  }
  return Math.max(0, Math.min(1, raw));
}

function relationDistanceMultiplier(kind: string | undefined): number {
  const s = relationStrengthValue(kind);
  // non-linear scaling gives stronger "full" lock-in while preserving
  // subtle low-end tuning granularity.
  const e = Math.pow(s, 1.2);
  return 1.52 - e * 1.12;
}

function relationStrengthMultiplier(kind: string | undefined): number {
  const s = relationStrengthValue(kind);
  const e = Math.pow(s, 1.35);
  return 0.22 + e * 3.05;
}

function emitPositions() {
  const tickStart = performance.now();
  performance.mark("graph-tick-start");
  resolveResidualOverlaps(sim?.alpha() ?? 0);
  const buf = obtainBuf(simNodes.length);
  for (let i = 0; i < simNodes.length; i++) {
    const n = simNodes[i];
    buf[i * 2] = n.x ?? 0;
    buf[i * 2 + 1] = n.y ?? 0;
  }
  tick++;
  hitTreeStale = true;
  const tickMs = performance.now() - tickStart;
  post(
    { type: "positions", buf, tick, alpha: sim?.alpha() ?? 0, tickMs },
    [buf.buffer],
  );
  performance.measure("graph-tick", "graph-tick-start");
  performance.clearMarks("graph-tick-start");
}

// ----- build / rebuild --------------------------------------------------

function buildSim(mode: UpdateMode) {
  performance.mark("graph-build-start");
  if (sim) sim.stop();

  const sz = config.nodeSize;
  // dense libraries pile nodes on top of each other even with collide
  // enabled, because link + charge balance was tuned for smaller
  // graphs. scale spacing much more aggressively once we cross
  // 1k+ nodes so large datasets stay readable.
  const nCount = simNodes.length;
  const densityMul = densityMultiplierForCount(nCount);
  // link distance: target spacing between connected nodes. raise this
  // as datasets grow so local clusters do not collapse into one blob.
  const linkDist = sz * 2.6 * densityMul;
  // link strength: on huge graphs, reduce spring pull so links do not
  // overpower collide/charge and crush spacing back down.
  const linkStrengthMul =
    nCount >= 3500 ? 0.55 : nCount >= 2500 ? 0.62 : nCount >= 1500 ? 0.72 : nCount >= 700 ? 0.84 : 1;
  // charge: long-range mutual repulsion. stronger at higher density so
  // disconnected regions still push apart instead of stacking.
  const chargeStr = -sz * 7.8 * densityMul;
  // collide radii: forceCollide treats nodes as DISCS. an axis-
  // aligned album square of edge `sz` is inscribed in a disc of
  // radius sz/2, but two squares oriented at 45° to each other have
  // their corners reaching sz*√2/2 ≈ 0.707*sz from center. so a
  // collide radius below 0.707 lets adjacent squares visually
  // overlap when their relative orientation is diagonal — that
  // was the source of the persistent overlap report. 0.72 covers
  // worst-case orientation with a tiny visual gap. artist circles
  // are perfect discs of diameter sz so r >= 0.5 is the hard
  // minimum; 0.52 gives a hair of padding.
  const collide = collideRadiiForCount(nCount, sz);

  sim = forceSimulation<SimNode, SimLink>(simNodes)
    .force(
      "link",
      forceLink<SimNode, SimLink>(simLinks)
        .id((d) => d.id)
        .distance((l) => linkDist * relationDistanceMultiplier(l.kind))
        .strength(
          (l) =>
            (0.15 + 0.35 * ((l.weight ?? 0.5) as number)) *
            linkStrengthMul *
            relationStrengthMultiplier(l.kind),
        ),
    )
    .force("charge", forceManyBody().strength(chargeStr))
    .force("center", forceCenter(config.width / 2, config.height / 2))
    // collide: hard non-overlap. radius depends on node kind so the
    // album's square corners (which extend to sz*sqrt(2)/2 from
    // center along the diagonal) don't visually intersect an adjacent
    // artist circle.
    //
    // iterations bumped on dense graphs: jacobi-style collide needs
    // more sub-passes to fully untangle overlaps when many pairs are
    // simultaneously crowded by strong link/charge forces. small
    // libraries already settle cleanly with a few iterations, so we
    // only pay the extra cost where it's needed.
    .force(
      "collide",
      forceCollide<SimNode>()
        .radius((n) => (n.kind === "album" ? collide.album : collide.artist))
        .strength(1)
        .iterations(nCount >= 4000 ? 28 : nCount >= 3000 ? 24 : nCount >= 2000 ? 20 : nCount >= 1200 ? 16 : nCount >= 700 ? 12 : 8),
    )
    // cool-down: slower on dense graphs so collide has more ticks
    // to untangle simultaneous overlaps before velocities die out.
    // small libraries keep the snappy ~90-tick settle.
    // alphaMin raised slightly above d3 default (0.001) so the sim
    // doesn't freeze with residual link/charge tension still pushing
    // collide-constrained pairs apart — keeping a tiny background
    // alpha lets jacobi collide finish cleaning up the layout.
    .alphaDecay(nCount >= 3500 ? 0.021 : nCount >= 2500 ? 0.023 : nCount >= 1500 ? 0.028 : nCount >= 700 ? 0.037 : 0.05)
    .alphaMin(0.0015)
    .velocityDecay(0.64);

  sim.on("tick", emitPositions);

  if (mode === "fresh") {
    sim.alpha(1).restart();
  } else if (mode === "quiet") {
    sim.alpha(0).stop();
    // still emit one frame so main can render any new nodes.
    emitPositions();
  } else {
    sim.alpha(0.05).restart();
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
      return {
        source: s,
        target: t,
        kind: String(l.kind),
        weight: l.weight,
        label: l.label,
      } as SimLink;
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
      return {
        source: s,
        target: t,
        kind: String(e.kind),
        weight: e.weight,
        label: e.label,
      } as SimLink;
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
      relationStrengths = msg.relationStrengths;
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
      relationStrengths = msg.relationStrengths;
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
