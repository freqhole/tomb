/// <reference lib="webworker" />
// graph2/worker/walker.worker.ts — d3-force simulation + walk state.
//
// walk model:
//   breadcrumb = path from root to current pivot (array of node ids)
//   pivot = breadcrumb[breadcrumb.length - 1]
//   visible = set(breadcrumb) + children(pivot)
//
// click a child of pivot → walk forward (append to breadcrumb)
// click a breadcrumb node → walk back (trim breadcrumb)
//
// layout:
//   - bloom target positions computed deterministically from the tree
//   - forceX + forceY attract each node toward its bloom target
//   - forceCollide prevents overlap (radius-aware)
//   - light forceManyBody adds some natural spacing
//   - forceLink keeps edges from stretching too much

import {
  forceSimulation,
  forceLink,
  forceCollide,
  forceX,
  forceY,
  forceManyBody,
  type Simulation,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from "d3-force";
import type { WalkGraph, WalkNode } from "../types";
import type {
  MainToWorker,
  WorkerToMain,
  VisibleNode,
  TopologyEdge,
} from "./messages";

const ctx: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

function post(msg: WorkerToMain) {
  ctx.postMessage(msg);
}

// ---- sim node shape --------------------------------------------------------

interface SimNode extends SimulationNodeDatum {
  id: string;
  role: string;
  childCount: number;
  radius: number;
  targetX: number;
  targetY: number;
}

interface SimLink extends SimulationLinkDatum<SimNode> {
  isBreadcrumb: boolean;
  /** mirrors WalkEdge.isRelatedArtist — forceLink uses this to apply a
   *  shorter distance + stronger spring so related-artist pairs are
   *  visually clustered. */
  isRelatedArtist?: boolean;
}

// ---- state -----------------------------------------------------------------

let fullGraph: WalkGraph = { nodes: [], edges: [] };
let width = 800;
let height = 600;
let breadcrumb: string[] = [];
let sim: Simulation<SimNode, SimLink> | null = null;
let paused = false;

// node + edge maps rebuilt on each init
const nodeMap = new Map<string, WalkNode>();
const childrenOf = new Map<string, string[]>(); // parentId -> [childId]
const parentsOf  = new Map<string, string[]>(); // childId  -> [parentId]

// phase 3: synthesized cross-remote links (artist↔artist, album↔album) keyed
// by a sorted "a||b" string for fast lookup at emit time. populated by
// indexGraph() from name-based matching across remotes.
const crossRemoteEdges = new Set<string>();

// strategy A — cluster aggregation:
// when two or more entity nodes (artist or album) match across remotes via
// slug(label), we collapse them visually into a single "cluster leader"
// glyph. every member maps to the leader's id via clusterLeaderOf; the
// leader's contributor remote list is in clusterRemotes (leader id ->
// sorted list of contributing remoteIds). this enables:
//   - getVisible() promoting any follower to its leader so we never
//     show duplicates on screen
//   - the renderer drawing per-contributor accent dots around the leader
//   - the detail panel reading contributor list for the multi-remote
//     edit/open dropdown (next pass)
// id system stays per-remote; only the visual + selection layer aggregates.
const clusterLeaderOf = new Map<string, string>(); // memberId -> leaderId
const clusterMembers = new Map<string, string[]>(); // leaderId -> [memberIds]
const clusterRemotes = new Map<string, string[]>(); // leaderId -> sorted remoteIds

function crossKey(a: string, b: string): string {
  return a < b ? `${a}||${b}` : `${b}||${a}`;
}

/** mirror of nodeIds.remoteHubId — defined locally so the worker stays
 *  free of main-thread imports. */
function remoteHubId(remoteId: string): string {
  return `remote::${remoteId}`;
}

/** case-insensitive, punctuation-collapsing slug — used for cross-remote
 *  name matching (artists, album titles). matches "MF DOOM" with "Mf Doom",
 *  "Sunn O)))" with "sunn o", "Post-Punk" with "post punk". */
function slug(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** parse the remote id out of an entity id like `artist::raid::r01`. returns
 *  null for ids that aren't entity-scoped. used so we only build cross-remote
 *  links between different remotes (not within the same remote). */
function remoteOfId(id: string): string | null {
  const parts = id.split("::");
  if (parts.length < 3) return null;
  if (parts[0] !== "artist" && parts[0] !== "album") return null;
  return parts[1];
}

function pivot(): string {
  return breadcrumb[breadcrumb.length - 1] ?? "";
}

/** map a node id to its cluster leader (or itself if not in a cluster).
 *  used to collapse cross-remote duplicates into a single visible glyph. */
function leaderOf(id: string): string {
  return clusterLeaderOf.get(id) ?? id;
}

/** strategy A phase 2 — return the union of children across every member
 *  of `id`'s cluster (or just `childrenOf.get(id)` when `id` is not in a
 *  cluster). this is the key to surfacing every contributor's children
 *  when the user pivots on (or auto-expands) a cluster leader: e.g.
 *  pivoting on a merged-artist glyph reveals albums from every remote
 *  that hosts that artist, not just the leader's remote. duplicate
 *  child entries are tolerated \u2014 the visible-set collapse loop runs
 *  follower\u2192leader at the end of getVisible(), and Set semantics
 *  dedupe naturally before that. */
function clusterChildrenOf(id: string): string[] {
  const lead = leaderOf(id);
  const direct = childrenOf.get(lead) ?? [];
  const members = clusterMembers.get(lead);
  if (!members || members.length === 0) return direct;
  const out: string[] = [...direct];
  for (const m of members) {
    if (m === lead) continue;
    for (const c of childrenOf.get(m) ?? []) out.push(c);
  }
  return out;
}

// ---- node radius by role + childCount --------------------------------------

function nodeRadius(role: string, childCount: number): number {
  switch (role) {
    case "root":     return 14;
    case "remote":   return 28 + Math.min(Math.sqrt(childCount) * 3, 16);
    case "relation": return 20 + Math.min(Math.sqrt(childCount) * 4, 20);
    case "value":    return 14 + Math.min(Math.sqrt(childCount) * 3, 16);
    // artists grow with album count when they have more than a couple of
    // albums, which boosts the parent-radius input into computeTargets'
    // baseR/radialStep and gives related-artist ghosts + album rings
    // breathing room around a fat catalog. 3 albums → 27 (unchanged),
    // 7 → ~37, 15 → ~46, 30+ → caps at ~51.
    case "artist":   return 27 + Math.min(Math.sqrt(Math.max(0, childCount - 3)) * 5, 24);
    case "album":    return 16;
    case "ghost_artist": return 8; // text-only, small footprint just for layout
    default:         return 14;
  }
}

// ---- bloom target positions ------------------------------------------------
// wedge layout: pivot at center, children fan out forward into a CONE.
// when a wedge has more siblings than fit on one arc (at MIN_ARC_SPACING),
// we stack additional rows of arcs radially outward — so the wedge fills
// in like a slice of a dartboard rather than ballooning into one huge ring.
// ancestors go left.

const RING_STEP        = 170;             // legacy: still used for ancestor placement
const FORWARD          = 0;                // wedge points right (→)
const INIT_WEDGE       = Math.PI * 1.15;   // ~207° forward arc for first level — clearly a fan
const MAX_WEDGE        = Math.PI * 0.9;    // sub-wedge cap per child (keeps cones from overlapping)

function computeTargets(
  pivotId: string,
  visibleIds: Set<string>,
  cx: number,
  cy: number,
): Map<string, { x: number; y: number }> {
  const targets = new Map<string, { x: number; y: number }>();

  targets.set(pivotId, { x: cx, y: cy });

  /** place `kids` inside a wedge centered on `midAngle` with angular extent
   *  `wedge`, recursively placing their own children. multi-row when there
   *  are more siblings than fit comfortably on the base arc. spacing scales
   *  with the actual rendered radii so tiny albums pack tighter than fat
   *  genre hubs. */
  function place(
    parentX: number,
    parentY: number,
    parentR: number,
    kidIds: string[],
    midAngle: number,
    wedge: number,
  ) {
    if (kidIds.length === 0) return;

    // average + max radius of this generation drives all spacing knobs
    let sumR = 0;
    let maxR = 0;
    for (const id of kidIds) {
      const n = nodeMap.get(id);
      const r = n ? nodeRadius(n.role, n.childCount) : 14;
      sumR += r;
      if (r > maxR) maxR = r;
    }
    const avgR = sumR / kidIds.length;
    // arc gap = ~2.6 * average diameter; radial gap = ~2.4 * max diameter.
    // tie both knobs to parentR as well so a fat-catalog artist (whose
    // nodeRadius scales with childCount) actually gets a roomier album
    // ring, not just a bigger central glyph crowding the same shell.
    const minArc    = Math.max(36, avgR * 2.6, parentR * 0.55);
    const radialStep = Math.max(54, maxR * 2.4, parentR * 1.1);
    // first row sits parent-radius + a bit + max-kid-radius away from
    // parent. the third term (`parentR * 1.2`) adds personal space
    // proportional to the parent's footprint — for a 51px artist it
    // pads the album ring outward by ~61px instead of the previous flat
    // 28px floor, which is what was making "fat artist" feel tight.
    const baseR    = parentR + maxR + Math.max(28, avgR * 1.4, parentR * 1.2);

    // how many siblings fit per row before they'd be closer than minArc
    const perRow = Math.max(2, Math.floor((wedge * baseR) / minArc));
    const rows = Math.ceil(kidIds.length / perRow);

    for (let i = 0; i < kidIds.length; i++) {
      if (targets.has(kidIds[i])) continue;
      const rowIdx = Math.floor(i / perRow);
      const inRow  = i % perRow;
      // last partial row may have fewer items — center it inside the wedge
      const rowCount = rowIdx === rows - 1 ? kidIds.length - rowIdx * perRow : perRow;
      const r = baseR + rowIdx * radialStep;
      // spread this row evenly across the wedge; one-item rows sit at midAngle
      const step = rowCount > 1 ? wedge / rowCount : 0;
      // honeycomb-ish offset on odd rows so items don't form radial spokes
      const honeyOffset = (rowIdx % 2) * (step / 2);
      const start = midAngle - (step * (rowCount - 1)) / 2 + honeyOffset;
      const angle = start + inRow * step;
      const x = parentX + Math.cos(angle) * r;
      const y = parentY + Math.sin(angle) * r;
      targets.set(kidIds[i], { x, y });

      // recurse for this child's own subtree — narrower wedge so cones nest
      const grandKids = (childrenOf.get(kidIds[i]) ?? []).filter((id) => visibleIds.has(id));
      if (grandKids.length > 0) {
        const kidNode = nodeMap.get(kidIds[i]);
        const kidR    = kidNode ? nodeRadius(kidNode.role, kidNode.childCount) : 14;
        // child's wedge = its angular slot, capped. don't promote it past its
        // siblings' share — that's what caused lone descendants to spread out
        // way wider than their parent's footprint and overlap neighbors.
        const slotWedge = step > 0 ? step * 0.95 : wedge * 0.6;
        const childWedge = Math.min(slotWedge, MAX_WEDGE);
        place(x, y, kidR, grandKids, angle, childWedge);
      }
    }
  }

  // pivot's children fan forward
  const rootKids = (childrenOf.get(pivotId) ?? []).filter((id) => visibleIds.has(id));
  const pivotNode = nodeMap.get(pivotId);
  const pivotR = pivotNode ? nodeRadius(pivotNode.role, pivotNode.childCount) : 14;
  place(cx, cy, pivotR, rootKids, FORWARD, INIT_WEDGE);

  // breadcrumb ancestors go to the left, fanning slightly so they don't stack
  const ancestors = breadcrumb.slice(0, -1).reverse();
  for (let i = 0; i < ancestors.length; i++) {
    const id = ancestors[i];
    if (!visibleIds.has(id) || targets.has(id)) continue;
    const angle = Math.PI + (i - ancestors.length / 2) * 0.35;
    const r = RING_STEP * (i + 1);
    targets.set(id, { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r });
  }

  // relation hubs surfaced for visible value children (see getVisible) need an
  // explicit slot — they aren't a child of pivot, so they'd hit the random
  // fallback. anchor each just beyond the centroid of its visible values so
  // the kind-tinted wires fan inward toward the hub from a consistent side.
  for (const id of visibleIds) {
    if (targets.has(id)) continue;
    const node = nodeMap.get(id);
    if (node?.role !== "relation") continue;
    // gather positioned value children of this hub
    let sx = 0;
    let sy = 0;
    let count = 0;
    for (const childId of childrenOf.get(id) ?? []) {
      const t = targets.get(childId);
      if (!t) continue;
      sx += t.x;
      sy += t.y;
      count++;
    }
    if (count === 0) continue;
    const ax = sx / count;
    const ay = sy / count;
    // push outward from pivot by ~one ring step past the values' centroid
    const dx = ax - cx;
    const dy = ay - cy;
    const dist = Math.hypot(dx, dy) || 1;
    const push = RING_STEP * 0.9;
    targets.set(id, {
      x: ax + (dx / dist) * push,
      y: ay + (dy / dist) * push,
    });
  }

  // any remaining visible node (shouldn't happen often)
  let fallback = 0;
  for (const id of visibleIds) {
    if (!targets.has(id)) {
      targets.set(id, {
        x: cx + Math.cos(fallback) * RING_STEP * 2,
        y: cy + Math.sin(fallback) * RING_STEP * 2,
      });
      fallback += 1.1;
    }
  }

  return targets;
}

// ---- compute which nodes are visible ---------------------------------------

function getVisible(): Set<string> {
  const visible = new Set<string>(breadcrumb);
  const piv = pivot();
  const pivRole = nodeMap.get(piv)?.role;
  for (const childId of clusterChildrenOf(piv)) {
    const wn = nodeMap.get(childId);
    if (!wn) continue;
    // skip hub nodes that ended up with no children (e.g. unmapped genre).
    // lazy hubs are exempt: their children are loaded on pivot, so they
    // legitimately have zero children until the user expands them.
    if ((wn.role === "value" || wn.role === "relation") && wn.childCount === 0 && !wn.lazy) continue;
    // when pivot is a remote hub, only surface its first-order taxon
    // children (relation hubs: genre, mood, tag, style, era, label,
    // favorite). artists/albums are intentionally hidden until the user
    // drills through a relation \u2192 value path. without this scope a
    // remote with hundreds of artists would dump the entire library on
    // screen the moment you opened it.
    if (pivRole === "remote" && wn.role !== "relation") continue;
    visible.add(childId);
  }
  // auto-expand album children only for the pivot artist (or any artist on
  // the breadcrumb path). without this scope, opening a remote hub would
  // surface every artist AND every album in that remote at once \u2014 huge
  // graphs and a giant ball of nodes. progressive expansion is the goal:
  // pivot a remote \u2192 see artists; click an artist \u2192 see its albums.
  const breadcrumbSet = new Set(breadcrumb);
  for (const id of [...visible]) {
    const wn = nodeMap.get(id);
    if (wn?.role !== "artist") continue;
    if (id !== piv && !breadcrumbSet.has(id)) continue;
    for (const childId of clusterChildrenOf(id)) {
      const child = nodeMap.get(childId);
      if (child?.role === "album") visible.add(childId);
    }
  }
  // when an album is visible (breadcrumb or auto-expanded), keep its parent artist visible
  for (const id of [...visible]) {
    const wn = nodeMap.get(id);
    if (wn?.role === "album") {
      for (const parentId of parentsOf.get(id) ?? []) {
        const parent = nodeMap.get(parentId);
        if (parent?.role === "artist") visible.add(parentId);
      }
    }
  }
  // surface the taxon-hub (relation node) for every visible value, so users
  // can see at a glance which kind a value belongs to and have a launch point
  // back into that taxon. the forward relation→value edge already exists in
  // fullGraph.edges, so the wire draws automatically once both sides are
  // visible. skips the case where the relation is already on the breadcrumb.
  for (const id of [...visible]) {
    const wn = nodeMap.get(id);
    if (wn?.role !== "value") continue;
    for (const parentId of parentsOf.get(id) ?? []) {
      const parent = nodeMap.get(parentId);
      if (parent?.role === "relation") visible.add(parentId);
    }
  }
  // strategy A — collapse cluster followers to their leader. iterating
  // over a snapshot since we mutate the set. members are deleted; only
  // the leader remains so the renderer draws a single aggregate glyph.
  // breadcrumb membership is preserved by adding the leader when any
  // member was on the breadcrumb (the original member id stays in
  // breadcrumb[] — the worker uses leaderOf() at edge-emit + breadcrumb-
  // set construction time so the leader still reads as "on path").
  for (const id of [...visible]) {
    const lead = leaderOf(id);
    if (lead === id) continue;
    visible.delete(id);
    visible.add(lead);
  }
  return visible;
}

// ---- rebuild sim from current walk state -----------------------------------

function buildSim() {
  if (sim) sim.stop();

  const visible = getVisible();
  const cx = width / 2;
  const cy = height / 2;
  const targets = computeTargets(pivot(), visible, cx, cy);
  const pivLeader = leaderOf(pivot());
  // pivot-aware spacing knob: any pivot artist gets a personal-space
  // cordon, scaled by catalog size. small catalogs still get cleared
  // breathing room; big catalogs get proportionally more. `pivotBoost`
  // ramps from ~0.1 (1 album) toward a soft cap of 1.5 (15+ albums).
  //
  // CLUSTER-AWARE COUNT: aggregated artists (dashed-stroke, multiple
  // members merged across remotes via slug) count their *combined*
  // catalog, not just the leader's own albums. we walk fullGraph.edges
  // with leaderOf collapse and tally unique album leader ids attached
  // to pivLeader.
  const pivLeaderNode = nodeMap.get(pivLeader);
  const pivotIsArtist = pivLeaderNode?.role === "artist";
  const pivotAlbumChildren = new Set<string>();
  if (pivotIsArtist) {
    for (const e of fullGraph.edges) {
      const rs = typeof e.source === "string" ? e.source : (e.source as SimNode).id;
      const rt = typeof e.target === "string" ? e.target : (e.target as SimNode).id;
      const ls = leaderOf(rs);
      const lt = leaderOf(rt);
      const sn = nodeMap.get(ls);
      const tn = nodeMap.get(lt);
      if (!sn || !tn) continue;
      if (ls === pivLeader && sn.role === "artist" && tn.role === "album") {
        pivotAlbumChildren.add(lt);
      } else if (lt === pivLeader && tn.role === "artist" && sn.role === "album") {
        pivotAlbumChildren.add(ls);
      }
    }
  }
  const pivotAlbumCount = pivotAlbumChildren.size;
  const pivotBoost = pivotIsArtist
    ? Math.min(Math.max(pivotAlbumCount, 1) / 10, 1.5)
    : 0;
  const pivotActive = pivotIsArtist;
  // strategy A — breadcrumb may contain member ids; collapse to leader ids so
  // the visible leader still reads as "on breadcrumb path" (drives stroke +
  // label tints).
  const breadcrumbSet = new Set(breadcrumb.map(leaderOf));

  // build sim nodes, preserving existing positions when available
  const prevPositions = new Map<string, { x: number; y: number }>();
  if (sim) {
    for (const n of sim.nodes()) {
      if (Number.isFinite(n.x) && Number.isFinite(n.y)) {
        prevPositions.set(n.id, { x: n.x!, y: n.y! });
      }
    }
  }

  const simNodes: SimNode[] = [];
  const idToIdx = new Map<string, number>();

  for (const id of visible) {
    const wn = nodeMap.get(id);
    if (!wn) continue;
    const target = targets.get(id) ?? { x: cx, y: cy };
    const prev = prevPositions.get(id);
    // for the pivot artist when aggregated across cluster members, use
    // the cluster-wide album count so the visual node + collide reflect
    // the true catalog size (otherwise dashed-stroke aggregated artists
    // look small relative to their actual fan-out).
    const effectiveChildCount =
      id === pivLeader && pivotIsArtist && pivotAlbumCount > wn.childCount
        ? pivotAlbumCount
        : wn.childCount;
    const r = nodeRadius(wn.role, effectiveChildCount);
    const sn: SimNode = {
      id,
      role: wn.role,
      childCount: effectiveChildCount,
      radius: r,
      targetX: target.x,
      targetY: target.y,
      // start at prev position if known, else slightly perturbed target
      x: prev?.x ?? target.x + (Math.random() - 0.5) * 20,
      y: prev?.y ?? target.y + (Math.random() - 0.5) * 20,
    };
    idToIdx.set(id, simNodes.length);
    simNodes.push(sn);
  }

  // build sim edges (between visible nodes only). source/target are mapped
  // through leaderOf() so edges that originally connected cluster followers
  // (related-artist, parent-child, etc) still emit between the surviving
  // leader nodes after strategy A collapse. self-loops (both endpoints in
  // the same cluster) are dropped silently.
  const simLinks: SimLink[] = [];
  const visibleEdges: TopologyEdge[] = [];
  const emittedEdgeKeys = new Set<string>(); // dedupe forward + cross-remote

  for (const e of fullGraph.edges) {
    const rawSrc = typeof e.source === "string" ? e.source : (e.source as SimNode).id;
    const rawTgt = typeof e.target === "string" ? e.target : (e.target as SimNode).id;
    const src = leaderOf(rawSrc);
    const tgt = leaderOf(rawTgt);
    if (src === tgt) continue;
    const si = idToIdx.get(src);
    const ti = idToIdx.get(tgt);
    if (si === undefined || ti === undefined) continue;
    const key = crossKey(src, tgt);
    if (emittedEdgeKeys.has(key)) continue;
    const isBC = breadcrumbSet.has(src) && breadcrumbSet.has(tgt);
    simLinks.push({ source: src, target: tgt, isBreadcrumb: isBC, isRelatedArtist: e.isRelatedArtist });
    visibleEdges.push({
      sourceIdx: si,
      targetIdx: ti,
      isBreadcrumb: isBC,
      isRelatedArtist: e.isRelatedArtist,
      isPending: e.isPending,
    });
    emittedEdgeKeys.add(key);
  }

  // phase 3: emit synthesized cross-remote artist/album links.
  //
  // re-routing: instead of drawing a dashed wire between two cluster
  // leaders (which crowds the entity space in the middle of the canvas),
  // route each cross-remote bridge to the *other* endpoint's remote hub.
  // visually this reads as "this entity also lives on $remote", and the
  // wires terminate at the periphery (remote hubs) rather than tangling
  // through the cluster interior. when both endpoints already collapsed
  // into the same cluster (strategy A already absorbed the bridge) the
  // dashed edge is skipped entirely. when the remote hubs aren't visible
  // we fall back to the legacy leader↔leader dashed edge so the bridge
  // still surfaces.
  for (const key of crossRemoteEdges) {
    const [a, b] = key.split("||");
    const lA = leaderOf(a);
    const lB = leaderOf(b);
    if (lA === lB) continue; // already merged by clustering
    const remoteA = remoteOfId(a);
    const remoteB = remoteOfId(b);
    const hubA = remoteA ? remoteHubId(remoteA) : null;
    const hubB = remoteB ? remoteHubId(remoteB) : null;
    const lAIdx = idToIdx.get(lA);
    const lBIdx = idToIdx.get(lB);
    const hubAIdx = hubA ? idToIdx.get(hubA) : undefined;
    const hubBIdx = hubB ? idToIdx.get(hubB) : undefined;

    let emittedAny = false;
    // lA → remote hub of b's remote
    if (lAIdx !== undefined && hubBIdx !== undefined && lA !== hubB) {
      const k = crossKey(lA, hubB!);
      if (!emittedEdgeKeys.has(k)) {
        simLinks.push({ source: lA, target: hubB!, isBreadcrumb: false });
        visibleEdges.push({
          sourceIdx: lAIdx,
          targetIdx: hubBIdx,
          isBreadcrumb: false,
          isCrossRemote: true,
        });
        emittedEdgeKeys.add(k);
        emittedAny = true;
      }
    }
    // lB → remote hub of a's remote
    if (lBIdx !== undefined && hubAIdx !== undefined && lB !== hubA) {
      const k = crossKey(lB, hubA!);
      if (!emittedEdgeKeys.has(k)) {
        simLinks.push({ source: lB, target: hubA!, isBreadcrumb: false });
        visibleEdges.push({
          sourceIdx: lBIdx,
          targetIdx: hubAIdx,
          isBreadcrumb: false,
          isCrossRemote: true,
        });
        emittedEdgeKeys.add(k);
        emittedAny = true;
      }
    }
    // fallback: neither remote hub is visible — keep the legacy direct
    // leader↔leader dashed edge so the bridge doesn't vanish.
    if (!emittedAny && lAIdx !== undefined && lBIdx !== undefined) {
      const k = crossKey(lA, lB);
      if (!emittedEdgeKeys.has(k)) {
        simLinks.push({ source: lA, target: lB, isBreadcrumb: false });
        visibleEdges.push({
          sourceIdx: lAIdx,
          targetIdx: lBIdx,
          isBreadcrumb: false,
          isCrossRemote: true,
        });
        emittedEdgeKeys.add(k);
      }
    }
  }

  // emit topology before starting sim so main thread can render immediately
  const topologyNodes: VisibleNode[] = simNodes.map((n) => ({
    id: n.id,
    role: n.role as VisibleNode["role"],
    label: nodeMap.get(n.id)?.label ?? n.id,
    childCount: n.childCount,
    isPivot: n.id === pivLeader,
    isBreadcrumb: breadcrumbSet.has(n.id),
    tint: nodeMap.get(n.id)?.tint,
    isCharnelManaged: nodeMap.get(n.id)?.isCharnelManaged,
    contributorRemotes: clusterRemotes.get(n.id),
  }));
  post({ type: "topology", nodes: topologyNodes, edges: visibleEdges });
  post({ type: "visibleIds", ids: simNodes.map((n) => n.id) });

  // capture live pivot sim node so cordon reads current position each
  // tick. nodeMap holds walk-graph nodes; we need the SimNode whose x/y
  // updates every tick. pivotAlbumChildren was computed up-front (cluster-
  // aware) so the cordon can exempt the inner album ring.
  const pivotSimNode = pivotActive
    ? simNodes[idToIdx.get(pivLeader) ?? -1]
    : undefined;
  // max album radius among pivot's children — sets how wide the
  // protected inner ring must be before everything else gets evicted.
  let pivotMaxAlbumR = 0;
  if (pivotActive) {
    for (const aid of pivotAlbumChildren) {
      const idx = idToIdx.get(aid);
      if (idx === undefined) continue;
      const r = simNodes[idx].radius;
      if (r > pivotMaxAlbumR) pivotMaxAlbumR = r;
    }
  }
  // cordon radius: pivot disc + full album ring + generous padding
  // that scales with album count. for a 30-album artist this clears
  // ~600px around the pivot, evicting hub nodes and ghost satellites
  // to the periphery.
  const cordonR = pivotActive && pivotSimNode
    ? pivotSimNode.radius + pivotMaxAlbumR * 2.6 + 220 + pivotBoost * 180
    : 0;

  // custom cordon force: every tick, push non-album-of-pivot nodes
  // outward if they're inside the cordon. uses an alpha-scaled
  // velocity nudge proportional to (cordonR - dist), so deeply
  // penetrating nodes are evicted hard while just-outside nodes feel
  // nothing. this is the lever that finally clears space around fat
  // pivots in dense (multi-remote) graphs — conventional charge alone
  // can't reach far enough.
  function cordonForce(alpha: number) {
    if (!pivotActive || !pivotSimNode) return;
    const px = pivotSimNode.x ?? 0;
    const py = pivotSimNode.y ?? 0;
    if (!Number.isFinite(px) || !Number.isFinite(py)) return;
    for (const n of simNodes) {
      if (n.id === pivLeader) continue;
      if (pivotAlbumChildren.has(n.id)) continue;
      // ghost related artists are reference points — they should sit
      // near the pivot, not get evicted to the periphery. they're
      // tiny (r=8) and label-only so they don't crowd anything.
      if (n.role === "ghost_artist") continue;
      const dx = (n.x ?? 0) - px;
      const dy = (n.y ?? 0) - py;
      const d2 = dx * dx + dy * dy;
      if (d2 >= cordonR * cordonR) continue;
      const d = Math.sqrt(d2) || 0.0001;
      const push = (cordonR - d) * 0.22 * alpha;
      n.vx = (n.vx ?? 0) + (dx / d) * push;
      n.vy = (n.vy ?? 0) + (dy / d) * push;
    }
  }

  sim = forceSimulation<SimNode, SimLink>(simNodes)
    .force(
      "link",
      forceLink<SimNode, SimLink>(simLinks)
        .id((d) => d.id)
        .distance((d) => {
          const s = d.source as SimNode;
          const t = d.target as SimNode;
          // album edges: tight inner ring, even more so when the
          // parent is the selected pivot (creates a cohesive catalog
          // halo against which the pivot's repulsion field can clear
          // outer space).
          if (s.role === "artist" && t.role === "album") {
            const tight = s.id === pivLeader && pivotActive
              ? Math.max(1.05, 1.3 - pivotBoost * 0.15)
              : 1.3;
            return (s.radius + t.radius) * tight;
          }
          // every other edge touching the pivot artist (related-artist,
          // taxon hubs, value chips...) gets pushed outward in
          // proportion to the catalog size. one knob, every edge type.
          const base = d.isRelatedArtist
            ? (s.radius + t.radius) * 1.6
            : s.role === "value"
              ? (s.radius + t.radius) * 4.7  // value→x fan-out
              : (s.radius + t.radius) * 2.6;
          if (pivotActive && (s.id === pivLeader || t.id === pivLeader)) {
            return base * (1 + pivotBoost * 1.2);
          }
          return base;
        })
        .strength((d) => {
          const s = d.source as SimNode;
          const t = d.target as SimNode;
          // album edges: lock tight (near-max) so the catalog ring
          // shrugs off every other attractor pulling at the albums.
          if (s.role === "artist" && t.role === "album") {
            return s.id === pivLeader && pivotActive
              ? Math.min(1, 0.95 + pivotBoost * 0.05)
              : 0.95;
          }
          // every other edge touching the pivot artist gets RELAXED
          // — related-artist links, hub connections, ghost satellites
          // — so they don't yank the pivot off-center or crowd the
          // album ring. base strength varies by edge type but pivot-
          // touching ones are uniformly divided by `1 + boost * 2`.
          const base = d.isRelatedArtist ? 0.6 : 0.22;
          if (pivotActive && (s.id === pivLeader || t.id === pivLeader)) {
            return base / (1 + pivotBoost * 2);
          }
          return base;
        }),
    )
    .force(
      "collide",
      forceCollide<SimNode>()
        // a bit more breathing room around leaves so labels/artwork don't
        // overlap as aggressively. hubs stay generous so their fan-outs
        // don't get squashed. artist/album collide bumped slightly so
        // there's some visible padding around each tile even when packed.
        // NOTE: keep pivot artist's collide modest — its big personal-
        // space bubble is enforced by the strong negative charge below,
        // not by collide, because a huge collide radius would fight the
        // album spring (albums sit at ~1.3 * sum-of-radii and would get
        // shoved out of formation by an oversized pivot collide).
        .radius((d) => {
          if (d.role === "album") return d.radius * 1.55;
          if (d.role === "artist") return d.radius * 1.8;
          return d.radius * 1.9;
        })
        .strength(1.0)
        .iterations(4),
    )
    .force(
      "x",
      forceX<SimNode>((d) => d.targetX).strength((d) => {
        if (d.role === "album") return 0.45;
        // when pivot is a fat artist, relax the bloom-target homing
        // on every satellite so they can drift outward under the
        // pivot's strong negative charge instead of being yanked
        // back to their original placement.
        if (pivotActive && d.id !== pivLeader) {
          return Math.max(0.05, 0.18 - pivotBoost * 0.09);
        }
        return 0.18;
      }),
    )
    .force(
      "y",
      forceY<SimNode>((d) => d.targetY).strength((d) => {
        if (d.role === "album") return 0.45;
        if (pivotActive && d.id !== pivLeader) {
          return Math.max(0.05, 0.18 - pivotBoost * 0.09);
        }
        return 0.18;
      }),
    )
    .force(
      "charge",
      forceManyBody<SimNode>()
        // hubs (relation/value) push harder than leaves so dense
        // clusters fan out. the pivot artist with a fat catalog gets a
        // dramatically larger negative charge — combined with
        // distanceMax=1400 it reaches every ghost satellite and clears
        // outer space without disturbing the tight album ring (which
        // is held in place by the near-max album spring).
        .strength((d) => {
          if (d.role === "value" || d.role === "relation") return -180;
          if (d.role === "artist") {
            if (d.id === pivLeader && pivotActive) {
              return -(400 + pivotBoost * 600);
            }
            return -90;
          }
          if (d.role === "album") return -20;
          return -55;
        })
        .distanceMax(1400),
    )
    .force("cordon", cordonForce)
    .alphaDecay(0.015)
    .velocityDecay(0.42)
    .on("tick", onTick);

  if (paused) sim.stop();
}

// ---- tick → emit frame -----------------------------------------------------

function onTick() {
  if (!sim) return;
  const nodes = sim.nodes();
  const positions = new Float32Array(nodes.length * 2);
  for (let i = 0; i < nodes.length; i++) {
    positions[i * 2] = nodes[i].x ?? 0;
    positions[i * 2 + 1] = nodes[i].y ?? 0;
  }
  post({ type: "frame", positions, alpha: sim.alpha() });
}

// ---- rebuild graph index (call after fullGraph changes) --------------------

function indexGraph() {
  nodeMap.clear();
  childrenOf.clear();
  parentsOf.clear();
  for (const n of fullGraph.nodes) nodeMap.set(n.id, n);
  for (const e of fullGraph.edges) {
    const src = e.source as string;
    const tgt = e.target as string;
    if (!childrenOf.has(src)) childrenOf.set(src, []);
    childrenOf.get(src)!.push(tgt);
    if (!parentsOf.has(tgt)) parentsOf.set(tgt, []);
    parentsOf.get(tgt)!.push(src);
  }
  // recompute childCount from actual edges, but preserve any eager
  // count the producer set (e.g. list_taxon_kinds returns album_count
  // for relation hubs before their value nodes are loaded; era bins
  // know their album counts before fanout). take max so the badge
  // surfaces real totals up-front, and once the actual edge count
  // exceeds the eager hint (cross-remote links etc.) edges win.
  for (const [id, node] of nodeMap) {
    const edgeCount = childrenOf.get(id)?.length ?? 0;
    node.childCount = Math.max(node.childCount ?? 0, edgeCount);
  }

  // phase 1: reverse value→album and value→artist edges in childrenOf so that
  // pivoting on an album or artist reveals its taxon value nodes as children.
  // we only update childrenOf (not fullGraph.edges) — the original forward
  // edges already exist for wire drawing between visible pairs.
  for (const e of fullGraph.edges) {
    const src = e.source as string;
    const tgt = e.target as string;
    const srcRole = nodeMap.get(src)?.role;
    const tgtRole = nodeMap.get(tgt)?.role;
    if (srcRole === "value" && (tgtRole === "album" || tgtRole === "artist")) {
      if (!childrenOf.has(tgt)) childrenOf.set(tgt, []);
      childrenOf.get(tgt)!.push(src);
    }
  }

  // phase 3: build cross-remote name-match links for artists + albums.
  // ids differ across remotes (`a01` vs `r01`) so matching is by slug of
  // the human label. albums also key on their parent artist's slug since
  // two unrelated artists can share a title (e.g. "Untitled").
  crossRemoteEdges.clear();
  clusterLeaderOf.clear();
  clusterMembers.clear();
  clusterRemotes.clear();
  const artistByKey = new Map<string, string[]>(); // slug(label) -> [artistId]
  const albumByKey  = new Map<string, string[]>(); // slug(artistLabel)::slug(albumLabel) -> [albumId]

  // index artists first so albums can look up their parent's slug
  for (const n of fullGraph.nodes) {
    if (n.role !== "artist") continue;
    const k = slug(n.label);
    if (!k) continue;
    if (!artistByKey.has(k)) artistByKey.set(k, []);
    artistByKey.get(k)!.push(n.id);
  }

  // each album finds its artist parent via parentsOf (role==artist)
  for (const n of fullGraph.nodes) {
    if (n.role !== "album") continue;
    const parents = parentsOf.get(n.id) ?? [];
    const artistParent = parents
      .map((pid) => nodeMap.get(pid))
      .find((p) => p?.role === "artist");
    if (!artistParent) continue;
    const k = `${slug(artistParent.label)}::${slug(n.label)}`;
    if (!k) continue;
    if (!albumByKey.has(k)) albumByKey.set(k, []);
    albumByKey.get(k)!.push(n.id);
  }

  // all-pairs cross-remote links per matched group (different remotes only).
  // also designates a cluster leader (lexicographically lowest id with a
  // resolvable remote) so the visual layer can collapse the group into one
  // glyph (strategy A).
  function linkGroup(ids: string[]) {
    if (ids.length < 2) return;
    // bucket by remote so we can both (a) skip same-remote pairs and (b)
    // build the contributor remote list for the cluster.
    const remotes = new Set<string>();
    for (const id of ids) {
      const r = remoteOfId(id);
      if (r) remotes.add(r);
    }
    // need at least two distinct remotes to form a cross-remote cluster.
    if (remotes.size < 2) return;
    const sortedIds = [...ids].sort();
    const leader = sortedIds[0];
    clusterMembers.set(leader, sortedIds);
    clusterRemotes.set(leader, [...remotes].sort());
    for (const m of sortedIds) clusterLeaderOf.set(m, leader);
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = ids[i];
        const b = ids[j];
        if (remoteOfId(a) === remoteOfId(b)) continue; // same remote — skip
        crossRemoteEdges.add(crossKey(a, b));
        // augment adjacency so getVisible() surfaces counterparts as
        // pseudo-children of the pivoted artist/album (still useful as a
        // fallback for any path that bypasses cluster promotion).
        if (!childrenOf.has(a)) childrenOf.set(a, []);
        if (!childrenOf.has(b)) childrenOf.set(b, []);
        childrenOf.get(a)!.push(b);
        childrenOf.get(b)!.push(a);
        if (!parentsOf.has(a)) parentsOf.set(a, []);
        if (!parentsOf.has(b)) parentsOf.set(b, []);
        parentsOf.get(a)!.push(b);
        parentsOf.get(b)!.push(a);
      }
    }
  }
  for (const ids of artistByKey.values()) linkGroup(ids);
  for (const ids of albumByKey.values()) linkGroup(ids);
}

