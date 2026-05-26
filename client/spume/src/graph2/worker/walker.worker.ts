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
}

// ---- state -----------------------------------------------------------------

let fullGraph: WalkGraph = { nodes: [], edges: [] };
let width = 800;
let height = 600;
let breadcrumb: string[] = [];
let sim: Simulation<SimNode, SimLink> | null = null;

// node + edge maps rebuilt on each init
const nodeMap = new Map<string, WalkNode>();
const childrenOf = new Map<string, string[]>(); // parentId -> [childId]
const parentsOf  = new Map<string, string[]>(); // childId  -> [parentId]

function pivot(): string {
  return breadcrumb[breadcrumb.length - 1] ?? "";
}

// ---- node radius by role + childCount --------------------------------------

function nodeRadius(role: string, childCount: number): number {
  switch (role) {
    case "root":     return 14;
    case "remote":   return 28 + Math.min(Math.sqrt(childCount) * 3, 16);
    case "relation": return 20 + Math.min(Math.sqrt(childCount) * 4, 20);
    case "value":    return 14 + Math.min(Math.sqrt(childCount) * 3, 16);
    case "artist":   return 18;
    case "album":    return 11;
    default:         return 14;
  }
}

// ---- bloom target positions ------------------------------------------------
// wedge layout: pivot at center, children fan out to the right (angle=0).
// ancestors go left. within each depth ring, nodes with more children sit
// at the base radius (they'll grow a dense sub-tree there); nodes with fewer
// children get pushed further out into open space.

const RING_STEP = 120;        // base distance per depth level (multiplied by sqrt(depth))
const SPREAD   = 70;          // extra radius added for childless/sparse nodes
const FORWARD  = 0;           // wedge points right (→)
const INIT_WEDGE = Math.PI * 1.1; // ~200° forward arc for first level
const MAX_WEDGE  = Math.PI * 0.9; // sub-wedge cap per child

/** radius for a node at `depth` with `childCount` children.
 *  uses sqrt(depth) so deeper rings grow gracefully instead of marching away.
 *  hubs with many children stay close; leaves drift further out. */
function ringRadius(depth: number, childCount: number): number {
  const spread = SPREAD * (1 / (childCount + 1));
  return RING_STEP * Math.sqrt(depth) + spread;
}

