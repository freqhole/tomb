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
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { quadtree, type Quadtree } from "d3-quadtree";
import { hubSizeMul } from "../hubSize";
import { buildRelationEdges } from "../relations";
import {
  CHARGE_PER_NODE_SIZE,
  ENDPOINT_COUNT_TUNING,
  HUB_COLLIDE_PADDING_MUL,
  HUB_DIRECTIONAL,
  HUB_LINK_DISTANCE_MUL,
  HUB_RING_RADIUS,
  LINK_DISTANCE_NODE_SIZE_MUL,
  LINK_STRENGTH_CURVE,
  RELATION_CURVE,
  RELATION_HUB_CHARGE_MUL,
  REMOTE_HUB_LINK_STRENGTH_BUMP,
  SIM_COOLDOWN,
  VALUE_HUB_CHARGE_MUL,
} from "./forceTuning";
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
  const e = Math.pow(s, RELATION_CURVE.distance.exponent);
  return RELATION_CURVE.distance.base - e * RELATION_CURVE.distance.slope;
}

function relationStrengthMultiplier(kind: string | undefined): number {
  const s = relationStrengthValue(kind);
  const e = Math.pow(s, RELATION_CURVE.strength.exponent);
  return RELATION_CURVE.strength.base + e * RELATION_CURVE.strength.slope;
}

/** pick the larger endpoint's album-count for a link. used by the
 *  count-aware link distance/strength tweaks below — popular artists
 *  / heavy hubs should pull their satellites in tighter than sparse
 *  ones. handles either string-id or resolved-node endpoint forms
 *  (d3 swaps strings for SimNode refs after init). */
function endpointMaxCount(l: SimLink): number {
  const src = l.source;
  const tgt = l.target;
  const sc = typeof src === "object" && src !== null ? ((src as SimNode).albumCount ?? 0) : 0;
  const tc = typeof tgt === "object" && tgt !== null ? ((tgt as SimNode).albumCount ?? 0) : 0;
  const c = Math.max(sc, tc);
  return c > 0 ? c : 0;
}

/** shrink link target distance for high-count endpoints. sqrt curve so
 *  the first few albums move the needle a lot and the curve flattens
 *  out for very large hubs. floored at 0.55 so even huge hubs don't
 *  collapse into a single point. */
function endpointCountDistanceShrink(l: SimLink): number {
  const c = endpointMaxCount(l);
  if (c <= 0) return 1;
  return Math.max(
    ENDPOINT_COUNT_TUNING.distanceShrinkFloor,
    1 - Math.sqrt(c) / ENDPOINT_COUNT_TUNING.distanceShrinkDivisor,
  );
}

/** boost link spring strength for high-count endpoints. companion to
 *  the distance-shrink so heavy hubs lock their satellites in tightly
 *  instead of just declaring a shorter rest length. capped at ~2.4x. */
function endpointCountStrengthBoost(l: SimLink): number {
  const c = endpointMaxCount(l);
  if (c <= 0) return 1;
  return Math.min(
    ENDPOINT_COUNT_TUNING.strengthBoostCeiling,
    1 + Math.sqrt(c) / ENDPOINT_COUNT_TUNING.strengthBoostDivisor,
  );
}

// ---- directional hub layout helpers -----------------------------
// each hub sits at a stable angular slot around the canvas centre so
// the per-remote scaffold expands outward in its own direction
// instead of stacking on top of the root cluster. angles match the
// FNV-1a seed used by the main thread's `hubLaneOffset` so the
// initial phyllotaxis seed and the steady-state force pull agree.

function fnv1aHash(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}
function hashAngleRad(s: string): number {
  return ((fnv1aHash(s) % 360) / 360) * Math.PI * 2;
}

/** classify a hub id into its angle source + relative radius factor.
 *  returns null for non-hub nodes (leaves curl back to center via the
 *  normal forceCenter / link pull).
 *
 *  layout zones:
 *  - remote hub: outer ring at angle("remote::<id>"), radiusFactor 1.0
 *  - relation hub: SAME angle + SAME radius as its parent remote, so
 *    the kind hexagons cluster tightly around their triangle. link
 *    springs + collide pick the exact arrangement; identical
 *    directional targets keep them from drifting away.
 *  - value hub: pushed OUTSIDE the remote ring (factor 1.3) along an
 *    angle hashed on the full id so siblings spread around the outer
 *    canvas instead of stacking on a shared kind angle. lets the
 *    sub-relation chain expand into empty space without curling
 *    back through the root cluster. */
