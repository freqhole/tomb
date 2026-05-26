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
  type Simulation,
} from "d3-force";
import { buildRelationEdges } from "../relations";
import {
  collideRadiiForCount,
} from "./sim/collideRadii";
import { createHitTreeCache } from "./hit/hitTreeCache";
import { createPositionBufferPool } from "./sim/positionBufferPool";
import { buildSimulation } from "./sim/buildSim";
import type { SimLink, SimNode } from "./sim/types";
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
  TuningOverrides,
  UpdateMode,
  WorkerToMain,
} from "./messages";

const ctx: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

function post(msg: WorkerToMain, transfer: Transferable[] = []) {
  ctx.postMessage(msg, transfer);
}

// sim-side node + link types live in `./sim/types.ts` so the
// extracted sim helpers can share them.

// ----- sim state --------------------------------------------------------

let config: SimConfig = { nodeSize: 56, width: 800, height: 600 };
let sim: Simulation<SimNode, SimLink> | null = null;
let simNodes: SimNode[] = [];
let simLinks: SimLink[] = [];
/** debug: live-tuning overrides sent from the main thread. empty
 *  object = use compiled-in defaults from forceTuning.ts. */
let tuningOverrides: TuningOverrides = {};
/** node count from the last buildSim call, used to detect significant
 *  topology shrinkage so we can auto-reheat rather than nudge. */
let prevSimNodeCount = 0;

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
// via `{type:"return"}` it goes back into the pool. extracted to
// `./sim/positionBufferPool.ts` (phase 12).
const bufPool = createPositionBufferPool();
let tick = 0;

// quadtree for hit-testing. rebuilt lazily on first query after the
// sim emits a fresh position frame (or topology change). marking
// stale on every tick is cheap; the rebuild only happens when the
// main thread actually asks (pointer hover / down / contextmenu /
// lasso). extracted to `./hit/hitTreeCache.ts` (phase 12).
const hitCache = createHitTreeCache<SimNode>();

// density-aware collide radii extracted to `./sim/collideRadii.ts`
// (phase 12).

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

// relation curve helpers + buildSim moved to `./sim/buildSim.ts`
// (phase 12). all force-tuning + per-relation strength lookups now
// happen inside the extracted module; the worker keeps just the
// state (sim, simNodes, simLinks, relationStrengths) and forwards
// it on each rebuild.

// endpoint-count link tuning extracted to
// `./sim/endpointCountTuning.ts` (phase 12).

// ---- directional hub layout helpers -----------------------------
// extracted to `./sim/hubDirectional.ts` (phase 12).

function emitPositions() {
  const tickStart = performance.now();
  performance.mark("graph-tick-start");
  resolveResidualOverlaps(sim?.alpha() ?? 0);
  const buf = bufPool.obtain(simNodes.length);
  for (let i = 0; i < simNodes.length; i++) {
    const n = simNodes[i];
    buf[i * 2] = n.x ?? 0;
    buf[i * 2 + 1] = n.y ?? 0;
  }
  tick++;
  hitCache.markStale();
  const tickMs = performance.now() - tickStart;
  post(
    { type: "positions", buf, tick, alpha: sim?.alpha() ?? 0, tickMs },
    [buf.buffer],
  );
  performance.measure("graph-tick", "graph-tick-start");
  performance.clearMarks("graph-tick-start");
}

// ----- build / rebuild --------------------------------------------------

// the heavy lifting (force config, link distance / strength curves,
// charge profile per node class, directional hub layout, collide
// radii, cool-down profile) lives in `./sim/buildSim.ts` (phase 12).
// this wrapper keeps the module-state ownership + the topology /
// alpha kick logic so existing callers (`init`, `update`,
// `setEnabledKinds`) keep the same control surface.
function buildSim(mode: UpdateMode) {
  performance.mark("graph-build-start");
  if (sim) sim.stop();

  const prevCount = prevSimNodeCount;
  prevSimNodeCount = simNodes.length;

  sim = buildSimulation({
    nodes: simNodes,
    links: simLinks,
    config,
    relationStrengths,
    tuningOverrides,
    onTick: emitPositions,
  });

  if (mode === "fresh") {
    sim.alpha(1).restart();
  } else if (mode === "quiet") {
    sim.alpha(0).stop();
    // still emit one frame so main can render any new nodes.
    emitPositions();
  } else {
    // nudge: 0.05 is normally fine for incremental updates. but when the
    // topology changes significantly (many nodes added OR removed), the
    // layout needs real energy:
    //   - shrink: survivors still spread to old positions → need force
    //     to pull them together.
    //   - grow: new nodes land at phyllotaxis seeds (spread out) → need
    //     force to pull them toward their connected hubs.
    // either way, 0.5 gives enough ticks for the active tuning settings
    // (incl. d3 preset with alphaDecay=0.023) to converge a clean layout.
    const changed =
      prevCount > 0 &&
      (simNodes.length < prevCount * 0.7 || simNodes.length > prevCount * 1.3);
    sim.alpha(changed ? 0.5 : 0.05).restart();
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
      // matchedByDrill can flip between rebuilds (album becomes contextual or
      // re-matches the active drill) — always sync it from the latest payload.
      p.matchedByDrill = n.matchedByDrill;
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
      hitCache.markStale();
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
      hitCache.markStale();
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
    case "tuning": {
      tuningOverrides = msg.overrides;
      buildSim("fresh");
      break;
    }
    case "return": {
      bufPool.release(msg.buf, simNodes.length);
      break;
    }
    case "hitTest": {
      performance.mark("graph-hittest-start");
      const tree = hitCache.ensure(simNodes);
      const hit = tree.find(msg.x, msg.y, msg.radius);
      post({ type: "hitResult", id: msg.id, nodeId: hit ? hit.id : null });
      performance.measure("graph-hittest", "graph-hittest-start");
      performance.clearMarks("graph-hittest-start");
      break;
    }
    case "hitRect": {
      performance.mark("graph-hitrect-start");
      const tree = hitCache.ensure(simNodes);
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