function computeTargets(
  pivotId: string,
  visibleIds: Set<string>,
  cx: number,
  cy: number,
): Map<string, { x: number; y: number }> {
  const targets = new Map<string, { x: number; y: number }>();

  targets.set(pivotId, { x: cx, y: cy });

  function place(nodeId: string, depth: number, midAngle: number, wedge: number) {
    const kids = (childrenOf.get(nodeId) ?? []).filter((id) => visibleIds.has(id));
    if (kids.length === 0) return;
    const step = Math.min(wedge / kids.length, (Math.PI * 2) / Math.max(kids.length, 1));
    const startAngle = midAngle - (step * (kids.length - 1)) / 2;
    for (let i = 0; i < kids.length; i++) {
      if (targets.has(kids[i])) continue;
      const angle = startAngle + i * step;
      const kid = nodeMap.get(kids[i]);
      const kidCount = kid?.childCount ?? 0;
      let r = ringRadius(depth, kidCount);
      // stagger leaf nodes (albums) and artists across two depth bands so
      // they don't all land on the same radius and form a crowded line.
      // alternates: even index → base ring, odd index → 22% further out.
      if (kid?.role === "album" || kid?.role === "artist") {
        r *= 1 + (i % 2) * 0.22;
      }
      targets.set(kids[i], {
        x: cx + Math.cos(angle) * r,
        y: cy + Math.sin(angle) * r,
      });
      const childWedge = Math.min(step * 0.85, MAX_WEDGE / Math.max(kids.length, 1));
      place(kids[i], depth + 1, angle, childWedge);
    }
  }

  // fan children forward (→), ancestors go left (←)
  place(pivotId, 1, FORWARD, INIT_WEDGE);

  // breadcrumb ancestors: place them to the left, fanning slightly so
  // they don't stack on top of each other
  const ancestors = breadcrumb.slice(0, -1).reverse();
  for (let i = 0; i < ancestors.length; i++) {
    const id = ancestors[i];
    if (!visibleIds.has(id) || targets.has(id)) continue;
    const angle = Math.PI + (i - ancestors.length / 2) * 0.35;
    const r = RING_STEP * (i + 1);
    targets.set(id, { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r });
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
  for (const childId of childrenOf.get(piv) ?? []) {
    const wn = nodeMap.get(childId);
    if (!wn) continue;
    // skip hub nodes that ended up with no children (e.g. unmapped genre)
    if ((wn.role === "value" || wn.role === "relation") && wn.childCount === 0) continue;
    visible.add(childId);
  }
  // auto-expand album children of any visible artist — no click required
  for (const id of [...visible]) {
    const wn = nodeMap.get(id);
    if (wn?.role === "artist") {
      for (const childId of childrenOf.get(id) ?? []) {
        const child = nodeMap.get(childId);
        if (child?.role === "album") visible.add(childId);
      }
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
  return visible;
}

// ---- rebuild sim from current walk state -----------------------------------

function buildSim() {
  if (sim) sim.stop();

  const visible = getVisible();
  const cx = width / 2;
  const cy = height / 2;
  const targets = computeTargets(pivot(), visible, cx, cy);
  const piv = pivot();
  const breadcrumbSet = new Set(breadcrumb);

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
    const r = nodeRadius(wn.role, wn.childCount);
    const sn: SimNode = {
      id,
      role: wn.role,
      childCount: wn.childCount,
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

  // build sim edges (between visible nodes only)
  const simLinks: SimLink[] = [];
  const visibleEdges: TopologyEdge[] = [];

  for (const e of fullGraph.edges) {
    const src = typeof e.source === "string" ? e.source : (e.source as SimNode).id;
    const tgt = typeof e.target === "string" ? e.target : (e.target as SimNode).id;
    const si = idToIdx.get(src);
    const ti = idToIdx.get(tgt);
    if (si === undefined || ti === undefined) continue;
    const isBC = breadcrumbSet.has(src) && breadcrumbSet.has(tgt);
    simLinks.push({ source: src, target: tgt, isBreadcrumb: isBC });
    visibleEdges.push({ sourceIdx: si, targetIdx: ti, isBreadcrumb: isBC });
  }

  // emit topology before starting sim so main thread can render immediately
  const topologyNodes: VisibleNode[] = simNodes.map((n) => ({
    id: n.id,
    role: n.role as VisibleNode["role"],
    label: nodeMap.get(n.id)?.label ?? n.id,
    childCount: n.childCount,
    isPivot: n.id === piv,
    isBreadcrumb: breadcrumbSet.has(n.id),
    imageUrl: nodeMap.get(n.id)?.imageUrl,
  }));
  post({ type: "topology", nodes: topologyNodes, edges: visibleEdges });

  sim = forceSimulation<SimNode, SimLink>(simNodes)
    .force(
      "link",
      forceLink<SimNode, SimLink>(simLinks)
        .id((d) => d.id)
        .distance((d) => {
          const s = d.source as SimNode;
          const t = d.target as SimNode;
          const base = (s.radius + t.radius) * 2.2;
          // give artist→album links extra slack so the collision force
          // can spread albums without fighting a tight spring
          if (s.role === "artist" && t.role === "album") return base * 1.5;
          return base;
        })
        .strength(0.35),
    )
    .force(
      "collide",
      forceCollide<SimNode>()
        .radius((d) => d.radius * 1.5)
        .strength(1.0)
        .iterations(4),
    )
    .force("x", forceX<SimNode>((d) => d.targetX).strength(0.28))
    .force("y", forceY<SimNode>((d) => d.targetY).strength(0.28))
    .force("charge", forceManyBody<SimNode>().strength(-35))
    .alphaDecay(0.018)
    .velocityDecay(0.4)
    .on("tick", onTick);
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
  // recompute childCount from actual edges — mock data numbers are unreliable
  for (const [id, node] of nodeMap) {
    node.childCount = childrenOf.get(id)?.length ?? 0;
  }
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
      let best: string | null = null;
      let bestDist = Infinity;
      for (const n of nodes) {
        const dx = (n.x ?? 0) - msg.x;
        const dy = (n.y ?? 0) - msg.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= n.radius + 4 && dist < bestDist) {
          bestDist = dist;
          best = n.id;
        }
      }
      post({ type: "hitResult", reqId: msg.reqId, nodeId: best });
      break;
    }
  }
};
