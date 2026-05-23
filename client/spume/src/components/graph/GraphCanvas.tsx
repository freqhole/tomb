// GraphCanvas — force-directed graph (album + artist nodes) rendered to html5 canvas 2d.
//
// responsibilities:
// - drive a d3-force simulation hosted in a dedicated web worker
//   (see [./worker/graphWorker.ts](./worker/graphWorker.ts)), receiving
//   per-tick node positions over a transferable Float32Array buffer
// - draw nodes (via drawAlbumNode / drawArtistNode) and edges (per-kind colored strokes)
// - handle pan/zoom (wheel + trackpad two-finger pan + drag + pinch) and node drag
//   (drag-pin state is forwarded to the worker via pin/unpin messages)
// - emit hover / select events for both nodes AND edges; support optional lasso
// - hit-testing is fully async via the worker (quadtree owned by the
//   worker); hover queries are rAF-coalesced + cancellable, pointerdown
//   issues a press-pending query with timeout that auto-falls-back to
//   pan if the worker doesn't respond in time.
//
// the component is presentational: the parent supplies nodes/edges + relation
// filter state, and reacts to selection events. it does NOT fetch data.

import { createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import type { SimulationLinkDatum, SimulationNodeDatum } from "d3-force";
import { drawAlbumNode } from "./drawAlbumNode";
import { drawArtistNode } from "./drawArtistNode";
import { RELATION_COLOR } from "./relations";
import type {
  AlbumNodeData,
  ArtistNodeData,
  GraphEdge,
  GraphNode,
  GraphNodeData,
  RelationKind,
  ViewportTransform,
} from "./types";
import { nodeKind } from "./types";
import { createGraphWorkerClient, type GraphWorkerClient } from "./worker/graphWorkerClient";
import type { EdgeDeriveConfig, SimLinkInit, SimNodeInit, UpdateMode } from "./worker/messages";
import { bump, gauge, timing } from "./perfLog";

export interface GraphCanvasProps {
  nodes: GraphNodeData[];
  /** legacy: pre-built edges from the parent. when omitted (and
   *  `onEdges` is set) the worker derives edges from node taxonomy
   *  itself — see phase 4 of the worker plan. */
  edges?: GraphEdge[];
  /** phase 4: subscribe to worker-derived edges. when provided,
   *  GraphCanvas engages worker-side edge derivation: it forwards
   *  the full node taxonomy + `relatedArtists` to the worker, the
   *  worker runs `buildRelationEdges` off the main thread, and the
   *  full edge list streams back through this callback. */
  onEdges?: (edges: GraphEdge[]) => void;
  /** phase 4: resolved related-artist relationships (artist_id →
   *  set of related artist ids). forwarded to the worker for the
   *  `related_artist` edge kind. ignored in legacy mode. */
  relatedArtists?: Map<string, Set<string>>;
  /** which relation kinds to render edges for; undefined = all */
  enabledKinds?: Set<string> | string[];
  /** node tile size in world units. default 56. */
  nodeSize?: number;
  /** controlled selection (parent owns state) */
  selectedId?: string | null;
  /** additional selected node ids (for shift/cmd multi-select). these
   *  render the same magenta ring as `selectedId` but don't drive
   *  popovers or edge-focus highlighting — the parent decides what to
   *  do with the extra picks. */
  selectedIds?: Set<string>;
  /** node click — second arg conveys keyboard modifier intent:
   *  `multi=true` when shift/meta/ctrl was held during the click,
   *  signalling the parent to toggle into a multi-selection set. */
  onSelect?: (node: GraphNodeData | null, opts?: { multi?: boolean }) => void;
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
  onLassoSelect?: (nodes: GraphNodeData[]) => void;
  /** fires the first time the user manually pans / zooms / pinches the
   *  canvas. parents use this to stop auto-fitting the viewport when
   *  new node batches land (otherwise we'd yank the camera mid-inspect). */
  onUserInteract?: () => void;
  /** when true, structural updates (new node batches, resize) do NOT
   *  reheat the force sim. existing nodes keep their positions and new
   *  nodes appear at their phyllotaxis seed without nudging neighbors.
   *  parents flip this on once the user has started inspecting the
   *  graph so late-arriving pages don't cause a periodic shift. */
  quietUpdates?: boolean;
  /** right-click / long-press on a node — parent renders its own menu */
  onNodeContextMenu?: (node: GraphNodeData, clientX: number, clientY: number) => void;
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
  /** when true, nodes can't be dragged around the canvas. pressing a
   *  node still selects it on release (same as a click), but the press
   *  no longer pins the node + reheats the sim. avoids the "wobbly on
   *  click" feel and keeps big graphs steady when the user just wants
   *  to inspect a node. pan + lasso + zoom still work as normal. */
  lockNodes?: boolean;
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
  // include label so two links sharing (kind, src, tgt) but with
  // different labels (e.g., albums sharing two genres) get distinct
  // keys. without this, selEdges collapses them and sibling expansion
  // bleeds across other labels of the same kind.
  return `${e.kind}:${e.label ?? ""}:${s}->${t}`;
}

export function GraphCanvas(props: GraphCanvasProps) {
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
  // cursor position in screen space while hovering an edge — used to
  // anchor the hover label as a follow-tip near the pointer rather than
  // at the wire midpoint.
  let hoverEdgeScreenPos: { sx: number; sy: number } | null = null;
  const [internalSelected, setInternalSelected] = createSignal<string | null>(null);
  const [selectedEdgeKeys, setSelectedEdgeKeys] = createSignal<Set<string>>(new Set());
  const selectedId = () => props.selectedId ?? internalSelected();

  // ---- simulation -------------------------------------------------------
  // the d3-force sim lives in a web worker. main thread keeps `simNodes`
  // + `simLinks` as the rendering substrate (still mutated x/y on each
  // received position tick), so the existing draw / hit-test / fit
  // paths keep working unchanged.
  let worker: GraphWorkerClient | null = null;
  let simNodes: SimNode[] = [];
  let simLinks: SimLink[] = [];
  // phase 4: when in worker-edge-derivation mode, the full edge list
  // emitted by the worker is cached here so changes to `enabledKinds`
  // can re-filter `simLinks` locally without round-tripping nodes
  // through the worker.
  let cachedDerivedEdges: GraphEdge[] = [];
  // node lookup by id — kept in sync with simNodes on every rebuild.
  // used to map worker hit-test responses (which only carry ids) back
  // to the local SimNode refs that the renderer + drag code uses.
  let simNodesById: Map<string, SimNode> = new Map();
  // monotonically-increasing id stamped on each press; lets us
  // discard stale worker.hitTest replies if the press was already
  // converted/cancelled.
  let nextPressId = 1;

  // hover hit-test state. coalesces pointermove events to a single
  // rAF-driven worker.hitTest, aborting the in-flight previous one.
  let lastHoverScreenPos: { sx: number; sy: number; clientX: number; clientY: number } | null =
    null;
  let hoverHitAbort: AbortController | null = null;
  let hoverScheduled = false;
  function scheduleHoverHitTest() {
    if (hoverScheduled) return;
    hoverScheduled = true;
    requestAnimationFrame(() => {
      hoverScheduled = false;
      const pos = lastHoverScreenPos;
      if (!pos || !worker) return;
      hoverHitAbort?.abort();
      hoverHitAbort = new AbortController();
      const [wx, wy] = screenToWorld(pos.sx, pos.sy);
      const v0 = view();
      // hit radius in world units. ~half the node side gives a hit
      // area roughly matching the visible square (with a small
      // fudge for the rounded corners); floored at ~12 screen px so
      // tiny zoomed-out nodes stay clickable. larger values steal
      // pixels from edge hit-testing and feel sticky at high zoom.
      const hitRadius = Math.max(nodeSize() * 0.55, 12 / v0.k);
      worker
        .hitTest(wx, wy, hitRadius, hoverHitAbort.signal)
        .then((nodeId) => resolveHover(nodeId, pos))
        .catch(() => {
          // aborted by a newer pointermove — ignore.
        });
    });
  }
  /** apply hover hit result to the canvas state. mirrors the
   *  original sync hover branch's node + edge bookkeeping. */
  function resolveHover(
    nodeId: string | null,
    pos: { sx: number; sy: number; clientX: number; clientY: number }
  ) {
    const hit = nodeId ? (simNodesById.get(nodeId) ?? null) : null;
    const newHover = hit?.id ?? null;
    let changed = false;
    if (newHover !== hoverId()) {
      setHoverId(newHover);
      changed = true;
    }
    if (!hit) {
      const edge = findEdgeAt(pos.sx, pos.sy);
      const newEdgeKey = edge?._key ?? null;
      if (newEdgeKey !== hoverEdgeKey()) {
        setHoverEdgeKey(newEdgeKey);
        hoverEdgeScreenPos = edge ? { sx: pos.sx, sy: pos.sy } : null;
        props.onEdgeHover?.(edge ?? null, pos.clientX, pos.clientY);
        changed = true;
      } else if (edge && props.onEdgeHover) {
        hoverEdgeScreenPos = { sx: pos.sx, sy: pos.sy };
        props.onEdgeHover(edge, pos.clientX, pos.clientY);
        changed = true;
      }
      if (canvasEl) canvasEl.style.cursor = edge ? "pointer" : "";
    } else {
      if (hoverEdgeKey() !== null) {
        setHoverEdgeKey(null);
        hoverEdgeScreenPos = null;
        props.onEdgeHover?.(null, pos.clientX, pos.clientY);
        changed = true;
      }
      if (canvasEl) canvasEl.style.cursor = "pointer";
    }
    if (changed) requestDraw();
  }

  /** combine multiple AbortSignals into one — fires when any input
   *  fires. small polyfill since `AbortSignal.any` isn't yet
   *  universally available (safari/older chromium). */
  function anySignal(signals: AbortSignal[]): AbortSignal {
    const ctrl = new AbortController();
    const onAbort = (s: AbortSignal) => {
      if (!ctrl.signal.aborted) ctrl.abort((s as AbortSignal & { reason?: unknown }).reason);
    };
    for (const s of signals) {
      if (s.aborted) {
        onAbort(s);
        break;
      }
      s.addEventListener("abort", () => onAbort(s), { once: true });
    }
    return ctrl.signal;
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
    if (worker) {
      // tell the worker the new viewport bounds; reheat only if the
      // user isn't actively inspecting (matches the old behaviour).
      worker.resize(width, height, !props.quietUpdates);
      if (props.quietUpdates) {
        if (
          typeof console !== "undefined" &&
          (window as unknown as { __DEBUG_GRAPH__?: boolean }).__DEBUG_GRAPH__
        ) {
          console.debug("[graph] resize: quiet (no reheat)");
        }
      }
    }
    requestDraw();
  }

  // ---- rebuild sim on data change --------------------------------------

  // tracks whether a real layout pass has happened yet. on the very first
  // rebuild we need to actually run forces from scratch; subsequent
  // rebuilds (e.g. relation kind toggled) should preserve positions and
  // only nudge the sim with a low alpha so nothing visibly shuffles.
  let firstBuild = true;

  /** phase 4: edge-derivation mode is engaged whenever the parent
   *  provides an `onEdges` callback. in that mode GraphCanvas hands
   *  full node taxonomy to the worker and lets it compute edges off
   *  the main thread. when the callback is absent we fall back to
   *  the legacy `props.edges` path. */
  const deriveMode = (): boolean => !!props.onEdges;

  /** build the payload sent to the worker on init/update. in derive
   *  mode this includes the taxonomy fields `buildRelationEdges` needs;
   *  in legacy mode it stays minimal (the worker uses pre-built
   *  links instead). */
  function buildWorkerNodes(): SimNodeInit[] {
    if (!deriveMode()) {
      return simNodes.map((n) => ({
        id: n.id,
        kind: nodeKind(n),
        x: n.x,
        y: n.y,
        fx: n.fx,
        fy: n.fy,
      }));
    }
    return simNodes.map((n) => {
      const base: SimNodeInit = {
        id: n.id,
        kind: nodeKind(n),
        x: n.x,
        y: n.y,
        fx: n.fx,
        fy: n.fy,
        isFavorite: n.isFavorite,
        genres: n.genres,
        tagLabels: n.tags?.map((t) => t.label),
        moods: n.moods,
        styles: n.styles,
        label: n.label,
        era: n.era,
      };
      if (nodeKind(n) === "artist") {
        const a = n as ArtistNodeData;
        base.artistId = a.artistId;
        base.name = a.name;
      } else {
        const a = n as AlbumNodeData;
        base.artistId = a.artistId;
        base.artistName = a.artistName;
      }
      return base;
    });
  }

  /** snapshot the parent's current edge-derive config for the worker. */
  function buildEdgeConfig(): EdgeDeriveConfig | undefined {
    if (!deriveMode()) return undefined;
    const e = props.enabledKinds;
    const kinds = e
      ? Array.isArray(e)
        ? (e as RelationKind[])
        : (Array.from(e) as RelationKind[])
      : undefined;
    return {
      enabledKinds: kinds,
      relatedArtists: props.relatedArtists,
    };
  }

  /** rebuild `simLinks` (the renderer's substrate) from the cached
   *  worker-derived edges, filtered by the currently enabled kinds.
   *  drops any edge whose endpoints aren't in the current `simNodes`
   *  (briefly possible between a topology update and the next worker
   *  emission). */
  function rebuildSimLinksFromCache(): void {
    const byId = simNodesById;
    const set = enabledSet();
    simLinks = cachedDerivedEdges
      .filter((e) => !set || set.has(e.kind))
      .map((e) => {
        const srcId = typeof e.source === "string" ? e.source : e.source.id;
        const tgtId = typeof e.target === "string" ? e.target : e.target.id;
        const s = byId.get(srcId);
        const t = byId.get(tgtId);
        if (!s || !t) return null;
        return { ...e, source: s, target: t, _key: edgeKey(e) } as SimLink;
      })
      .filter((x): x is SimLink => x !== null);
  }

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
    simNodesById = byId;

    if (deriveMode()) {
      // worker will derive + emit edges; rebuild simLinks from the
      // cached set right away so the renderer has *something* until
      // the next emission lands. (cache may be stale for one frame
      // when nodes were just added — endpoints missing from `byId`
      // are dropped by `rebuildSimLinksFromCache`.)
      rebuildSimLinksFromCache();
    } else {
      simLinks = (props.edges ?? [])
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
    }

    // package the sim-relevant subset of nodes/links for the worker.
    const workerNodes = buildWorkerNodes();
    const workerLinks: SimLinkInit[] = deriveMode()
      ? []
      : simLinks.map((l) => ({
          source: (l.source as SimNode).id,
          target: (l.target as SimNode).id,
          kind: l.kind,
          weight: l.weight,
          label: l.label,
        }));
    const edgeConfig = buildEdgeConfig();

    const mode: UpdateMode = firstBuild ? "fresh" : props.quietUpdates ? "quiet" : "nudge";

    if (!worker) {
      worker = createGraphWorkerClient();
      // listener writes positions back into simNodes so every
      // downstream consumer (renderer, hitTest, fit) keeps working
      // against the same data shape it always did. throttled
      // hitter invalidation matches the pre-worker behaviour.
      worker.onPositions((buf) => {
        // length mismatch can happen briefly between an `update`
        // dispatch and the worker's next tick: the worker may emit
        // one last buffer of the previous size while we've already
        // resized simNodes locally. drop those stale buffers.
        if (buf.length === simNodes.length * 2) {
          for (let i = 0; i < simNodes.length; i++) {
            simNodes[i].x = buf[i * 2];
            simNodes[i].y = buf[i * 2 + 1];
          }
          requestDraw();
        }
        worker?.release(buf);
      });
      worker.onTopology(() => {
        // currently a no-op on the main thread; the alpha field is
        // available for future "settled" UI affordances.
      });
      // phase 4: full edge list streams in from worker after every
      // topology change. cache it, rebuild simLinks for the
      // renderer, forward to the parent for ui (counts, popovers).
      worker.onEdges((edges) => {
        cachedDerivedEdges = edges;
        rebuildSimLinksFromCache();
        requestDraw();
        props.onEdges?.(edges);
      });
      worker.init(
        workerNodes,
        workerLinks,
        {
          nodeSize: nodeSize(),
          width,
          height,
          paused: !!props.paused,
        },
        edgeConfig
      );
      if (
        typeof console !== "undefined" &&
        (window as unknown as { __DEBUG_GRAPH__?: boolean }).__DEBUG_GRAPH__
      ) {
        console.debug(`[graph] init: nodes=${simNodes.length} links=${simLinks.length}`);
      }
      firstBuild = false;
      return;
    }

    if (mode === "quiet") {
      if (
        typeof console !== "undefined" &&
        (window as unknown as { __DEBUG_GRAPH__?: boolean }).__DEBUG_GRAPH__
      ) {
        console.debug(
          `[graph] rebuild: quiet (no reheat), nodes=${simNodes.length} links=${simLinks.length}`
        );
      }
    } else if (mode === "nudge") {
      if (
        typeof console !== "undefined" &&
        (window as unknown as { __DEBUG_GRAPH__?: boolean }).__DEBUG_GRAPH__
      ) {
        console.debug(
          `[graph] rebuild: nudge alpha=0.08, nodes=${simNodes.length} links=${simLinks.length}`
        );
      }
    }
    worker.update(workerNodes, workerLinks, mode, edgeConfig);
    if (mode === "quiet") {
      // worker emits one frame on quiet so new nodes show up. force a
      // local draw too in case the buffer arrives before the rAF lands.
      requestDraw();
    }
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
      performance.mark("graph-draw-start");
      const t0 = performance.now();
      draw(t);
      const dt = performance.now() - t0;
      performance.measure("graph-draw", "graph-draw-start");
      performance.clearMarks("graph-draw-start");
      timing("draw.frame", dt);
      bump("draw.frame.count");
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
    const multiSel = props.selectedIds;
    // collect hover/selection nodes to draw in a second pass so they
    // stack on top of their neighbours — helps in dense clusters
    // where the node the user is interacting with would otherwise be
    // half-occluded by adjacent nodes.
    const deferred: SimNode[] = [];
    // capture into a locally non-null binding so the helper closure
    // below doesn't lose the narrowing across the function boundary.
    const nctx = ctx;
    function drawOne(n: SimNode) {
      const isEdgeFocus = edgeFocusIds?.has(n.id) ?? false;
      const searchMiss = hasSearch && search ? !search.has(n.id) : false;
      const isMulti = multiSel?.has(n.id) ?? false;
      // selection takes precedence over every other state so that
      // explicitly-picked nodes (single click or shift/cmd add) always
      // render the magenta ring. edge-focused nodes are intentionally
      // demoted to "idle" so they remain visible without inheriting
      // the selection ring — only direct user picks earn the ring.
      const state =
        n.id === sel || isMulti
          ? "selected"
          : n.id === hov
            ? "hover"
            : searchMiss
              ? "dimmed"
              : edgeFocusIds
                ? isEdgeFocus
                  ? "idle"
                  : "dimmed"
                : focus && focusConnected && !focusConnected.has(n.id) && n.id !== focus
                  ? "dimmed"
                  : "idle";
      // marquee label overlay only on hover. when an album is selected
      // (directly or via an edge-focus that lit up its node ring) the
      // AlbumDetailPopover already shows the info, so overlaying a
      // marquee here would be redundant + visually noisy.
      const showLabel = n.id === hov;
      if (nodeKind(n) === "artist") {
        drawArtistNode({
          ctx: nctx,
          artist: n as ArtistNodeData,
          x: n.x ?? 0,
          y: n.y ?? 0,
          size: nodeSize(),
          state,
          zoom: v.k,
          onImageReady: requestDraw,
        });
      } else {
        drawAlbumNode({
          ctx: nctx,
          album: n as AlbumNodeData,
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
    }
    // viewport culling: only nodes whose bounding-box intersects the
    // visible world rect are drawn. saves the per-frame drawImage +
    // roundRect + clip cost for every off-screen node (typically the
    // majority once the user zooms in on a cluster).
    //
    // bounds are computed in world units from the current pan/zoom:
    //   wx_min = -tx / k       (left edge of canvas in world space)
    //   wx_max = (width - tx) / k
    // a node centred at (n.x, n.y) is visible when its half-extent
    // brushes the rect — `pad` covers the rounded-corner border, the
    // marquee label, and the magenta selection ring.
    const halfNode = nodeSize() / 2;
    const cullPad = halfNode + 8 / Math.max(v.k, 0.05);
    const cxMin = -v.tx / v.k - cullPad;
    const cxMax = (width - v.tx) / v.k + cullPad;
    const cyMin = -v.ty / v.k - cullPad;
    const cyMax = (height - v.ty) / v.k + cullPad;
    let drawnCount = 0;
    let culledCount = 0;
    for (const n of simNodes) {
      const isMulti = multiSel?.has(n.id) ?? false;
      // defer hovered + selected (single or multi) nodes to a
      // second pass so they paint on top of everything else.
      if (n.id === hov || n.id === sel || isMulti) {
        deferred.push(n);
        continue;
      }
      const nx = n.x ?? 0;
      const ny = n.y ?? 0;
      if (nx < cxMin || nx > cxMax || ny < cyMin || ny > cyMax) {
        culledCount += 1;
        continue;
      }
      drawOne(n);
      drawnCount += 1;
    }
    // second pass: deferred (hover/selected) nodes on top. multi-select
    // can be many — still cheap because we're only re-iterating the
    // small picked subset, not the full simNodes array.
    for (const n of deferred) drawOne(n);
    gauge("nodes.total", simNodes.length);
    gauge("edges.total", simLinks.length);
    bump("draw.nodes.drawn", drawnCount);
    bump("draw.nodes.culled", culledCount);
    bump("draw.nodes.deferred", deferred.length);
    ctx.restore();

    // node labels (screen space) — hover/selection focus only.
    // hovered or selected node gets a readable label below the node
    // (artist name for artist circles, title + artist for albums).
    // albums delegate the in-tile band to drawAlbumNode only when the
    // tile is big enough on screen; at low zoom the in-tile overlay
    // is suppressed and this pass renders the label below the tile
    // instead so it stays legible. non-focused nodes get no label.
    {
      const ns = nodeSize() * v.k;
      ctx.save();
      ctx.font = "600 11px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      type NodeLabel = {
        text: string;
        sub?: string;
        sx: number;
        sy: number;
        isFocus: boolean;
      };
      const focusLabels: NodeLabel[] = [];

      // candidate iteration — only nodes visible on screen.
      for (const n of simNodes) {
        const nsx = (n.x ?? 0) * v.k + v.tx;
        const nsy = (n.y ?? 0) * v.k + v.ty;
        if (nsx + ns < -40 || nsx - ns > width + 40) continue;
        if (nsy + ns < -40 || nsy - ns > height + 40) continue;
        const isFocus = n.id === hov || n.id === sel;
        if (!isFocus) continue;
        const kind = nodeKind(n);
        if (kind === "artist") {
          const a = n as ArtistNodeData;
          focusLabels.push({
            text: a.name ?? a.abbreviation ?? "",
            sx: nsx,
            sy: nsy + ns / 2 + 10,
            isFocus: true,
          });
        } else {
          const al = n as AlbumNodeData;
          // when the in-tile overlay is rendering (large enough),
          // suppress the external label so we don't double up.
          if (ns >= 64) continue;
          focusLabels.push({
            text: al.title ?? "",
            sub: al.artistName ?? "",
            sx: nsx,
            sy: nsy + ns / 2 + 10,
            isFocus: true,
          });
        }
      }

      // collision-aware placement (focus labels always placed first).
      const placed: { x: number; y: number; w: number; h: number }[] = [];

      const measure = (text: string): number => ctx.measureText(text).width;
      const clipText = (text: string, maxW: number): string => {
        if (measure(text) <= maxW) return text;
        const ell = "…";
        let lo = 0,
          hi = text.length;
        while (lo < hi) {
          const mid = (lo + hi + 1) >> 1;
          if (measure(text.slice(0, mid) + ell) <= maxW) lo = mid;
          else hi = mid - 1;
        }
        return text.slice(0, lo) + ell;
      };

      const maxLabelW = 180;
      const padX = 6;
      const lineH = 13;

      const drawPill = (l: NodeLabel, primary: string, secondary: string | null) => {
        const bh = secondary ? lineH * 2 + 4 : lineH + 4;
        const tw1 = measure(primary);
        const tw2 = secondary ? measure(secondary) : 0;
        const bw = Math.max(tw1, tw2) + padX * 2;
        const bx = l.sx - bw / 2;
        const by = l.sy;
        // backdrop
        ctx.fillStyle = "rgba(20,20,28,0.88)";
        const rr = 5;
        ctx.beginPath();
        ctx.moveTo(bx + rr, by);
        ctx.lineTo(bx + bw - rr, by);
        ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + rr);
        ctx.lineTo(bx + bw, by + bh - rr);
        ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - rr, by + bh);
        ctx.lineTo(bx + rr, by + bh);
        ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - rr);
        ctx.lineTo(bx, by + rr);
        ctx.quadraticCurveTo(bx, by, bx + rr, by);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "#e6e6e6";
        const baseY = secondary ? by + 2 + lineH / 2 : by + 2 + lineH / 2;
        ctx.fillText(primary, l.sx, baseY);
        if (secondary) {
          ctx.fillStyle = "#9aa0aa";
          ctx.fillText(secondary, l.sx, by + 2 + lineH + lineH / 2);
        }
      };

      // focus labels: always render
      for (const l of focusLabels) {
        if (!l.text && !l.sub) continue;
        const primary = clipText(l.text, maxLabelW);
        const secondary = l.sub ? clipText(l.sub, maxLabelW) : null;
        const tw1 = measure(primary);
        const tw2 = secondary ? measure(secondary) : 0;
        const bw = Math.max(tw1, tw2) + padX * 2;
        const bh = secondary ? lineH * 2 + 4 : lineH + 4;
        const bx = l.sx - bw / 2;
        const by = l.sy;
        placed.push({ x: bx, y: by, w: bw, h: bh });
        drawPill(l, primary, secondary);
      }

      ctx.restore();
    }

    // edge labels — render hovered edge as a follow-tip near the cursor,
    // plus a scattered subset of selected edges so dense clusters don't
    // drown the canvas in pills. labels avoid overlapping node tiles and
    // each other; the selected-edge cap scales with viewport area.
    type LabelCand = {
      link: SimLink;
      sxm: number;
      sym: number;
      isHover: boolean;
    };
    const candidates: LabelCand[] = [];
    for (const link of simLinks) {
      const isHov = link._key === hovEdge;
      const isSel = selEdges.has(link._key);
      if (!isHov && !isSel) continue;
      let sxm: number;
      let sym: number;
      if (isHov && hoverEdgeScreenPos) {
        // anchor slightly above-right of the cursor so it doesn't
        // obstruct the wire being inspected.
        sxm = hoverEdgeScreenPos.sx + 14;
        sym = hoverEdgeScreenPos.sy - 14;
      } else {
        const s = link.source as SimNode;
        const t = link.target as SimNode;
        let mx = ((s.x ?? 0) + (t.x ?? 0)) / 2;
        let my = ((s.y ?? 0) + (t.y ?? 0)) / 2;
        if (curv > 0) {
          const cp = edgeControlPoint(s.x ?? 0, s.y ?? 0, t.x ?? 0, t.y ?? 0);
          mx = 0.25 * (s.x ?? 0) + 0.5 * cp.cx + 0.25 * (t.x ?? 0);
          my = 0.25 * (s.y ?? 0) + 0.5 * cp.cy + 0.25 * (t.y ?? 0);
        }
        sxm = mx * v.k + v.tx;
        sym = my * v.k + v.ty;
      }
      candidates.push({ link, sxm, sym, isHover: isHov });
    }

    if (candidates.length > 0) {
      ctx.save();
      ctx.font = "600 11px system-ui, sans-serif";

      // node screen rects for collision (only visible nodes worth
      // checking against; off-screen ones can't intersect anything).
      const ns = nodeSize() * v.k;
      const nodeRects: { x: number; y: number; w: number; h: number }[] = [];
      for (const n of simNodes) {
        const nsx = (n.x ?? 0) * v.k + v.tx;
        const nsy = (n.y ?? 0) * v.k + v.ty;
        if (nsx + ns < 0 || nsy + ns < 0 || nsx - ns > width || nsy - ns > height) continue;
        nodeRects.push({ x: nsx - ns / 2, y: nsy - ns / 2, w: ns, h: ns });
      }

      // cap selected-edge labels by viewport area so a 10k-node graph
      // doesn't try to render 1000 pills at once. hover label is always
      // drawn regardless of cap.
      const areaCap = Math.max(4, Math.min(20, Math.floor((width * height) / 40000)));

      // deterministic scatter: stable hash by `_key` so the same edges
      // get picked across redraws (no flicker as the user pans/zooms).
      const hash = (s: string): number => {
        let h = 2166136261;
        for (let i = 0; i < s.length; i++) {
          h ^= s.charCodeAt(i);
          h = Math.imul(h, 16777619);
        }
        return h >>> 0;
      };
      const hovCands: LabelCand[] = [];
      const selCands: LabelCand[] = [];
      for (const c of candidates) {
        (c.isHover ? hovCands : selCands).push(c);
      }
      selCands.sort((a, b) => hash(a.link._key) - hash(b.link._key));

      const placed: { x: number; y: number; w: number; h: number }[] = [];
      const labelsToDraw: LabelCand[] = [];
      const overlap = (
        a: { x: number; y: number; w: number; h: number },
        b: { x: number; y: number; w: number; h: number },
        pad = 0
      ): boolean =>
        a.x < b.x + b.w + pad &&
        a.x + a.w + pad > b.x &&
        a.y < b.y + b.h + pad &&
        a.y + a.h + pad > b.y;

      const tryPlace = (c: LabelCand, ignoreNodeOverlap: boolean): boolean => {
        const text = c.link.label ? `${c.link.kind}: ${c.link.label}` : (c.link.kind as string);
        const tw = ctx.measureText(text).width;
        const padX = 6;
        const bw = tw + padX * 2;
        const bh = 18;
        // clamp inside viewport so follow-tip doesn't drift off-screen
        const bx = Math.min(width - bw - 4, Math.max(4, c.sxm - bw / 2));
        const by = Math.min(height - bh - 4, Math.max(4, c.sym - bh / 2));
        const rect = { x: bx, y: by, w: bw, h: bh };
        if (!ignoreNodeOverlap) {
          for (const r of nodeRects) if (overlap(rect, r, 2)) return false;
        }
        for (const p of placed) if (overlap(rect, p, 4)) return false;
        placed.push(rect);
        labelsToDraw.push({ ...c, sxm: bx + bw / 2, sym: by + bh / 2 });
        return true;
      };

      // when zoomed out, nodes shrink on screen and edge midpoints end
      // up near (or behind) several node rects each — strict node-overlap
      // rejection would suppress almost every label. relax it below this
      // threshold so labels remain visible further out; placed-label
      // collision still prevents the pills from stacking on top of each
      // other.
      const lowZoom = v.k < 0.7;

      // hover label always renders (best-effort node collision, but
      // doesn't block).
      for (const c of hovCands) {
        if (!tryPlace(c, lowZoom)) tryPlace(c, true);
      }
      for (const c of selCands) {
        if (labelsToDraw.length >= areaCap + hovCands.length) break;
        if (!tryPlace(c, lowZoom) && lowZoom) tryPlace(c, true);
      }

      // actual draw pass
      for (const c of labelsToDraw) {
        const link = c.link;
        const text = link.label ? `${link.kind}: ${link.label}` : (link.kind as string);
        const tw = ctx.measureText(text).width;
        const padX = 6;
        const bw = tw + padX * 2;
        const bh = 18;
        const bx = c.sxm - bw / 2;
        const by = c.sym - bh / 2;
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
        ctx.fillText(text, c.sxm, c.sym + 0.5);
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
    | {
        // pointerdown is awaiting an async hit-test result. while in
        // this state we buffer the latest pointer position so we can
        // either upgrade to a node-drag, or convert to pan/lasso as
        // soon as we know whether the press landed on a node. if the
        // user moves > 3 screen px before the result arrives we
        // abort the request and convert to pan immediately so panning
        // never feels stuck behind the worker's response time.
        type: "press";
        pointerId: number;
        startSx: number;
        startSy: number;
        latestSx: number;
        latestSy: number;
        multi: boolean;
        tool: "pan" | "lasso";
        startTx: number;
        startTy: number;
        // monotonically-increasing press id; the worker's hit-test
        // resolve callback checks this against the current drag to
        // discard stale results (in case the press was already
        // converted/cancelled by movement, timeout, or pointerup).
        pressId: number;
        // true if pointerup fired before the hit-test resolved \u2014
        // when the hit eventually arrives we treat it as a click.
        released: boolean;
        // signal used to cancel the in-flight worker.hitTest. fires
        // on movement-beyond-threshold or on pointerup.
        abort: AbortController;
      }
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
    // same radius math as the hover path so press-to-select behaves
    // identically to hover for click affordance.
    const v1 = view();
    const pressRadius = Math.max(nodeSize() * 0.55, 12 / v1.k);
    const tool = props.tool ?? "pan";
    const multi = e.shiftKey || e.metaKey || e.ctrlKey;

    // enter "press" state immediately so we never block the pointer
    // pipeline on the worker. the actual node-vs-empty decision is
    // resolved when worker.hitTest replies (or when we abort because
    // the user started moving or released).
    const pressId = nextPressId++;
    const abort = new AbortController();
    setDrag({
      type: "press",
      pointerId: e.pointerId,
      startSx: sx,
      startSy: sy,
      latestSx: sx,
      latestSy: sy,
      multi,
      tool,
      startTx: v1.tx,
      startTy: v1.ty,
      pressId,
      released: false,
      abort,
    });

    if (!worker) {
      // no worker (shouldn't happen post-mount) \u2014 treat as no-hit.
      onPressResolved(pressId, null);
      return;
    }
    // ~100ms timeout: if the worker is busy enough that hit-test
    // can't return in 100ms, fall back to no-hit so panning still
    // works snappily. callers (drag/click) will get the "wrong"
    // result only in degenerate cases.
    const timeoutSignal = AbortSignal.timeout(100);
    const combined = anySignal([abort.signal, timeoutSignal]);
    worker
      .hitTest(wx, wy, pressRadius, combined)
      .then((nodeId) => onPressResolved(pressId, nodeId))
      .catch(() => {
        // aborted (by movement, pointerup, or timeout) \u2014 if still
        // in press state for this id, finalize as no-hit. abort by
        // pointermove already converted to pan, so this is mostly
        // for timeout.
        const d = drag();
        if (d?.type === "press" && d.pressId === pressId) {
          onPressResolved(pressId, null);
        }
      });
  }

  /** finalize a press: convert the "press" drag state to node/pan/lasso
   *  (or fire click-select if pointerup already happened). */
  function onPressResolved(pressId: number, nodeId: string | null) {
    const d = drag();
    if (!d || d.type !== "press" || d.pressId !== pressId) return;
    const hit = nodeId ? (simNodesById.get(nodeId) ?? null) : null;

    if (d.released) {
      // pointerup already fired \u2014 treat as click.
      setDrag(null);
      if (hit) {
        setSelectedEdgeKeys(new Set<string>());
        props.onEdgeSelect?.(null);
        props.onSelect?.(hit, { multi: d.multi });
        if (!d.multi && props.selectedId === undefined) setInternalSelected(hit.id);
      } else {
        // click on empty \u2014 mirror the old onPointerUp empty-pan path
        const edge = findEdgeAt(d.startSx, d.startSy);
        if (edge) {
          setSelectedEdgeKeys(new Set([edge._key]));
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
      requestDraw();
      return;
    }

    if (hit) {
      if (!props.lockNodes) {
        hit.fx = hit.x;
        hit.fy = hit.y;
        worker?.pin(hit.id, hit.x ?? 0, hit.y ?? 0);
        worker?.alphaTarget(0.3, true);
      }
      setDrag({ type: "node", node: hit, pointerId: d.pointerId, moved: false });
    } else if (d.tool === "lasso") {
      setDrag({
        type: "lasso",
        startSx: d.startSx,
        startSy: d.startSy,
        sx: d.latestSx,
        sy: d.latestSy,
        pointerId: d.pointerId,
      });
      setLassoRect({
        x: Math.min(d.startSx, d.latestSx),
        y: Math.min(d.startSy, d.latestSy),
        w: Math.abs(d.latestSx - d.startSx),
        h: Math.abs(d.latestSy - d.startSy),
      });
      requestDraw();
    } else {
      setDrag({
        type: "pan",
        startX: d.startSx,
        startY: d.startSy,
        startTx: d.startTx,
        startTy: d.startTy,
        pointerId: d.pointerId,
        moved: d.latestSx !== d.startSx || d.latestSy !== d.startSy,
      });
      if (d.latestSx !== d.startSx || d.latestSy !== d.startSy) {
        setView((v) => ({
          ...v,
          tx: d.startTx + (d.latestSx - d.startSx),
          ty: d.startTy + (d.latestSy - d.startSy),
        }));
        requestDraw();
      }
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
      props.onUserInteract?.();
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
      // hover only — fully async via worker. rAF-coalesce: store
      // the latest pointer position and let the next frame issue
      // a single hit-test, aborting any in-flight previous one.
      lastHoverScreenPos = { sx, sy, clientX: e.clientX, clientY: e.clientY };
      scheduleHoverHitTest();
      return;
    }

    // press: in-flight hit-test. if the pointer wanders > 3 px
    // before the worker responds, abort the request and convert
    // immediately to pan/lasso so the user never feels stuck.
    if (d.type === "press") {
      d.latestSx = sx;
      d.latestSy = sy;
      const dx = sx - d.startSx;
      const dy = sy - d.startSy;
      if (Math.abs(dx) + Math.abs(dy) > 3) {
        d.abort.abort();
        if (d.tool === "lasso") {
          setDrag({
            type: "lasso",
            startSx: d.startSx,
            startSy: d.startSy,
            sx,
            sy,
            pointerId: d.pointerId,
          });
          setLassoRect({
            x: Math.min(d.startSx, sx),
            y: Math.min(d.startSy, sy),
            w: Math.abs(sx - d.startSx),
            h: Math.abs(sy - d.startSy),
          });
        } else {
          setDrag({
            type: "pan",
            startX: d.startSx,
            startY: d.startSy,
            startTx: d.startTx,
            startTy: d.startTy,
            pointerId: d.pointerId,
            moved: true,
          });
          props.onUserInteract?.();
          setView((v) => ({
            ...v,
            tx: d.startTx + dx,
            ty: d.startTy + dy,
          }));
        }
        requestDraw();
      }
      return;
    }

    if (d.type === "node") {
      if (props.lockNodes) {
        // locked: nodes don't follow the pointer and pressing one
        // shouldn't wake the sim. still treat it as a press so the
        // pointerup handler fires the selection.
        return;
      }
      const [wx, wy] = screenToWorld(sx, sy);
      d.node.fx = wx;
      d.node.fy = wy;
      worker?.pin(d.node.id, wx, wy);
      if (!d.moved) props.onUserInteract?.();
      d.moved = true;
      worker?.alphaTarget(0.3, true);
    } else if (d.type === "pan") {
      const ndx = sx - d.startX;
      const ndy = sy - d.startY;
      if (Math.abs(ndx) + Math.abs(ndy) > 3) {
        if (!d.moved) props.onUserInteract?.();
        d.moved = true;
      }
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

    if (d.type === "press") {
      // hit-test still in flight. mark released and let the resolver
      // dispatch click-select. abort the worker call so it fires
      // sooner (the abort path also calls onPressResolved).
      d.released = true;
      d.abort.abort();
      return;
    }

    if (d.type === "node") {
      d.node.fx = null;
      d.node.fy = null;
      worker?.unpin(d.node.id);
      if (!props.lockNodes) worker?.alphaTarget(0);
      // click on node → select; clears any selected edges. modifier
      // keys (shift/meta/ctrl) signal the parent to add to a multi-
      // selection set instead of replacing the primary selection.
      const multi = e.shiftKey || e.metaKey || e.ctrlKey;
      setSelectedEdgeKeys(new Set<string>());
      props.onEdgeSelect?.(null);
      props.onSelect?.(d.node, { multi });
      // only mirror to internal single-selection when not modifier-add;
      // additive picks live in the parent's selectedIds set.
      if (!multi && props.selectedId === undefined) setInternalSelected(d.node.id);
    } else if (d.type === "lasso") {
      const rect = lassoRect();
      setLassoRect(null);
      if (rect && (rect.w > 4 || rect.h > 4)) {
        const [x0, y0] = screenToWorld(rect.x, rect.y);
        const [x1, y1] = screenToWorld(rect.x + rect.w, rect.y + rect.h);
        // async lasso: ask worker for the ids in this rect, then
        // resolve to local SimNodes via the byId map.
        if (worker) {
          worker
            .hitRect(x0, y0, x1, y1)
            .then((ids) => {
              const picks = ids.map((id) => simNodesById.get(id)).filter((n): n is SimNode => !!n);
              props.onLassoSelect?.(picks);
            })
            .catch(() => {
              // aborted/disposed — silently drop.
            });
        }
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
    props.onUserInteract?.();
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
      // we must preventDefault synchronously to stop the browser menu;
      // node hit-testing happens async against the worker afterwards.
      ev.preventDefault();
      if (!worker || !props.onNodeContextMenu) return;
      const [sx, sy] = clientToScreen(ev);
      const [wx, wy] = screenToWorld(sx, sy);
      const v2 = view();
      const ctxRadius = Math.max(nodeSize() * 0.55, 12 / v2.k);
      // tight timeout: contextmenu is a single user event and a slow
      // worker should just no-op rather than open a stale menu.
      worker
        .hitTest(wx, wy, ctxRadius, AbortSignal.timeout(150))
        .then((nodeId) => {
          if (!nodeId) return;
          const hit = simNodesById.get(nodeId);
          if (hit) props.onNodeContextMenu?.(hit as GraphNodeData, ev.clientX, ev.clientY);
        })
        .catch(() => {
          // timeout / abort \u2014 silently drop.
        });
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
      worker?.dispose();
      worker = null;
    });
  });

  // rebuild when nodes / edges change. enabledKinds is handled
  // separately below so worker-derive mode can fast-path it without
  // re-shipping the full taxonomy.
  createEffect(() => {
    void props.nodes;
    if (!deriveMode()) void props.edges;
    rebuild();
  });

  // enabledKinds toggles: in derive mode, just tell the worker which
  // kinds matter (it'll re-filter its cached edges + reheat lightly)
  // and re-filter our local simLinks from the cached edge list. in
  // legacy mode fall through to a full rebuild so simLinks is
  // recomputed from `props.edges`.
  createEffect(() => {
    const setKinds = enabledSet();
    if (!deriveMode()) {
      void setKinds;
      // tracked via the rebuild effect above when props.edges changes,
      // but enabledKinds is independent — force a rebuild here too.
      if (worker) rebuild();
      return;
    }
    if (!worker) return;
    const kinds = setKinds ? (Array.from(setKinds) as RelationKind[]) : undefined;
    worker.setEnabledKinds(kinds, props.quietUpdates ? "quiet" : "nudge");
    rebuildSimLinksFromCache();
    requestDraw();
  });

  // pause / resume
  createEffect(() => {
    if (!worker) return;
    if (props.paused) worker.pause();
    else worker.resume(0.2);
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