// ---- message handler -------------------------------------------------------

ctx.onmessage = (evt: MessageEvent<MainToWorker>) => {
  const msg = evt.data;

  switch (msg.type) {
    case "init": {
      fullGraph = msg.graph;
      width = msg.width;
      height = msg.height;
      indexGraph();

      if (msg.breadcrumb && msg.breadcrumb.length > 0) {
        breadcrumb = [...msg.breadcrumb];
      } else {
        breadcrumb = [msg.pivot];
      }

      buildSim();
      post({ type: "ready" });
      break;
    }

    case "expand": {
      const { nodeId } = msg;
      if (!nodeMap.has(nodeId)) break;

      const idx = breadcrumb.indexOf(nodeId);
      if (idx >= 0) {
        // walk back: trim breadcrumb to this node
        breadcrumb = breadcrumb.slice(0, idx + 1);
      } else {
        // walk forward: append (only allowed from pivot's children)
        breadcrumb = [...breadcrumb, nodeId];
      }

      buildSim();
      break;
    }

    case "resize": {
      width = msg.width;
      height = msg.height;
      // recompute targets around new center and restart
      if (sim) buildSim();
      break;
    }

    case "hitTest": {
      if (!sim) {
        post({ type: "hitResult", reqId: msg.reqId, nodeId: null });
        break;
      }
      const nodes = sim.nodes();
      // per-role inradius factors — keep the hit zone matched to the
      // rendered shape (lifted from the old GraphCanvas hit geometry).
      // narrower silhouettes get smaller factors so clicks in empty
      // corners don't register. floored at 12 screen pixels (12/k in
      // world units) so small nodes stay clickable when zoomed out.
      const INRADIUS: Record<string, number> = {
        root:     0.5,
        remote:   0.42, // freqhole mark — narrow at bottom
        relation: 0.5,  // hexagon
        value:    0.5,  // octagon
        artist:   0.5,  // circle
        album:    0.95, // square — corners stay clickable
      };
      const minR = 12 / Math.max(msg.k, 0.05);
      let best: string | null = null;
      let bestDist = Infinity;
      for (const n of nodes) {
        // ghost artists are non-interactive (label-only, no shape)
        if (n.role === "ghost_artist") continue;
        const dx = (n.x ?? 0) - msg.x;
        const dy = (n.y ?? 0) - msg.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const factor = INRADIUS[n.role] ?? 0.5;
        const hitR = Math.max(n.radius * factor, minR);
        if (dist <= hitR && dist < bestDist) {
          bestDist = dist;
          best = n.id;
        }
      }
      post({ type: "hitResult", reqId: msg.reqId, nodeId: best });
      break;
    }

    case "merge": {
      const existingIds = new Set(fullGraph.nodes.map((n) => n.id));
      const existingEdgeKeys = new Set(
        fullGraph.edges.map((e) => `${e.source as string}::${e.target as string}`),
      );
      for (const n of msg.addNodes) {
        if (!existingIds.has(n.id)) {
          fullGraph.nodes.push(n);
          existingIds.add(n.id);
        }
      }
      for (const e of msg.addEdges) {
        const key = `${e.source as string}::${e.target as string}`;
        if (!existingEdgeKeys.has(key)) {
          fullGraph.edges.push(e);
          existingEdgeKeys.add(key);
        }
      }
      indexGraph();
      buildSim();
      break;
    }

    case "repivot": {
      if (!nodeMap.has(msg.nodeId)) break;
      if (msg.resetBreadcrumb) {
        breadcrumb = [msg.nodeId];
      } else {
        breadcrumb = [...breadcrumb, msg.nodeId];
      }
      buildSim();
      break;
    }

    case "back": {
      if (breadcrumb.length > 1) {
        breadcrumb = breadcrumb.slice(0, -1);
      }
      buildSim();
      break;
    }

    case "setPaused": {
      paused = msg.paused;
      if (paused) {
        sim?.stop();
      } else {
        sim?.alpha(0.3).restart();
      }
      break;
    }

    case "getBounds": {
      if (!sim || sim.nodes().length === 0) {
        post({ type: "boundsResult", reqId: msg.reqId, bounds: null });
        break;
      }
      const nodes = sim.nodes();
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const n of nodes) {
        const x = n.x ?? 0;
        const y = n.y ?? 0;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
      post({ type: "boundsResult", reqId: msg.reqId, bounds: { minX, minY, maxX, maxY } });
      break;
    }
  }
};
