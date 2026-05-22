// AlbumGraphCanvas — force-directed album graph rendered to html5 canvas 2d.
//
// responsibilities:
// - run a d3-force simulation over the supplied nodes + edges
// - draw nodes (via drawAlbumNode) and edges (per-kind colored strokes)
// - handle pan/zoom (wheel + trackpad two-finger pan + drag + pinch) and node drag
// - emit hover / select events for both nodes AND edges; support optional lasso
// - rebuild quadtree on every tick for hit testing
//
// the component is presentational: the parent supplies nodes/edges + relation
// filter state, and reacts to selection events. it does NOT fetch data.

import { createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
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
import { drawAlbumNode } from "./drawAlbumNode";
import { buildHitTester, type HitTester } from "./hitTest";
import { RELATION_COLOR } from "./relations";
import type { AlbumNodeData, GraphEdge, GraphNode, RelationKind, ViewportTransform } from "./types";

export interface AlbumGraphCanvasProps {
  nodes: AlbumNodeData[];
  edges: GraphEdge[];
  /** which relation kinds to render edges for; undefined = all */
  enabledKinds?: Set<string> | string[];
  /** node tile size in world units. default 56. */
  nodeSize?: number;
  /** controlled selection (parent owns state) */
  selectedId?: string | null;
  onSelect?: (album: AlbumNodeData | null) => void;
  /**
   * controlled edge selection. when provided, the canvas matches each
   * (kind,label) tuple against its internal links and lights up siblings
   * for every entry. pass `[]` or `null` to clear; pass `undefined` to
   * leave the canvas in uncontrolled mode (its own internal selection
   * wins).
   */
  selectedEdges?: GraphEdge[] | null;
  /** edge click — fires when user clicks an empty-space edge stroke */
  onEdgeSelect?: (edge: GraphEdge | null) => void;
  /** lasso tool — emits the set of selected nodes at the end of a drag */
  onLassoSelect?: (albums: AlbumNodeData[]) => void;
  /** right-click / long-press on a node — parent renders its own menu */
  onNodeContextMenu?: (album: AlbumNodeData, clientX: number, clientY: number) => void;
  /** edge hover — fires (edge, x, y) on transition, and (null) when leaving */
  onEdgeHover?: (edge: GraphEdge | null, clientX: number, clientY: number) => void;
  /** imperative actions handed to the parent once the canvas is mounted */
  onReady?: (api: GraphActions) => void;
  /** override colors per relation kind (used for user-defined taxon keys) */
  relationColors?: Record<string, string>;
  /** current tool; "pan" by default. */
  tool?: "pan" | "lasso";
  /** simulation paused? */
  paused?: boolean;
  /**
   * how much the connection wires sag / curve. 0 = straight lines.
   * positive values pull the midpoint perpendicular to the segment
   * (downward in screen space) for a hanging-cable feel. typical
   * range 0–0.4. default 0.18.
   */
  edgeCurvature?: number;
  /**
   * optional set of node ids that match an external search / filter.
   * when supplied and non-empty, every other node + its edges are dimmed
   * so the user can spot matches in a busy graph. pass `null` /
   * `undefined` (or an empty set) to disable.
   */
  searchMatches?: Set<string> | null;
  /** css class on the root */
  class?: string;
}

type SimNode = GraphNode & SimulationNodeDatum;
type SimLink = GraphEdge & SimulationLinkDatum<SimNode> & { _key: string };

export interface GraphActions {
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
  reset: () => void;
}

function edgeKey(e: GraphEdge): string {
  const s = typeof e.source === "string" ? e.source : e.source.id;
  const t = typeof e.target === "string" ? e.target : e.target.id;
  return `${e.kind}:${s}->${t}`;
}

export function AlbumGraphCanvas(props: AlbumGraphCanvasProps) {
  let canvasEl: HTMLCanvasElement | undefined;
  let containerEl: HTMLDivElement | undefined;

  // resolve a color for a relation kind. user-supplied overrides win,
  // then built-in palette, then a neutral fallback for unknown kinds.
  // memoized per-instance: kindColor was a top-N cpu sample in the draw
  // loop (called once per edge per frame). cache invalidates when the
  // override map identity changes.
  let colorCacheKey: typeof props.relationColors | undefined;
  const colorCache = new Map<string, string>();
  const kindColor = (kind: string): string => {
    if (colorCacheKey !== props.relationColors) {
      colorCacheKey = props.relationColors;
      colorCache.clear();
    }
    let c = colorCache.get(kind);
    if (c === undefined) {
      c = props.relationColors?.[kind] ?? RELATION_COLOR[kind as RelationKind] ?? "#9aa0aa";
      colorCache.set(kind, c);
    }
    return c;
  };

  const curvature = () => Math.max(0, props.edgeCurvature ?? 0.18);

  // control point for the quadratic bezier used to render a curved edge.
  // sags perpendicular to the segment (rotated 90°); positive = below the
  // line in screen-space coords (canvas y grows downward).
  function edgeControlPoint(
    sx: number,
    sy: number,
    tx: number,
    ty: number
  ): { cx: number; cy: number } {
    const c = curvature();
    if (c <= 0) return { cx: (sx + tx) / 2, cy: (sy + ty) / 2 };
    const dx = tx - sx;
    const dy = ty - sy;
    const len = Math.hypot(dx, dy) || 1;
    // perpendicular (rotated 90° cw in screen space gives +y bias)
    const px = -dy / len;
    const py = dx / len;
    const sag = len * c;
    // bias toward positive y so wires hang downward; if perp already points
    // up, flip it.
    const sign = py < 0 ? -1 : 1;
    return {
      cx: (sx + tx) / 2 + px * sag * sign,
      cy: (sy + ty) / 2 + py * sag * sign,
    };
  }

  // ---- viewport ---------------------------------------------------------
  const [view, setView] = createSignal<ViewportTransform>({ tx: 0, ty: 0, k: 1 });
  const [hoverId, setHoverId] = createSignal<string | null>(null);
  const [hoverEdgeKey, setHoverEdgeKey] = createSignal<string | null>(null);
  const [internalSelected, setInternalSelected] = createSignal<string | null>(null);
  const [selectedEdgeKeys, setSelectedEdgeKeys] = createSignal<Set<string>>(new Set());
  const selectedId = () => props.selectedId ?? internalSelected();

  // ---- simulation -------------------------------------------------------
  let sim: Simulation<SimNode, SimLink> | null = null;
  let simNodes: SimNode[] = [];
  let simLinks: SimLink[] = [];
  let hitter: HitTester | null = null;
  // lazy accessor: hit tester is invalidated on every sim tick but only
  // rebuilt when actually queried (pointer move/down/up, lasso).
  function getHitter(): HitTester {
    if (!hitter) hitter = buildHitTester(simNodes, nodeSize());
    return hitter;
  }

  const nodeSize = () => props.nodeSize ?? 56;
  const enabledSet = createMemo<Set<string> | null>(() => {
    const e = props.enabledKinds;
    if (!e) return null;
    return Array.isArray(e) ? new Set(e) : e;
  });

  // canvas dpr-aware sizing
  let dpr = 1;
  let width = 0;
  let height = 0;

  function resize() {
    if (!canvasEl || !containerEl) return;
    dpr = window.devicePixelRatio || 1;
    const rect = containerEl.getBoundingClientRect();
    width = Math.max(1, Math.floor(rect.width));
    height = Math.max(1, Math.floor(rect.height));
    canvasEl.width = Math.floor(width * dpr);
    canvasEl.height = Math.floor(height * dpr);
    canvasEl.style.width = `${width}px`;
    canvasEl.style.height = `${height}px`;
    if (sim) {
      sim.force("center", forceCenter(width / 2, height / 2));
      // gentle nudge only — resize fires on mount and on any container
      // resize, and a 0.3 alpha here would re-explode the layout every
      // time. 0.05 lets the center force re-balance without visible
      // shuffle of settled nodes.
      sim.alpha(0.05).restart();
    }
    requestDraw();
  }

  // ---- rebuild sim on data change --------------------------------------

  // tracks whether a real layout pass has happened yet. on the very first
  // rebuild we need to actually run forces from scratch; subsequent
  // rebuilds (e.g. relation kind toggled) should preserve positions and
  // only nudge the sim with a low alpha so nothing visibly shuffles.
  let firstBuild = true;

  function rebuild() {
    if (!canvasEl) return;

    // preserve positions/velocities across rebuilds: when an album's id
    // already had a sim node, reuse its x/y/vx/vy so toggling a relation
    // layer doesn't re-seed every node and trigger a full re-settle.
    const prev = new Map(simNodes.map((n) => [n.id, n] as const));
    simNodes = props.nodes.map((n) => {
      const p = prev.get(n.id);
      if (p) {
        // mutate-in-place style: copy node fields (in case the upstream
        // album payload changed e.g. new tags) but keep simulation state.
        return Object.assign(p, n) as SimNode;
      }
      // brand-new node: positions filled in below from a phyllotaxis
      // seed. clone the data so the upstream array isn't mutated by the
      // sim.
      return { ...n } as SimNode;
    }) as SimNode[];

    // pre-seed any node that's still missing x/y (i.e. truly new). doing
    // this in a second pass so we have stable indices.
    const cx = width / 2;
    const cy = height / 2;
    const sz0 = nodeSize();
    let seedIdx = 0;
    for (const n of simNodes) {
      if (n.x == null || n.y == null) {
        // phyllotaxis: golden-angle spiral keeps initial layout compact
        // and roughly evenly distributed → forces converge fast.
        const a = seedIdx * 2.399963229728653;
        const r = Math.sqrt(seedIdx + 0.5) * sz0 * 0.9;
        n.x = cx + r * Math.cos(a);
        n.y = cy + r * Math.sin(a);
        n.vx = 0;
        n.vy = 0;
        seedIdx++;
      }
    }

    const byId = new Map(simNodes.map((n) => [n.id, n]));
    simLinks = props.edges
      .filter((e) => {
        const set = enabledSet();
        return !set || set.has(e.kind);
      })
      .map((e) => {
        const srcId = typeof e.source === "string" ? e.source : e.source.id;
        const tgtId = typeof e.target === "string" ? e.target : e.target.id;
        const s = byId.get(srcId);
        const t = byId.get(tgtId);
        if (!s || !t) return null;
        return { ...e, source: s, target: t, _key: edgeKey(e) } as SimLink;
      })
      .filter((x): x is SimLink => x !== null);

    if (sim) sim.stop();
    const sz = nodeSize();
    sim = forceSimulation<SimNode, SimLink>(simNodes)
      .force(
        "link",
        forceLink<SimNode, SimLink>(simLinks)
          .id((d) => d.id)
          .distance(sz * 2.8) // more breathing room — edges easier to follow
          .strength((l) => 0.15 + 0.35 * (l.weight ?? 0.5))
      )
      .force("charge", forceManyBody().strength(-sz * 8)) // stronger repulsion
      .force("center", forceCenter(width / 2, height / 2))
      .force("collide", forceCollide<SimNode>().radius(sz * 1.1))
      // faster cool-down. default alphaDecay ~0.0228 ≈ 300 ticks before
      // alphaMin; bumping to 0.05 settles in ~90 ticks. velocityDecay
      // bumped a touch so nodes don't keep drifting after links shift.
      .alphaDecay(0.05)
      .velocityDecay(0.55);

    if (firstBuild) {
      // first pass with no prior positions: full energy so the
      // phyllotaxis seed relaxes into a real layout.
      sim.alpha(1).restart();
      firstBuild = false;
    } else {
      // subsequent rebuilds (relation kinds toggled, nodes appended):
      // very low alpha so existing positions barely move — just enough
      // for new edges to tug things into place.
      sim.alpha(0.15).restart();
    }

    sim.on("tick", () => {
      // invalidate the hit tester rather than rebuilding it: pointer
      // queries are rare relative to ticks (was hot in the cpu trace —
      // quadtree.addAll on every tick). lazy getHitter() rebuilds on
      // demand.
      hitter = null;
      requestDraw();
    });
    if (props.paused) sim.stop();
  }

  // ---- draw loop --------------------------------------------------------
  let drawScheduled = false;
  let animatingMarquee = false;
  let lastDrawTime = 0;
  function requestDraw() {
    if (drawScheduled) return;
    drawScheduled = true;
    requestAnimationFrame((t) => {
      drawScheduled = false;
      lastDrawTime = t;
      draw(t);
      // keep ticking while marquee scrolling
      if (animatingMarquee) requestDraw();
    });
  }

  function draw(time: number = lastDrawTime) {
    if (!canvasEl) return;
    const ctx = canvasEl.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const v = view();
    ctx.save();
    ctx.translate(v.tx, v.ty);
    ctx.scale(v.k, v.k);

    // edges
    const hov = hoverId();
    const sel = selectedId();
    const selEdges = selectedEdgeKeys();
    const hovEdge = hoverEdgeKey();
    const focus = sel ?? hov;
    const focusConnected = focus ? collectConnected(focus) : null;
    // search overlay: when non-empty, behaves like an extra focus filter
    // — nodes outside the match set go dimmed, their edges fade out.
    const search = props.searchMatches;
    const hasSearch = !!search && search.size > 0;
    // edge focus: when one or more edges are selected, light up every node
    // + sibling edge that shares the same (kind, label) tuple as any of
    // them — e.g. clicking "tag: indie" highlights all albums tagged
    // "indie"; toggling on "genre: punk" too adds those albums + wires.
    const hasEdgeSel = selEdges.size > 0;
    let edgeFocusIds: Set<string> | null = null;
    const siblingEdgeKeys: Set<string> | null = hasEdgeSel ? new Set<string>() : null;
    if (hasEdgeSel && siblingEdgeKeys) {
      // collect every (kind,label) tuple referenced by the selected keys
      const tuples = new Set<string>();
      for (const l of simLinks) {
        if (selEdges.has(l._key)) tuples.add(`${String(l.kind)}|${l.label ?? ""}`);
      }
      const ids = new Set<string>();
      for (const l of simLinks) {
        const key = `${String(l.kind)}|${l.label ?? ""}`;
        if (tuples.has(key)) {
          siblingEdgeKeys.add(l._key);
          ids.add((l.source as SimNode).id);
          ids.add((l.target as SimNode).id);
        }
      }
      edgeFocusIds = ids;
    }

    ctx.lineCap = "round";
    // edge rendering is batched in two passes:
    //   1) "dim" edges (out-of-focus / search-miss): all share the same
    //      alpha + lineWidth, so we can group by stroke color and stroke
    //      each color group as a single path. this was the biggest
    //      hotspot in the cpu trace (~830ms in `stroke` calls).
    //   2) "highlighted" edges (involved/selected/hover/sibling): few in
    //      number, drawn individually because their lineWidth varies
    //      with link weight.
    // pre-compute curvature once per draw — was being read per edge.
    const curv = curvature();
    // bucket edges by visual category. dim/search-dim use fixed style,
    // so we group by color and stroke each group as a single path.
    const dimByColor = new Map<string, SimLink[]>();
    const searchDimByColor = new Map<string, SimLink[]>();
    const highlighted: SimLink[] = [];
    for (const link of simLinks) {
      const s = link.source as SimNode;
      const t = link.target as SimNode;
      const isHovEdge = link._key === hovEdge;
      const isSelEdge = selEdges.has(link._key);
      const isSiblingEdge = siblingEdgeKeys?.has(link._key) ?? false;
      let involved = !focus && !edgeFocusIds;
      if (focus) {
        involved =
          !!focusConnected &&
          (focusConnected.has(s.id) ||
            focusConnected.has(t.id) ||
            s.id === focus ||
            t.id === focus);
      }
      if (edgeFocusIds) {
        involved = isSiblingEdge;
      }
      const searchDim = hasSearch && search && !search.has(s.id) && !search.has(t.id);
      if (searchDim && !isSelEdge && !isHovEdge) {
        const color = kindColor(link.kind);
        let arr = searchDimByColor.get(color);
        if (!arr) {
          arr = [];
          searchDimByColor.set(color, arr);
        }
        arr.push(link);
      } else if (!isSelEdge && !isHovEdge && !involved) {
        const color = kindColor(link.kind);
        let arr = dimByColor.get(color);
        if (!arr) {
          arr = [];
          dimByColor.set(color, arr);
        }
        arr.push(link);
      } else {
        highlighted.push(link);
      }
    }

    // helper to stroke an edge segment into the current path. inlined
    // to avoid function-call overhead in a per-edge inner loop.
    function appendEdgeToPath(link: SimLink) {
      const s = link.source as SimNode;
      const t = link.target as SimNode;
      const sx = s.x ?? 0;
      const sy = s.y ?? 0;
      const tx = t.x ?? 0;
      const ty = t.y ?? 0;
      ctx!.moveTo(sx, sy);
      if (curv > 0) {
        const cp = edgeControlPoint(sx, sy, tx, ty);
        ctx!.quadraticCurveTo(cp.cx, cp.cy, tx, ty);
      } else {
        ctx!.lineTo(tx, ty);
      }
    }

    // pass 1a: bulk dim — one path per stroke color.
    ctx.globalAlpha = 0.12;
    ctx.lineWidth = 0.8;
    for (const [color, links] of dimByColor) {
      ctx.strokeStyle = color;
      ctx.beginPath();
      for (const link of links) appendEdgeToPath(link);
      ctx.stroke();
    }
    // pass 1b: search-dim (even fainter).
    if (searchDimByColor.size > 0) {
      ctx.globalAlpha = 0.05;
      ctx.lineWidth = 0.6;
      for (const [color, links] of searchDimByColor) {
        ctx.strokeStyle = color;
        ctx.beginPath();
        for (const link of links) appendEdgeToPath(link);
        ctx.stroke();
      }
    }
    // pass 2: highlighted edges — per-edge style (varies by weight).
    for (const link of highlighted) {
      const isHovEdge = link._key === hovEdge;
      const isSelEdge = selEdges.has(link._key);
      const w = link.weight ?? 0.5;
      ctx.strokeStyle = kindColor(link.kind);
      if (isSelEdge) {
        ctx.globalAlpha = 1;
        ctx.lineWidth = 3 + w * 2;
      } else if (isHovEdge) {
        ctx.globalAlpha = 0.95;
        ctx.lineWidth = 2.5 + w * 1.5;
      } else {
        // involved
        ctx.globalAlpha = 0.85;
        ctx.lineWidth = 1.6 + w * 1.4;
      }
      ctx.beginPath();
      appendEdgeToPath(link);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // (edge labels drawn below in screen space, after nodes)

    // nodes
    animatingMarquee = false;
    for (const n of simNodes) {
      const isEdgeFocus = edgeFocusIds?.has(n.id) ?? false;
      const searchMiss = hasSearch && search ? !search.has(n.id) : false;
      const state =
        n.id === sel
          ? "selected"
          : n.id === hov
            ? "hover"
            : searchMiss
              ? "dimmed"
              : edgeFocusIds
                ? isEdgeFocus
                  ? "selected"
                  : "dimmed"
                : focus && focusConnected && !focusConnected.has(n.id) && n.id !== focus
                  ? "dimmed"
                  : "idle";
      // marquee label overlay only on hover (or edge-focus). when the
      // album is selected the AlbumDetailPopover already shows the info,
      // so the overlay would be redundant + visually noisy.
      const showLabel = n.id === hov || isEdgeFocus;
      drawAlbumNode({
        ctx,
        album: n,
        x: n.x ?? 0,
        y: n.y ?? 0,
        size: nodeSize(),
        state,
        zoom: v.k,
        showLabel,
        time,
        onImageReady: requestDraw,
        onMarquee: () => {
          animatingMarquee = true;
        },
      });
    }
    ctx.restore();

    // edge labels — render only for hovered/selected edges to avoid clutter.
    // drawn in screen units so labels stay readable at any zoom and sit on
    // top of nodes.
    const labelLinks: SimLink[] = [];
    for (const link of simLinks) {
      if (link._key === hovEdge || selEdges.has(link._key)) labelLinks.push(link);
    }
    if (labelLinks.length > 0) {
      ctx.save();
      for (const link of labelLinks) {
        const s = link.source as SimNode;
        const t = link.target as SimNode;
        // anchor labels at the bezier midpoint when curves are on so they
        // ride the sag instead of floating in dead space
        let mx = ((s.x ?? 0) + (t.x ?? 0)) / 2;
        let my = ((s.y ?? 0) + (t.y ?? 0)) / 2;
        if (curv > 0) {
          const cp = edgeControlPoint(s.x ?? 0, s.y ?? 0, t.x ?? 0, t.y ?? 0);
          // quadratic bezier midpoint (t=0.5)
          mx = 0.25 * (s.x ?? 0) + 0.5 * cp.cx + 0.25 * (t.x ?? 0);
          my = 0.25 * (s.y ?? 0) + 0.5 * cp.cy + 0.25 * (t.y ?? 0);
        }
        const sxm = mx * v.k + v.tx;
        const sym = my * v.k + v.ty;
        const kindLabel = link.label ? `${link.kind}: ${link.label}` : link.kind;
        ctx.font = "600 11px system-ui, sans-serif";
        const tw = ctx.measureText(kindLabel).width;
        const padX = 6;
        const bw = tw + padX * 2;
        const bh = 18;
        const bx = sxm - bw / 2;
        const by = sym - bh / 2;
        ctx.fillStyle = "rgba(20,20,28,0.92)";
        ctx.strokeStyle = kindColor(link.kind);
        ctx.lineWidth = 1.5;
        const r = 9;
        ctx.beginPath();
        ctx.moveTo(bx + r, by);
        ctx.lineTo(bx + bw - r, by);
        ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + r);
        ctx.lineTo(bx + bw, by + bh - r);
        ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - r, by + bh);
        ctx.lineTo(bx + r, by + bh);
        ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - r);
        ctx.lineTo(bx, by + r);
        ctx.quadraticCurveTo(bx, by, bx + r, by);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#e6e6e6";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(kindLabel, sxm, sym + 0.5);
      }
      ctx.restore();
    }

    // lasso rect (in screen space)
    const lasso = lassoRect();
    if (lasso) {
      ctx.save();
      ctx.fillStyle = "rgba(255,26,158,0.15)";
      ctx.strokeStyle = "rgba(255,26,158,0.9)";
      ctx.lineWidth = 1;
      ctx.fillRect(lasso.x, lasso.y, lasso.w, lasso.h);
      ctx.strokeRect(lasso.x, lasso.y, lasso.w, lasso.h);
      ctx.restore();
    }
  }

  function collectConnected(id: string): Set<string> {
    const s = new Set<string>([id]);
    for (const l of simLinks) {
      const src = l.source as SimNode;
      const tgt = l.target as SimNode;
      if (src.id === id) s.add(tgt.id);
      else if (tgt.id === id) s.add(src.id);
    }
    return s;
  }

  // ---- coordinate helpers ----------------------------------------------
  function screenToWorld(sx: number, sy: number): [number, number] {
    const v = view();
    return [(sx - v.tx) / v.k, (sy - v.ty) / v.k];
  }

  function clientToScreen(e: { clientX: number; clientY: number }): [number, number] {
    const rect = canvasEl!.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  /** find edge near a screen-space point; threshold in screen px. */
  function findEdgeAt(sx: number, sy: number, threshold = 6): SimLink | null {
    const v = view();
    let best: SimLink | null = null;
    let bestDist = threshold;
    const curved = curvature() > 0;
    for (const l of simLinks) {
      const s = l.source as SimNode;
      const t = l.target as SimNode;
      const sxA = (s.x ?? 0) * v.k + v.tx;
      const syA = (s.y ?? 0) * v.k + v.ty;
      const sxB = (t.x ?? 0) * v.k + v.tx;
      const syB = (t.y ?? 0) * v.k + v.ty;
      let d: number;
      if (curved) {
        // bezier control point in screen space
        const cpW = edgeControlPoint(s.x ?? 0, s.y ?? 0, t.x ?? 0, t.y ?? 0);
        const cpsx = cpW.cx * v.k + v.tx;
        const cpsy = cpW.cy * v.k + v.ty;
        d = pointBezierDist(sx, sy, sxA, syA, cpsx, cpsy, sxB, syB);
      } else {
        d = pointSegDist(sx, sy, sxA, syA, sxB, syB);
      }
      if (d < bestDist) {
        bestDist = d;
        best = l;
      }
    }
    return best;
  }

  // ---- pointer interaction ---------------------------------------------
  type Drag =
    | { type: "node"; node: SimNode; pointerId: number; moved: boolean }
    | {
        type: "pan";
        startX: number;
        startY: number;
        startTx: number;
        startTy: number;
        pointerId: number;
        moved: boolean;
      }
    | {
        type: "lasso";
        startSx: number;
        startSy: number;
        sx: number;
        sy: number;
        pointerId: number;
      };

  const [drag, setDrag] = createSignal<Drag | null>(null);
  const [lassoRect, setLassoRect] = createSignal<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  // for pinch
  let pinchState: {
    p1: { id: number; sx: number; sy: number };
    p2: { id: number; sx: number; sy: number };
    initialDist: number;
    initialK: number;
    initialTx: number;
    initialTy: number;
    centerSx: number;
    centerSy: number;
  } | null = null;
  const activePointers = new Map<number, { sx: number; sy: number }>();

  function onPointerDown(e: PointerEvent) {
    if (!canvasEl) return;
    canvasEl.setPointerCapture(e.pointerId);
    const [sx, sy] = clientToScreen(e);
    activePointers.set(e.pointerId, { sx, sy });

    // pinch-zoom: two fingers
    if (activePointers.size === 2) {
      const [a, b] = [...activePointers.entries()];
      const dx = a[1].sx - b[1].sx;
      const dy = a[1].sy - b[1].sy;
      const v = view();
      pinchState = {
        p1: { id: a[0], ...a[1] },
        p2: { id: b[0], ...b[1] },
        initialDist: Math.hypot(dx, dy) || 1,
        initialK: v.k,
        initialTx: v.tx,
        initialTy: v.ty,
        centerSx: (a[1].sx + b[1].sx) / 2,
        centerSy: (a[1].sy + b[1].sy) / 2,
      };
      setDrag(null);
      return;
    }

    const [wx, wy] = screenToWorld(sx, sy);
    const hit = getHitter().find(wx, wy, nodeSize() * 0.8);
    const tool = props.tool ?? "pan";

    if (hit) {
      // start node drag
      hit.fx = hit.x;
      hit.fy = hit.y;
      sim?.alphaTarget(0.3).restart();
      setDrag({ type: "node", node: hit, pointerId: e.pointerId, moved: false });
    } else if (tool === "lasso") {
      setDrag({ type: "lasso", startSx: sx, startSy: sy, sx, sy, pointerId: e.pointerId });
      setLassoRect({ x: sx, y: sy, w: 0, h: 0 });
    } else {
      const v = view();
      setDrag({
        type: "pan",
        startX: sx,
        startY: sy,
        startTx: v.tx,
        startTy: v.ty,
        pointerId: e.pointerId,
        moved: false,
      });
    }
  }

  function onPointerMove(e: PointerEvent) {
    if (!canvasEl) return;
    const [sx, sy] = clientToScreen(e);
    if (activePointers.has(e.pointerId)) {
      activePointers.set(e.pointerId, { sx, sy });
    }

    // pinch
    if (pinchState && activePointers.size === 2) {
      const a = activePointers.get(pinchState.p1.id);
      const b = activePointers.get(pinchState.p2.id);
      if (!a || !b) return;
      const newDist = Math.hypot(a.sx - b.sx, a.sy - b.sy) || 1;
      const scaleRatio = newDist / pinchState.initialDist;
      const newK = clamp(pinchState.initialK * scaleRatio, 0.1, 8);
      // keep the pinch center anchored
      const cx = (a.sx + b.sx) / 2;
      const cy = (a.sy + b.sy) / 2;
      // world point that was under the initial center
      const wx = (pinchState.centerSx - pinchState.initialTx) / pinchState.initialK;
      const wy = (pinchState.centerSy - pinchState.initialTy) / pinchState.initialK;
      setView({ k: newK, tx: cx - wx * newK, ty: cy - wy * newK });
      requestDraw();
      return;
    }

    const d = drag();
    if (!d || d.pointerId !== e.pointerId) {
      // hover only
      const [wx, wy] = screenToWorld(sx, sy);
      const hit = getHitter().find(wx, wy, nodeSize() * 0.6);
      const newHover = hit?.id ?? null;
      let changed = false;
      if (newHover !== hoverId()) {
        setHoverId(newHover);
        changed = true;
      }
      // edge hover only when no node hover
      if (!hit) {
        const edge = findEdgeAt(sx, sy);
        const newEdgeKey = edge?._key ?? null;
        if (newEdgeKey !== hoverEdgeKey()) {
          setHoverEdgeKey(newEdgeKey);
          props.onEdgeHover?.(edge ?? null, e.clientX, e.clientY);
          changed = true;
        } else if (edge && props.onEdgeHover) {
          // same edge — still update cursor position for follow-tip
          props.onEdgeHover(edge, e.clientX, e.clientY);
        }
        if (canvasEl) canvasEl.style.cursor = edge ? "pointer" : "";
      } else {
        if (hoverEdgeKey() !== null) {
          setHoverEdgeKey(null);
          props.onEdgeHover?.(null, e.clientX, e.clientY);
          changed = true;
        }
        if (canvasEl) canvasEl.style.cursor = "pointer";
      }
      if (changed) requestDraw();
      return;
    }

    if (d.type === "node") {
      const [wx, wy] = screenToWorld(sx, sy);
      d.node.fx = wx;
      d.node.fy = wy;
      d.moved = true;
      sim?.alphaTarget(0.3).restart();
    } else if (d.type === "pan") {
      const ndx = sx - d.startX;
      const ndy = sy - d.startY;
      if (Math.abs(ndx) + Math.abs(ndy) > 3) d.moved = true;
      setView((v) => ({
        ...v,
        tx: d.startTx + ndx,
        ty: d.startTy + ndy,
      }));
      requestDraw();
    } else if (d.type === "lasso") {
      const x = Math.min(d.startSx, sx);
      const y = Math.min(d.startSy, sy);
      const w = Math.abs(sx - d.startSx);
      const h = Math.abs(sy - d.startSy);
      setLassoRect({ x, y, w, h });
      setDrag({ ...d, sx, sy });
      requestDraw();
    }
  }

  function onPointerUp(e: PointerEvent) {
    if (!canvasEl) return;
    try {
      canvasEl.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    activePointers.delete(e.pointerId);
    if (pinchState && (e.pointerId === pinchState.p1.id || e.pointerId === pinchState.p2.id)) {
      pinchState = null;
    }
    const d = drag();
    if (!d || d.pointerId !== e.pointerId) return;

    if (d.type === "node") {
      d.node.fx = null;
      d.node.fy = null;
      sim?.alphaTarget(0);
      // click on node → select; clears any selected edges
      setSelectedEdgeKeys(new Set<string>());
      props.onEdgeSelect?.(null);
      props.onSelect?.(d.node);
      if (props.selectedId === undefined) setInternalSelected(d.node.id);
    } else if (d.type === "lasso") {
      const rect = lassoRect();
      setLassoRect(null);
      if (rect && (rect.w > 4 || rect.h > 4)) {
        const [x0, y0] = screenToWorld(rect.x, rect.y);
        const [x1, y1] = screenToWorld(rect.x + rect.w, rect.y + rect.h);
        const picks = getHitter().findInRect(x0, y0, x1, y1);
        props.onLassoSelect?.(picks);
      }
    } else if (d.type === "pan") {
      if (!d.moved) {
        // click on empty space — check for edge hit; otherwise clear selection
        const [sx, sy] = clientToScreen(e);
        const edge = findEdgeAt(sx, sy);
        if (edge) {
          setSelectedEdgeKeys(new Set([edge._key]));
          // clear node selection so edge is the sole focus
          props.onSelect?.(null);
          if (props.selectedId === undefined) setInternalSelected(null);
          props.onEdgeSelect?.(edge);
        } else {
          setSelectedEdgeKeys(new Set<string>());
          props.onEdgeSelect?.(null);
          props.onSelect?.(null);
          if (props.selectedId === undefined) setInternalSelected(null);
        }
      }
    }
    setDrag(null);
    requestDraw();
  }

  function onWheel(e: WheelEvent) {
    if (!canvasEl) return;
    e.preventDefault();
    const [sx, sy] = clientToScreen(e);
    const v = view();

    // mac trackpad pinch-zoom comes through as wheel + ctrlKey.
    // regular trackpad two-finger scroll: pan.
    // mouse wheel: zoom (deltaMode !== 0 or large discrete deltaY).
    const isPinch = e.ctrlKey;
    const isTrackpadPan =
      !isPinch && e.deltaMode === 0 && (Math.abs(e.deltaX) > 0 || Math.abs(e.deltaY) < 50);

    if (isTrackpadPan) {
      setView({ ...v, tx: v.tx - e.deltaX, ty: v.ty - e.deltaY });
      requestDraw();
      return;
    }

    // zoom — much gentler than before
    const factor = Math.exp(-e.deltaY * (isPinch ? 0.012 : 0.0025));
    const newK = clamp(v.k * factor, 0.1, 8);
    // anchor zoom on cursor
    const wx = (sx - v.tx) / v.k;
    const wy = (sy - v.ty) / v.k;
    setView({ k: newK, tx: sx - wx * newK, ty: sy - wy * newK });
    requestDraw();
  }

  // ---- public-ish viewport actions (parents can wire these via refs;
  // for now exposed via custom events on the container for simplicity) ----
  function zoomBy(factor: number) {
    const v = view();
    const cx = width / 2;
    const cy = height / 2;
    const newK = clamp(v.k * factor, 0.1, 8);
    const wx = (cx - v.tx) / v.k;
    const wy = (cy - v.ty) / v.k;
    setView({ k: newK, tx: cx - wx * newK, ty: cy - wy * newK });
    requestDraw();
  }

  // animate setView from the current transform to a target transform
  // over `durationMs` using an ease-in-out cubic curve. cancels any
  // in-flight animation so successive fit() calls don't fight.
  let viewAnimRaf: number | null = null;
  function animateView(target: ViewportTransform, durationMs = 900) {
    if (viewAnimRaf !== null) {
      cancelAnimationFrame(viewAnimRaf);
      viewAnimRaf = null;
    }
    const start = view();
    const t0 = performance.now();
    const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / durationMs);
      const e = ease(p);
      setView({
        k: start.k + (target.k - start.k) * e,
        tx: start.tx + (target.tx - start.tx) * e,
        ty: start.ty + (target.ty - start.ty) * e,
      });
      requestDraw();
      if (p < 1) viewAnimRaf = requestAnimationFrame(step);
      else viewAnimRaf = null;
    };
    viewAnimRaf = requestAnimationFrame(step);
  }

  function fitToContent() {
    if (simNodes.length === 0) return;
    const sz = nodeSize();
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const n of simNodes) {
      const x = n.x ?? 0,
        y = n.y ?? 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const pad = sz;
    const w = maxX - minX + pad * 2;
    const h = maxY - minY + pad * 2;
    if (w <= 0 || h <= 0) return;
    const k = clamp(Math.min(width / w, height / h), 0.1, 8);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    animateView({ k, tx: width / 2 - cx * k, ty: height / 2 - cy * k });
  }

  function reset() {
    setView({ tx: 0, ty: 0, k: 1 });
    setSelectedEdgeKeys(new Set<string>());
    props.onEdgeSelect?.(null);
    requestDraw();
  }

  // ---- lifecycle --------------------------------------------------------
  onMount(() => {
    if (!canvasEl || !containerEl) return;
    resize();
    rebuild();
    const ro = new ResizeObserver(resize);
    ro.observe(containerEl);

    canvasEl.addEventListener("wheel", onWheel, { passive: false });

    // right-click on a node opens the parent-supplied menu; on empty space
    // we just suppress the default browser menu so panning gestures don't
    // accidentally pop it up.
    const onContextMenu = (ev: MouseEvent) => {
      if (!canvasEl) return;
      const [sx, sy] = clientToScreen(ev);
      const [wx, wy] = screenToWorld(sx, sy);
      const hit = getHitter().find(wx, wy, nodeSize() * 0.8);
      ev.preventDefault();
      if (hit && props.onNodeContextMenu) {
        props.onNodeContextMenu(hit as AlbumNodeData, ev.clientX, ev.clientY);
      }
    };
    canvasEl.addEventListener("contextmenu", onContextMenu);

    // hand the imperative api to the parent for toolbar wiring etc.
    props.onReady?.({
      zoomIn: () => zoomBy(1.2),
      zoomOut: () => zoomBy(1 / 1.2),
      fit: () => fitToContent(),
      reset: () => reset(),
    });

    onCleanup(() => {
      ro.disconnect();
      canvasEl?.removeEventListener("wheel", onWheel);
      canvasEl?.removeEventListener("contextmenu", onContextMenu);
      sim?.stop();
    });
  });

  // rebuild when nodes / edges / enabledKinds change
  createEffect(() => {
    void props.nodes;
    void props.edges;
    void enabledSet();
    rebuild();
  });

  // pause / resume
  createEffect(() => {
    if (!sim) return;
    if (props.paused) sim.stop();
    else sim.alpha(0.2).restart();
  });

  // redraw on curvature change
  createEffect(() => {
    void props.edgeCurvature;
    requestDraw();
  });

  // redraw when the search match set changes (size or identity)
  createEffect(() => {
    void props.searchMatches;
    requestDraw();
  });

  // sync controlled selectedEdges prop → internal edge-key set. matching
  // is done by (kind,label) so callers can synthesise edges without
  // knowing the canvas's per-link generated keys. every link that matches
  // any of the supplied tuples is added to the set so the visual
  // highlight covers the whole sibling cluster.
  createEffect(() => {
    const edges = props.selectedEdges;
    if (edges === undefined) return; // uncontrolled
    if (!edges || edges.length === 0) {
      setSelectedEdgeKeys(new Set<string>());
      requestDraw();
      return;
    }
    const tuples = new Set<string>();
    for (const e of edges) tuples.add(`${String(e.kind)}|${e.label ?? ""}`);
    const keys = new Set<string>();
    for (const l of simLinks) {
      if (tuples.has(`${String(l.kind)}|${l.label ?? ""}`)) keys.add(l._key);
    }
    setSelectedEdgeKeys(keys);
    requestDraw();
  });

  return (
    <div
      ref={containerEl}
      class={`relative w-full h-full overflow-hidden bg-[var(--color-bg)] ${props.class ?? ""}`}
      style={{ "touch-action": "none" }}
    >
      <canvas
        ref={canvasEl}
        class="block w-full h-full"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => {
          let changed = false;
          if (hoverId() !== null) {
            setHoverId(null);
            changed = true;
          }
          if (hoverEdgeKey() !== null) {
            setHoverEdgeKey(null);
            props.onEdgeHover?.(null, 0, 0);
            changed = true;
          }
          if (canvasEl) canvasEl.style.cursor = "";
          if (changed) requestDraw();
        }}
      />
    </div>
  );
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function pointSegDist(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// approximate point-to-quadratic-bezier distance by sampling. cheap and
// good enough for ~6px hit thresholds.
function pointBezierDist(
  px: number,
  py: number,
  ax: number,
  ay: number,
  cx: number,
  cy: number,
  bx: number,
  by: number,
  samples = 12
): number {
  let best = Infinity;
  let prevX = ax;
  let prevY = ay;
  for (let i = 1; i <= samples; i++) {
    const t = i / samples;
    const it = 1 - t;
    const x = it * it * ax + 2 * it * t * cx + t * t * bx;
    const y = it * it * ay + 2 * it * t * cy + t * t * by;
    const d = pointSegDist(px, py, prevX, prevY, x, y);
    if (d < best) best = d;
    prevX = x;
    prevY = y;
  }
  return best;
}