function hubDirectional(
  id: string,
): { angle: number; radiusFactor: number; strength: number } | null {
  if (id.startsWith("hub_remote::")) {
    const remoteId = id.slice("hub_remote::".length);
    return {
      angle: hashAngleRad("remote::" + remoteId),
      radiusFactor: HUB_DIRECTIONAL.remote.radiusFactor,
      strength: HUB_DIRECTIONAL.remote.strength,
    };
  }
  if (id.startsWith("hub_relation::")) {
    const rest = id.slice("hub_relation::".length);
    const sep = rest.indexOf("::");
    const remoteId = sep >= 0 ? rest.slice(0, sep) : rest;
    return {
      angle: hashAngleRad("remote::" + remoteId),
      radiusFactor: HUB_DIRECTIONAL.relation.radiusFactor,
      strength: HUB_DIRECTIONAL.relation.strength,
    };
  }
  if (id.startsWith("hub_relation_value::")) {
    return {
      angle: hashAngleRad("value::" + id),
      radiusFactor: HUB_DIRECTIONAL.relationValue.radiusFactor,
      strength: HUB_DIRECTIONAL.relationValue.strength,
    };
  }
  return null;
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
  const linkDist = sz * LINK_DISTANCE_NODE_SIZE_MUL * densityMul;
  // link strength: on huge graphs, reduce spring pull so links do not
  // overpower collide/charge and crush spacing back down.
  const linkStrengthMul =
    nCount >= 3500 ? 0.55 : nCount >= 2500 ? 0.62 : nCount >= 1500 ? 0.72 : nCount >= 700 ? 0.84 : 1;
  // charge: long-range mutual repulsion. stronger at higher density so
  // disconnected regions still push apart instead of stacking.
  const chargeStr = sz * CHARGE_PER_NODE_SIZE * densityMul;
  // ---- hub charge: each class gets its own repulsion strength so
  // the layout doesn't fight itself. remote hubs charge at the
  // baseline (the directional force already spreads them around the
  // outer ring — they don't need an extra repulsion bump). relation
  // hubs get a much weaker charge so they cluster tightly around
  // their parent remote rather than flying off. value hubs sit in
  // between since they're shared across remotes and want some
  // separation from siblings on the outer canvas.
  const relationHubChargeStr = chargeStr * RELATION_HUB_CHARGE_MUL;
  const valueHubChargeStr = chargeStr * VALUE_HUB_CHARGE_MUL;
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
  // hubs render at a per-node size driven by their `albumCount`
  // (see `hubSizeMul` on the main thread). previously the worker
  // ignored this and used `collide.artist * 1.7` for every hub —
  // i.e. the worst-case hub size + label-chip padding — which made
  // adjacent hubs sit ~190 world units apart minimum, dwarfing the
  // target link distance of ~30 units and producing the persistent
  // remote↔relation gap. compute maxHubCount once and use the
  // actual rendered size per hub so collide tracks the silhouette.
  let maxHubCount = 0;
  for (const n of simNodes) {
    if (typeof n.id !== "string" || !n.id.startsWith("hub_")) continue;
    const c = (n.albumCount ?? 0) as number;
    if (c > maxHubCount) maxHubCount = c;
  }
  function hubCollideRadius(n: SimNode): number {
    const c = (n.albumCount ?? 0) as number;
    const mul = hubSizeMul(c, maxHubCount);
    // small fixed padding so the silhouette doesn't kiss neighbours;
    // label chips that overflow the silhouette are allowed to render
    // over neighbours (visual concern, not a layout one).
    return (sz * mul) / 2 + sz * HUB_COLLIDE_PADDING_MUL;
  }

  sim = forceSimulation<SimNode, SimLink>(simNodes)
    .force(
      "link",
      forceLink<SimNode, SimLink>(simLinks)
        .id((d) => d.id)
        .distance((l) => {
          // hub-to-hub edges (remote-root → relation-hub, relation-hub
          // → relation-value-hub) get a much shorter target distance
          // so the scaffold sits tightly around its parent instead of
          // sprawling out into the album cloud. detected by id-prefix
          // sniffing on the resolved source/target — by the time the
          // distance accessor is called d3 has rewritten the link
          // endpoints from string ids into SimNode references.
          const srcId =
            typeof l.source === "object" && l.source !== null
              ? (l.source as SimNode).id
              : (l.source as string);
          const tgtId =
            typeof l.target === "object" && l.target !== null
              ? (l.target as SimNode).id
              : (l.target as string);
          const srcHub = typeof srcId === "string" && srcId.startsWith("hub_");
          const tgtHub = typeof tgtId === "string" && tgtId.startsWith("hub_");
          // remote-root → relation-hub edges get a shorter target
          // distance than other hub-to-hub edges so each remote's
          // per-remote kind hexagons stay clustered around their
          // triangle instead of drifting into the album cloud. with
          // per-remote relation hubs (post phase 6) each remote owns
          // its own copy of every hex, so we relax the multiplier a
          // hair (was 0.22) to give the half-dozen kind hubs per
          // remote room to spread around the triangle rather than
          // stack on top of each other.
          const srcRemote = typeof srcId === "string" && srcId.startsWith("hub_remote::");
          const tgtRemote = typeof tgtId === "string" && tgtId.startsWith("hub_remote::");
          const hubMul =
            srcHub && tgtHub
              ? srcRemote || tgtRemote
                ? HUB_LINK_DISTANCE_MUL.remoteToRelation
                : HUB_LINK_DISTANCE_MUL.kindToKind
              : 1;
          return linkDist * relationDistanceMultiplier(l.kind) * hubMul * endpointCountDistanceShrink(l);
        })
        .strength(
          (l) => {
            const srcId =
              typeof l.source === "object" && l.source !== null
                ? (l.source as SimNode).id
                : (l.source as string);
            const tgtId =
              typeof l.target === "object" && l.target !== null
                ? (l.target as SimNode).id
                : (l.target as string);
            const srcRemote = typeof srcId === "string" && srcId.startsWith("hub_remote::");
            const tgtRemote = typeof tgtId === "string" && tgtId.startsWith("hub_remote::");
            // remote↔kind-hub edges get a much stronger spring so the
            // half-dozen relation hexagons per remote stay glued to
            // their wonky triangle instead of drifting toward the
            // shared value-hub cluster.
            const hubStrengthBump =
              srcRemote || tgtRemote ? REMOTE_HUB_LINK_STRENGTH_BUMP : 1;
            return (
              (LINK_STRENGTH_CURVE.base +
                LINK_STRENGTH_CURVE.slope * ((l.weight ?? 0.5) as number)) *
              linkStrengthMul *
              relationStrengthMultiplier(l.kind) *
              hubStrengthBump *
              endpointCountStrengthBoost(l)
            );
          },
        ),
    )
    .force(
      "charge",
      forceManyBody<SimNode>().strength((n) => {
        const id = n.id;
        if (typeof id !== "string") return chargeStr;
        if (id.startsWith("hub_relation::")) return relationHubChargeStr;
        if (id.startsWith("hub_relation_value::")) return valueHubChargeStr;
        return chargeStr;
      }),
    )
    .force("center", forceCenter(config.width / 2, config.height / 2))
    // directional hub layout: each remote / relation / value hub gets
    // a stable angular slot and is pulled outward to a target ring
    // along that angle. spreads multi-remote scaffolds apart so the
    // hubs (and any non-leaf subgraph anchored to them) expand
    // outward in their own direction instead of overlapping the root
    // cluster. leaves (artists + albums) skip these forces and curl
    // back inward via the regular center + link pull.
    .force(
      "hubDirX",
      forceX<SimNode>()
        .x((n) => {
          if (typeof n.id !== "string") return config.width / 2;
          const d = hubDirectional(n.id);
          if (!d) return config.width / 2;
          const baseR =
            sz *
            Math.max(
              HUB_RING_RADIUS.baseMin,
              Math.sqrt(nCount) * HUB_RING_RADIUS.sqrtFactor,
            );
          return config.width / 2 + baseR * d.radiusFactor * Math.cos(d.angle);
        })
        .strength((n) => {
          if (typeof n.id !== "string") return 0;
          return hubDirectional(n.id)?.strength ?? 0;
        }),
    )
    .force(
      "hubDirY",
      forceY<SimNode>()
        .y((n) => {
          if (typeof n.id !== "string") return config.height / 2;
          const d = hubDirectional(n.id);
          if (!d) return config.height / 2;
          const baseR =
            sz *
            Math.max(
              HUB_RING_RADIUS.baseMin,
              Math.sqrt(nCount) * HUB_RING_RADIUS.sqrtFactor,
            );
          return config.height / 2 + baseR * d.radiusFactor * Math.sin(d.angle);
        })
        .strength((n) => {
          if (typeof n.id !== "string") return 0;
          return hubDirectional(n.id)?.strength ?? 0;
        }),
    )
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
        .radius((n) => {
          if (n.kind === "album") return collide.album;
          // hub nodes: size-scaled per-node from albumCount so
          // collide tracks the actual rendered silhouette instead of
          // applying a worst-case worst-multiplier to every hub.
          // crucial fix for the persistent remote↔relation gap (see
          // `hubCollideRadius` for derivation).
          if (typeof n.id === "string" && n.id.startsWith("hub_"))
            return hubCollideRadius(n);
          return collide.artist;
        })
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
    .alphaMin(SIM_COOLDOWN.alphaMin)
    .velocityDecay(SIM_COOLDOWN.velocityDecay);

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
