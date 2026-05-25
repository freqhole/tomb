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

import { createEffect, createMemo, createSignal, onCleanup, onMount, Show } from "solid-js";
import type { SimulationLinkDatum, SimulationNodeDatum } from "d3-force";
import { drawAlbumNode } from "./drawAlbumNode";
import { drawArtistNode } from "./drawArtistNode";
import { RELATION_COLOR } from "./relations";
import {
  isAnyHubId,
  isRelationHubId,
  isRelationValueHubId,
  isRemoteHubId,
  parseRelationHubId,
} from "./hubNodes";
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
  /** caller-supplied topology identity key. when this changes, the
   *  canvas tears down worker/sim state and does a fresh rebuild
   *  instead of preserving node positions by id. */
  topologyKey?: string | number;
  /** optional per-kind relation strengths (0..1). higher values pull
   *  linked nodes closer in the force simulation. */
  relationStrengths?: Record<string, number>;
  /** fired during a drag gesture on a relation hub node — the drag
   *  translates cursor delta into a normalized strength value for the
   *  hub's kind, instead of moving the node. parents should write the
   *  value back into their `relationStrengths` source so the canvas
   *  redraws + the worker eventually picks up the new weight via the
   *  existing debounce pipeline. when not provided, relation hubs
   *  drag like any other node. */
  onRelationStrengthChange?: (kind: string, value: number) => void;
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
  /**
   * optional set of node ids that are currently loading (fetching
   * remote data, crunching async derivations, etc). matching nodes
   * render an animated comet-trail arc around their silhouette, just
   * like the player-bar play/pause loading ring. pass `null` /
   * `undefined` (or an empty set) to disable.
   */
  loadingNodeIds?: Set<string> | null;
  /**
   * optional preview-on-hover hook. when the user hovers a node that
   * has descendants worth peeking at without committing to a drill
   * (typically a relation hub or relation-value hub), the parent
   * returns up to ~12 nodes here. the canvas paints them in a
   * deterministic ring around the hovered node, on top of everything,
   * with thin spokes — no force-sim involvement, dismissed when the
   * hover clears. return `[]` or omit the prop to disable.
   */
  getHoverPreview?: (node: GraphNodeData) => GraphNodeData[];
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

function stableHash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const raw = hex.trim().replace(/^#/, "");
  const full =
    raw.length === 3
      ? `${raw[0]}${raw[0]}${raw[1]}${raw[1]}${raw[2]}${raw[2]}`
      : raw.length === 6
        ? raw
        : null;
  if (!full) return null;
  const n = Number.parseInt(full, 16);
  if (!Number.isFinite(n)) return null;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { h, s, l };
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp >= 0 && hp < 1) {
    r = c;
    g = x;
  } else if (hp >= 1 && hp < 2) {
    r = x;
    g = c;
  } else if (hp >= 2 && hp < 3) {
    g = c;
    b = x;
  } else if (hp >= 3 && hp < 4) {
    g = x;
    b = c;
  } else if (hp >= 4 && hp < 5) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  const m = l - c / 2;
  const toHex = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
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

  // multi-value relation kinds share one base hue but vary slightly by
  // label value so parallel wires (e.g. multiple genres) remain distinct.
  const VARIED_RELATION_KINDS = new Set<string>(["genre", "tag", "mood", "style", "label", "era"]);
  const linkColorCache = new Map<string, string>();
  const linkColor = (kind: string, label?: string): string => {
    const k = `${kind}|${label ?? ""}`;
    const hit = linkColorCache.get(k);
    if (hit) return hit;
    const base = kindColor(kind);
    let out = base;
    if (label && VARIED_RELATION_KINDS.has(kind)) {
      const rgb = hexToRgb(base);
      if (rgb) {
        const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
        const hv = stableHash32(`${kind}|${label}`);
        const hueShift = ((hv % 21) - 10) * 1.45; // ~[-14.5, +14.5]
        const satShift = (((hv >> 5) % 15) - 7) * 0.012; // ~[-0.084,+0.084]
        const lumShift = (((hv >> 11) % 13) - 6) * 0.008; // ~[-0.048,+0.048]
        const h = (hsl.h + hueShift + 360) % 360;
        const s = Math.min(0.96, Math.max(0.56, hsl.s + satShift));
        // keep luminance bright enough to avoid muddy/dim wires.
        const l = Math.min(0.72, Math.max(0.45, hsl.l + lumShift));
        out = hslToHex(h, s, l);
      }
    }
    linkColorCache.set(k, out);
    return out;
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

  // ---- edge-pair aggregation -------------------------------------------
  // many pairs of nodes share *several* relation kinds (e.g. same genre
  // + same label + same era). without aggregation each one is rendered
  // as its own quadratic bezier — but `edgeControlPoint` produces the
  // identical curve for every kind on the same pair, so the strokes
  // would stack on top of each other and only the last-drawn color
  // would be visible. aggregation:
  //   - groups all SimLinks by canonical node-pair key
  //   - renders ONE curve per pair, split into N equal-length segments
  //     each painted in its kind's color (so every relation is visible)
  //   - hit-tests against the pair geometry, then maps the closest
  //     curve parameter `t` to a specific kind/link for selection
  // this also halves+ the inner-loop count for the dim pass on dense
  // graphs (avg multiplicity 2-3x is typical for the large remote).
  type EdgePair = {
    /** canonical key: lexicographically smaller id first. */
    key: string;
    a: SimNode;
    b: SimNode;
    /** all SimLinks between a and b regardless of direction. order is
     *  stable across rebuilds (by kind then label). */
    links: SimLink[];
    /** max weight across all links — used when picking line widths in
     *  the "involved" highlight pass. */
    maxWeight: number;
    // transient per-frame fields, populated by the draw loop. kept on
    // the pair to avoid per-frame Map allocations.
    _sx?: number;
    _sy?: number;
    _tx?: number;
    _ty?: number;
    _cpx?: number;
    _cpy?: number;
    /** perpendicular unit vector (in world coords) along which the
     *  parallel kind-stripes are offset. computed once per frame from
     *  the (a → b) direction. */
    _nx?: number;
    _ny?: number;
    /** true when the pair's bounding box intersects the viewport this
     *  frame. set by the edge-cull pass and consumed by the bucket /
     *  draw passes. */
    _visible?: boolean;
  };
  let pairs: EdgePair[] = [];

  function pairKeyFor(aId: string, bId: string): string {
    return aId < bId ? `${aId}|${bId}` : `${bId}|${aId}`;
  }

  function rebuildEdgePairs(): void {
    const byKey = new Map<string, EdgePair>();
    for (const l of simLinks) {
      const s = l.source as SimNode;
      const t = l.target as SimNode;
      const key = pairKeyFor(s.id, t.id);
      let p = byKey.get(key);
      if (!p) {
        // a/b are canonicalized so curve orientation stays stable across
        // rebuilds (otherwise toggling a kind could flip a/b and the
        // bezier would wobble to the other side).
        const aFirst = s.id < t.id;
        p = {
          key,
          a: aFirst ? s : t,
          b: aFirst ? t : s,
          links: [],
          maxWeight: 0,
        };
        byKey.set(key, p);
      }
      p.links.push(l);
      const w = l.weight ?? 0.5;
      if (w > p.maxWeight) p.maxWeight = w;
    }
    // deterministic ordering of kinds within each pair so colors don't
    // shuffle between frames.
    const linkSortKey = (l: SimLink): string => `${String(l.kind)}|${l.label ?? ""}`;
    for (const p of byKey.values()) {
      p.links.sort((x, y) => (linkSortKey(x) < linkSortKey(y) ? -1 : 1));
    }
    pairs = Array.from(byKey.values());
  }

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
  // hover-throttle: while the user is actively zooming/panning the
  // viewport, hover hit-tests are pure overhead — the pointer is
  // moving relative to world coords every frame so any hover state
  // we'd resolve is stale before paint. we set `interactingUntil`
  // ~120ms into the future on wheel/pan and skip per-frame
  // hit-tests until then. a single trailing hit-test fires after
  // interaction settles so hover comes back to life immediately.
  let interactingUntil = 0;
  let hoverTrailingTimer: ReturnType<typeof setTimeout> | null = null;
  function markInteracting() {
    interactingUntil = performance.now() + 120;
  }
  function scheduleHoverHitTest() {
    if (hoverScheduled) return;
    const now = performance.now();
    if (now < interactingUntil) {
      // currently panning/zooming — skip the per-frame hit-test and
      // arm a single trailing one that fires shortly after the
      // interaction-quiet timestamp.
      if (!hoverTrailingTimer) {
        const delay = Math.max(16, interactingUntil - now + 8);
        hoverTrailingTimer = setTimeout(() => {
          hoverTrailingTimer = null;
          scheduleHoverHitTest();
        }, delay);
      }
      return;
    }
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
    const workerHit = nodeId ? (simNodesById.get(nodeId) ?? null) : null;
    const hit = workerHit ?? localHitFromHover(pos.sx, pos.sy);
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
  const isHubNode = (n: GraphNodeData): boolean => {
    if (nodeKind(n) !== "artist") return false;
    return isAnyHubId((n as ArtistNodeData).artistId);
  };
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
  let lastRelationStrengthSig = "";
  let lastTopologyKey = props.topologyKey;

  function relationStrengthSigFor(map: Record<string, number> | undefined): string {
    if (!map) return "";
    const keys = Object.keys(map).sort();
    let out = "";
    for (const k of keys) {
      const v = map[k];
      if (typeof v !== "number" || Number.isNaN(v)) continue;
      const clamped = Math.max(0, Math.min(1, v));
      out += `${k}:${clamped.toFixed(3)}|`;
    }
    return out;
  }

  function hardResetTopologyState(): void {
    worker?.dispose();
    worker = null;
    simNodes = [];
    simLinks = [];
    cachedDerivedEdges = [];
    pairs = [];
    simNodesById = new Map();
    firstBuild = true;
    lastRelationStrengthSig = "";
  }

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
    rebuildEdgePairs();
  }

  function seedGroupKey(node: GraphNodeData): string {
    if (node.kind === "album") {
      const a = node as AlbumNodeData;
      if (a.artistId) return `artist:${a.artistId}`;
      if (a.artistName) return `artist_name:${a.artistName.toLowerCase()}`;
      if (a.label) return `label:${a.label.toLowerCase()}`;
      if (a.era) return `era:${a.era.toLowerCase()}`;
      if (a.genres[0]) return `genre:${a.genres[0].toLowerCase()}`;
      return "album:ungrouped";
    }
    const r = node as ArtistNodeData;
    if (isRemoteHubId(r.artistId)) return "hub:remote";
    if (isRelationHubId(r.artistId)) return "hub:relation";
    if (isRelationValueHubId(r.artistId)) return "hub:relation_value";
    if (r.artistId) return `artist:${r.artistId}`;
    if (r.label) return `label:${r.label.toLowerCase()}`;
    if (r.era) return `era:${r.era.toLowerCase()}`;
    if (r.genres[0]) return `genre:${r.genres[0].toLowerCase()}`;
    return "artist:ungrouped";
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
        // build from fresh node payload and copy only simulation state.
        // this avoids stale fields (for example old image/imageUrl)
        // surviving when the new payload omits them.
        return {
          ...(n as GraphNodeData),
          x: p.x,
          y: p.y,
          vx: p.vx,
          vy: p.vy,
          fx: p.fx,
          fy: p.fy,
        } as SimNode;
      }
      // brand-new node: positions filled in below from a phyllotaxis
      // seed. clone the data so the upstream array isn't mutated by the
      // sim.
      return { ...n } as SimNode;
    }) as SimNode[];

    // pre-seed any node that's still missing x/y (i.e. truly new).
    // grouped seeding starts each batch in coarse clusters (artist/
    // label/era/genre) so dense pages enter already separated.
    // this lowers early collision pressure and reduces the chance that
    // mega-graphs collapse into overlap before forces can untangle.
    const cx = width / 2;
    const cy = height / 2;
    const sz0 = nodeSize();
    const golden = 2.399963229728653;
    const allCount = simNodes.length;
    const clusterSpacing =
      allCount >= 3500
        ? sz0 * 13.2
        : allCount >= 2200
          ? sz0 * 11.2
          : allCount >= 1200
            ? sz0 * 9.4
            : sz0 * 7.6;
    const localStep =
      allCount >= 3500
        ? sz0 * 1.34
        : allCount >= 2200
          ? sz0 * 1.22
          : allCount >= 1200
            ? sz0 * 1.12
            : sz0 * 1.02;

    const groups = new Map<string, SimNode[]>();
    const centroid = new Map<string, { x: number; y: number; count: number }>();

    for (const n of simNodes) {
      const key = seedGroupKey(n);
      if (n.x != null && n.y != null) {
        const c = centroid.get(key);
        if (c) {
          c.x += n.x;
          c.y += n.y;
          c.count += 1;
        } else {
          centroid.set(key, { x: n.x, y: n.y, count: 1 });
        }
      } else {
        const list = groups.get(key);
        if (list) list.push(n);
        else groups.set(key, [n]);
      }
    }

    const groupEntries = Array.from(groups.entries()).sort((a, b) => {
      if (b[1].length !== a[1].length) return b[1].length - a[1].length;
      return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
    });

    const familyOf = (key: string): string => {
      const i = key.indexOf(":");
      return i > 0 ? key.slice(0, i) : key;
    };
    const byFamily = new Map<string, Array<[string, SimNode[]]>>();
    for (const entry of groupEntries) {
      const fam = familyOf(entry[0]);
      const arr = byFamily.get(fam);
      if (arr) arr.push(entry);
      else byFamily.set(fam, [entry]);
    }
    const familyEntries = Array.from(byFamily.entries()).sort((a, b) => {
      const sizeA = a[1].reduce((sum, item) => sum + item[1].length, 0);
      const sizeB = b[1].reduce((sum, item) => sum + item[1].length, 0);
      if (sizeB !== sizeA) return sizeB - sizeA;
      return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
    });

    const familySpacing = clusterSpacing * 2.15;
    const hubLaneOffset = (key: string): { ox: number; oy: number } | null => {
      if (key === "hub:remote") return { ox: -0.72, oy: -0.58 };
      if (key === "hub:relation") return { ox: 0.74, oy: -0.06 };
      if (key === "hub:relation_value") return { ox: 0.28, oy: 0.72 };
      return null;
    };
    let familyIdx = 0;
    for (const [family, entries] of familyEntries) {
      let fx = cx;
      let fy = cy;
      let weighted = 0;
      for (const [key] of entries) {
        const c = centroid.get(key);
        if (!c || c.count <= 0) continue;
        fx += (c.x / c.count) * c.count;
        fy += (c.y / c.count) * c.count;
        weighted += c.count;
      }
      if (weighted > 0) {
        fx /= weighted;
        fy /= weighted;
      } else {
        const ga = familyIdx * golden;
        const gr = Math.sqrt(familyIdx + 0.9) * familySpacing;
        fx = cx + gr * Math.cos(ga);
        fy = cy + gr * Math.sin(ga);
        familyIdx++;
      }

      const groupRing = family === "artist" ? clusterSpacing * 0.42 : clusterSpacing * 0.72;
      for (let gi = 0; gi < entries.length; gi++) {
        const [key, bucket] = entries[gi];
        const c = centroid.get(key);
        let ax = fx;
        let ay = fy;
        if (c && c.count > 0) {
          ax = c.x / c.count;
          ay = c.y / c.count;
        } else if (entries.length > 1) {
          const ga = gi * golden;
          const gr = Math.sqrt(gi + 0.6) * groupRing;
          ax = fx + gr * Math.cos(ga);
          ay = fy + gr * Math.sin(ga);
        }

        // synthetic hub classes use fixed lane offsets so remote /
        // relation / value hubs don't collapse onto each other across
        // rebuilds when centroid reuse would otherwise preserve overlap.
        const lane = hubLaneOffset(key);
        if (lane) {
          ax = fx + lane.ox * clusterSpacing;
          ay = fy + lane.oy * clusterSpacing;
        }

        for (let i = 0; i < bucket.length; i++) {
          const n = bucket[i];
          const groupLocalStep = key.startsWith("artist:") ? localStep * 0.6 : localStep;
          const a = i * golden;
          const r = Math.sqrt(i + 0.5) * groupLocalStep;
          n.x = ax + r * Math.cos(a);
          n.y = ay + r * Math.sin(a);
          n.vx = 0;
          n.vy = 0;
        }
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
      rebuildEdgePairs();
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
    const relationStrengths = props.relationStrengths;
    const relationStrengthSig = relationStrengthSigFor(relationStrengths);
    const relationStrengthsChanged = relationStrengthSig !== lastRelationStrengthSig;

    let mode: UpdateMode = firstBuild ? "fresh" : props.quietUpdates ? "quiet" : "nudge";
    if (!firstBuild && relationStrengthsChanged) {
      // slider changes should move the layout immediately even while
      // quietUpdates is enabled after user interaction.
      mode = "nudge";
    }

    if (!worker) {
      worker = createGraphWorkerClient();
      // listener writes positions back into simNodes so every
      // downstream consumer (renderer, hitTest, fit) keeps working
      // against the same data shape it always did. throttled
      // hitter invalidation matches the pre-worker behaviour.
      worker.onPositions((buf, _tick, alpha) => {
        // length mismatch can happen briefly between an `update`
        // dispatch and the worker's next tick: the worker may emit
        // one last buffer of the previous size while we've already
        // resized simNodes locally. drop those stale buffers.
        if (buf.length === simNodes.length * 2) {
          for (let i = 0; i < simNodes.length; i++) {
            simNodes[i].x = buf[i * 2];
            simNodes[i].y = buf[i * 2 + 1];
          }
          // track sim heat so deferred draws (image arrivals) can
          // tell when the layout has settled and aggressive
          // coalescing is safe.
          lastSimAlpha = alpha;
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
        edgeConfig,
        relationStrengths
      );
      if (
        typeof console !== "undefined" &&
        (window as unknown as { __DEBUG_GRAPH__?: boolean }).__DEBUG_GRAPH__
      ) {
        console.debug(`[graph] init: nodes=${simNodes.length} links=${simLinks.length}`);
      }
      lastRelationStrengthSig = relationStrengthSig;
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
    worker.update(workerNodes, workerLinks, mode, edgeConfig, relationStrengths);
    lastRelationStrengthSig = relationStrengthSig;
    if (mode === "quiet") {
      // worker emits one frame on quiet so new nodes show up. force a
      // local draw too in case the buffer arrives before the rAF lands.
      requestDraw();
    }
  }

  // ---- draw loop --------------------------------------------------------
  let drawScheduled = false;
  let animatingMarquee = false;
  // set true by drawArtistNode/drawAlbumNode whenever they paint a
  // comet-trail loading arc, so the draw loop knows to keep ticking
  // frames until every loading node clears.
  let animatingLoading = false;
  let lastDrawTime = 0;
  let lastFrameStart = 0;

  // idle / deferred draw plumbing.
  //
  // `requestDraw` is the existing immediate path — every input,
  // topology, and sim-tick caller still gets a next-frame rAF paint.
  // `requestDrawDeferred` is for cheap-to-postpone redraws (today:
  // image-cache arrivals). a slow federation backend trickles in
  // hundreds of thumbs over many seconds; under the old code each
  // arrival cost a full ~46k-edge repaint. coalesce a burst of
  // arrivals into one paint per IDLE_COALESCE_MS, but escalate to
  // immediate when the sim is still hot so newly-arrived thumbs
  // appear in sync with the live layout. tracked via lastSimAlpha.
  const SIM_ACTIVE_ALPHA = 0.005; // slightly above worker alphaMin (0.002)
  const IDLE_COALESCE_MS = 160;
  let lastSimAlpha = 1;
  let idleCoalesceTimer: ReturnType<typeof setTimeout> | null = null;
  function requestDrawDeferred() {
    if (drawScheduled || idleCoalesceTimer) return;
    if (lastSimAlpha > SIM_ACTIVE_ALPHA || animatingMarquee || animatingLoading) {
      // sim still warming up or marquee already painting every frame:
      // no benefit from delaying — piggy-back on the next paint.
      requestDraw();
      return;
    }
    bump("draw.idle.coalesce");
    idleCoalesceTimer = setTimeout(() => {
      idleCoalesceTimer = null;
      requestDraw();
    }, IDLE_COALESCE_MS);
  }
  function requestDraw() {
    if (drawScheduled) return;
    // if a deferred draw was queued, fold it into this immediate one
    // so we don't double-paint.
    if (idleCoalesceTimer) {
      clearTimeout(idleCoalesceTimer);
      idleCoalesceTimer = null;
    }
    drawScheduled = true;
    requestAnimationFrame((t) => {
      drawScheduled = false;
      lastDrawTime = t;
      // inter-frame delta — gauge approximate FPS so slow zoom-out
      // frames show up clearly against the dataset / zoom snapshot.
      if (lastFrameStart > 0) {
        const inter = t - lastFrameStart;
        if (inter > 0) gauge("draw.fps", Math.round(1000 / inter));
      }
      lastFrameStart = t;
      performance.mark("graph-draw-start");
      const t0 = performance.now();
      draw(t);
      const dt = performance.now() - t0;
      performance.measure("graph-draw", "graph-draw-start");
      performance.clearMarks("graph-draw-start");
      timing("draw.frame", dt);
      bump("draw.frame.count");
      gauge("viewport.zoom", Math.round(view().k * 100) / 100);
      // keep ticking while marquee scrolling or any node spinner
      // animation is live.
      if (animatingMarquee || animatingLoading) requestDraw();
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
    const multiSel = props.selectedIds;
    const selEdges = selectedEdgeKeys();
    const hovEdge = hoverEdgeKey();
    const focus = sel ?? hov;
    const focusConnected = focus ? collectConnected(focus) : null;
    const focusNodeIds = new Set<string>();
    if (hov) focusNodeIds.add(hov);
    if (sel) focusNodeIds.add(sel);
    if (multiSel && multiSel.size > 0) {
      for (const id of multiSel) focusNodeIds.add(id);
    }
    const hubOnly = simNodes.length > 0 && simNodes.every((n) => isHubNode(n));
    // any hub node in the graph implies a drill scaffold (remote →
    // relation → value → entity) that must stay wired up regardless
    // of selection / hover state. otherwise the ancestry edges vanish
    // the moment the user drills past the deepest hub onto real
    // entity nodes (album/artist) and clears focus.
    const hasHubNode = hubOnly || simNodes.some((n) => isHubNode(n));
    const showEdges =
      hubOnly || hasHubNode || focusNodeIds.size > 0 || selEdges.size > 0 || hovEdge !== null;
    const idleHubScaffold = hubOnly && !focus && selEdges.size === 0 && hovEdge === null;
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
    // edge rendering — aggregated by node-pair.
    //
    // many node-pairs share *several* relation kinds (genre + label +
    // era ...). without aggregation each one is its own quadratic
    // bezier with identical control point → strokes stack and only
    // the last color is visible. instead, we render each pair as a
    // *bundle of parallel stripes* — one stripe per kind, offset
    // perpendicularly from the centerline by a small screen-constant
    // spacing. all stripes run in the same direction so the wire's
    // identity doesn't switch midway; the bundle's effective
    // thickness grows with the number of relations.
    //
    // bucketing is per-STRIPE (i.e. per-link): if kind A is selected
    // and kind B on the same pair is dim, A's stripe goes to
    // `highlighted` and B's stripe goes to `dimByColor`. selection /
    // hover / sibling state remains per-link as before.
    //
    // also adds viewport culling of off-screen pairs.
    const curv = curvature();
    // subway-map style: each pair renders as ONE thick wire made of
    // parallel stripes that BUTT against each other. spacing equals
    // the stroke width so adjacent stripes touch — the bundle reads
    // as a single fat wire whose thickness grows with N, not a fan
    // of separated parallel lines. width is held constant in screen
    // px (regardless of zoom) and a single value is reused for both
    // spacing and lineWidth so they always stay in lock-step.
    const STRIPE_W_SCREEN = 2.5;
    const stripeSpacing = STRIPE_W_SCREEN / Math.max(v.k, 0.05);
    // world-space lineWidth that produces STRIPE_W_SCREEN on screen
    // after the ctx.scale(v.k, v.k) transform applied above. all
    // edge passes (dim, search-dim, highlighted) share this width so
    // the bundle is visually a single wire; we vary alpha (and a
    // tiny lineWidth bump for sel/hov) for state, not thickness.
    const stripeWidthWorld = stripeSpacing;
    // LOD thresholds. when a pair's screen length is below MIN_LEN_PX
    // it's invisible noise — skip entirely. when a multi-kind
    // bundle would be narrower than MIN_BUNDLE_PX on screen,
    // collapse to a single representative stripe (still tinted by
    // the first kind's color) instead of drawing N quadratic curves
    // that visually overlap into a single pixel anyway.
    const lodMinLenWorld = 2 / Math.max(v.k, 0.05);
    const lodBundleCollapse = v.k < 0.6;
    // viewport rect in world coords (slightly padded for curve sag,
    // line width and the stripe bundle's perpendicular spread).
    const edgePad = 12 / Math.max(v.k, 0.05) + 4;
    const eMinX = -v.tx / v.k - edgePad;
    const eMaxX = (width - v.tx) / v.k + edgePad;
    const eMinY = -v.ty / v.k - edgePad;
    const eMaxY = (height - v.ty) / v.k + edgePad;
    // pre-pass: per-pair geometry cache + cull test. each pair stores
    // its world-space endpoints, bezier control point and the perp
    // unit vector on transient fields so the bucket + draw passes can
    // reuse them without recomputing edgeControlPoint / hypot.
    let pairsCulled = 0;
    let pairsDrawn = 0;
    let multiKindPairs = 0;
    if (showEdges) {
      for (const p of pairs) {
        if (p.links.length > 1) multiKindPairs++;
        const sx = p.a.x ?? 0;
        const sy = p.a.y ?? 0;
        const tx = p.b.x ?? 0;
        const ty = p.b.y ?? 0;
        let cpx = (sx + tx) * 0.5;
        let cpy = (sy + ty) * 0.5;
        if (curv > 0) {
          const cp = edgeControlPoint(sx, sy, tx, ty);
          cpx = cp.cx;
          cpy = cp.cy;
        }
        // perpendicular unit vector along the a→b direction. used to
        // offset the parallel kind-stripes from the centerline.
        const dx = tx - sx;
        const dy = ty - sy;
        const len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len;
        const ny = dx / len;
        const aMinX = sx < tx ? (sx < cpx ? sx : cpx) : tx < cpx ? tx : cpx;
        const aMaxX = sx > tx ? (sx > cpx ? sx : cpx) : tx > cpx ? tx : cpx;
        const aMinY = sy < ty ? (sy < cpy ? sy : cpy) : ty < cpy ? ty : cpy;
        const aMaxY = sy > ty ? (sy > cpy ? sy : cpy) : ty > cpy ? ty : cpy;
        const aabbVisible = !(aMaxX < eMinX || aMinX > eMaxX || aMaxY < eMinY || aMinY > eMaxY);
        // LOD: drop pairs whose endpoints sit on the same screen pixel.
        // d3 cool-down stacks many neighbour nodes inside collide
        // radius at full-zoom-out — their edges contribute nothing
        // visually but cost a full quadratic stroke each.
        const visible = aabbVisible && len > lodMinLenWorld;
        p._sx = sx;
        p._sy = sy;
        p._tx = tx;
        p._ty = ty;
        p._cpx = cpx;
        p._cpy = cpy;
        p._nx = nx;
        p._ny = ny;
        p._visible = visible;
        if (visible) pairsDrawn++;
        else pairsCulled++;
      }
      // bucket stripes by visual category. dim/search-dim/involved
      // share a fixed style so we group by color and stroke each group
      // as a single path — a 37k-stripe "nothing selected" frame
      // collapses from 37k stroke() calls to ~one per kind-color. only
      // sel/hov stripes pay per-stripe cost (they vary in width/alpha).
      type SegEntry = { p: EdgePair; i: number };
      type HighEntry = { p: EdgePair; i: number; vis: "sel" | "hov" };
      const dimByColor = new Map<string, SegEntry[]>();
      const searchDimByColor = new Map<string, SegEntry[]>();
      const invByColor = new Map<string, SegEntry[]>();
      const highlighted: HighEntry[] = [];
      let totalSegments = 0;
      for (const p of pairs) {
        if (!p._visible) continue;
        const aId = p.a.id;
        const bId = p.b.id;
        const touchesFocused = focusNodeIds.has(aId) || focusNodeIds.has(bId);
        // pair-level focus / search state (same for every stripe on
        // this pair).
        let pairInvolvedFocus = !focus && !edgeFocusIds;
        if (focus) {
          pairInvolvedFocus =
            !!focusConnected &&
            (focusConnected.has(aId) || focusConnected.has(bId) || aId === focus || bId === focus);
        }
        const searchDim = hasSearch && search && !search.has(aId) && !search.has(bId);
        // bundle-collapse LOD: at far zoom-out a multi-kind bundle
        // shrinks to a single screen pixel anyway. emit one stripe
        // (the first kind) and skip the rest of the pair.
        const N = p.links.length;
        const stripeCount = lodBundleCollapse && N > 1 ? 1 : N;
        for (let i = 0; i < stripeCount; i++) {
          const link = p.links[i];
          const isHovEdge = link._key === hovEdge;
          const isSelEdge = selEdges.has(link._key);
          const isSiblingEdge = siblingEdgeKeys?.has(link._key) ?? false;
          // hub-scaffolding stripes (any endpoint a hub) always
          // render so the drill ancestry chain — selected remote ─
          // relation ─ value ─ entity — stays visible after the
          // user clicks down past the deepest hub onto an actual
          // album/artist node.
          const isHubEdge = isHubNode(p.a as SimNode) || isHubNode(p.b as SimNode);
          if (
            !idleHubScaffold &&
            !isHubEdge &&
            !touchesFocused &&
            !isSelEdge &&
            !isHovEdge &&
            !isSiblingEdge
          ) {
            continue;
          }
          // edge-focus mode overrides: only sibling stripes are
          // promoted to "involved", everything else dims out.
          // hub-scaffolding stripes are always promoted so the drill
          // trail reads bright, never washed into the dim bucket.
          const involved = edgeFocusIds
            ? isSiblingEdge || isHubEdge
            : pairInvolvedFocus || isHubEdge;
          if (searchDim && !isSelEdge && !isHovEdge) {
            const color = linkColor(link.kind, link.label);
            let arr = searchDimByColor.get(color);
            if (!arr) {
              arr = [];
              searchDimByColor.set(color, arr);
            }
            arr.push({ p, i });
          } else if (!isSelEdge && !isHovEdge && !involved) {
            const color = linkColor(link.kind, link.label);
            let arr = dimByColor.get(color);
            if (!arr) {
              arr = [];
              dimByColor.set(color, arr);
            }
            arr.push({ p, i });
          } else if (isSelEdge) {
            highlighted.push({ p, i, vis: "sel" });
          } else if (isHovEdge) {
            highlighted.push({ p, i, vis: "hov" });
          } else {
            // involved — batch by color (same alpha/lineWidth as dim
            // but at full opacity). massive win on "nothing selected"
            // frames where every visible stripe lands here.
            const color = linkColor(link.kind, link.label);
            let arr = invByColor.get(color);
            if (!arr) {
              arr = [];
              invByColor.set(color, arr);
            }
            arr.push({ p, i });
          }
          totalSegments++;
        }
      }

      // append the i-th stripe of a pair to the current path. each
      // stripe is the centerline curve translated perpendicularly by
      // `(i - (N-1)/2) * stripeSpacing` so the kinds render side-by-
      // side as a bundle. single-kind pairs (N=1) emit the original
      // single curve (zero offset).
      function appendPairStripeToPath(p: EdgePair, i: number): void {
        const sx0 = p._sx ?? 0;
        const sy0 = p._sy ?? 0;
        const tx0 = p._tx ?? 0;
        const ty0 = p._ty ?? 0;
        const cpx = p._cpx ?? (sx0 + tx0) * 0.5;
        const cpy = p._cpy ?? (sy0 + ty0) * 0.5;
        const nx = p._nx ?? 0;
        const ny = p._ny ?? 0;
        const N = p.links.length;
        const off = N === 1 ? 0 : (i - (N - 1) / 2) * stripeSpacing;
        const ox = nx * off;
        const oy = ny * off;
        // trim each endpoint so wires terminate at node borders,
        // avoiding center-through intersections/overdraw. hub
        // silhouettes (wonky triangle / hex / octagon) are inscribed
        // well inside their bounding box, so the default disc-radius
        // pad would leave a visible gap between the wire tip and the
        // shape edge. we cut hub endpoints with a much smaller pad
        // so the wire pokes right up to the silhouette.
        const baseEdgePad = nodeSize() * 0.38 + stripeWidthWorld * 0.45;
        const hubEdgePad = nodeSize() * 0.18 + stripeWidthWorld * 0.45;
        const sPad = isHubNode(p.a) ? hubEdgePad : baseEdgePad;
        const tPad = isHubNode(p.b) ? hubEdgePad : baseEdgePad;
        const vx = tx0 - sx0;
        const vy = ty0 - sy0;
        const len = Math.hypot(vx, vy) || 1;
        const ux = vx / len;
        const uy = vy / len;
        const sCut = Math.min(sPad, Math.max(0, len * 0.32));
        const tCut = Math.min(tPad, Math.max(0, len * 0.32));
        const sx = sx0 + ux * sCut;
        const sy = sy0 + uy * sCut;
        const tx = tx0 - ux * tCut;
        const ty = ty0 - uy * tCut;
        ctx!.moveTo(sx + ox, sy + oy);
        if (curv > 0) {
          ctx!.quadraticCurveTo(cpx + ox, cpy + oy, tx + ox, ty + oy);
        } else {
          ctx!.lineTo(tx + ox, ty + oy);
        }
      }

      // pass 1a: bulk dim — one path per stroke color. lineWidth ==
      // stripeSpacing so adjacent stripes touch and the pair reads as
      // a single solid wire (subway-map style).
      const edgeT0 = performance.now();
      ctx.globalAlpha = 0.18;
      ctx.lineWidth = stripeWidthWorld;
      for (const [color, segs] of dimByColor) {
        ctx.strokeStyle = color;
        ctx.beginPath();
        for (const s of segs) appendPairStripeToPath(s.p, s.i);
        ctx.stroke();
      }
      // pass 1b: search-dim (even fainter, same thickness).
      if (searchDimByColor.size > 0) {
        ctx.globalAlpha = 0.07;
        ctx.lineWidth = stripeWidthWorld;
        for (const [color, segs] of searchDimByColor) {
          ctx.strokeStyle = color;
          ctx.beginPath();
          for (const s of segs) appendPairStripeToPath(s.p, s.i);
          ctx.stroke();
        }
      }
      // pass 1c: involved — batched by color. same width as dim,
      // higher alpha. this is the hot path on idle frames (nothing
      // selected/hovered/searched → every visible stripe lands here).
      if (invByColor.size > 0) {
        ctx.globalAlpha = 0.9;
        ctx.lineWidth = stripeWidthWorld;
        for (const [color, segs] of invByColor) {
          ctx.strokeStyle = color;
          ctx.beginPath();
          for (const s of segs) appendPairStripeToPath(s.p, s.i);
          ctx.stroke();
        }
      }
      // pass 2: sel/hov stripes — per-stripe lineWidth + alpha bump
      // so the user can see what they picked. small N so per-stripe
      // cost doesn't matter.
      for (const h of highlighted) {
        const link = h.p.links[h.i];
        ctx.strokeStyle = linkColor(link.kind, link.label);
        if (h.vis === "sel") {
          ctx.globalAlpha = 1;
          ctx.lineWidth = stripeWidthWorld * 1.35;
        } else {
          // hov
          ctx.globalAlpha = 0.95;
          ctx.lineWidth = stripeWidthWorld * 1.2;
        }
        ctx.beginPath();
        appendPairStripeToPath(h.p, h.i);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      timing("draw.edges.ms", performance.now() - edgeT0);
      gauge("edges.pairs.total", pairs.length);
      gauge("edges.pairs.multi", multiKindPairs);
      bump("edges.pairs.drawn", pairsDrawn);
      bump("edges.pairs.culled", pairsCulled);
      bump("edges.segments.drawn", totalSegments);
    } else {
      gauge("edges.pairs.total", pairs.length);
      gauge("edges.pairs.multi", 0);
      bump("edges.pairs.drawn", 0);
      bump("edges.pairs.culled", pairs.length);
      bump("edges.segments.drawn", 0);
    }

    // (edge labels drawn below in screen space, after nodes)

    // nodes
    const nodesT0 = performance.now();
    animatingMarquee = false;
    animatingLoading = false;
    // collect hover/selection nodes to draw in a second pass so they
    // stack on top of their neighbours — helps in dense clusters
    // where the node the user is interacting with would otherwise be
    // half-occluded by adjacent nodes.
    const deferred: SimNode[] = [];
    // capture into a locally non-null binding so the helper closure
    // below doesn't lose the narrowing across the function boundary.
    const nctx = ctx;
    const loadingSet = props.loadingNodeIds ?? null;
    const hasLoading = !!loadingSet && loadingSet.size > 0;
    function drawOne(n: SimNode) {
      const isEdgeFocus = edgeFocusIds?.has(n.id) ?? false;
      const searchMiss = hasSearch && search ? !search.has(n.id) : false;
      const isMulti = multiSel?.has(n.id) ?? false;
      const nodeIsLoading = hasLoading && (loadingSet?.has(n.id) ?? false);
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
          showLabel,
          time,
          loading: nodeIsLoading,
          onLoading: () => {
            animatingLoading = true;
          },
          onMarquee: () => {
            animatingMarquee = true;
          },
          onImageReady: requestDrawDeferred,
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
          loading: nodeIsLoading,
          onLoading: () => {
            animatingLoading = true;
          },
          onImageReady: requestDrawDeferred,
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

    // hover preview: when the parent supplies a `getHoverPreview` hook
    // and the user is hovering a node that returns a non-empty list
    // (typically a relation hub or relation-value hub), render those
    // child nodes in a fixed ring around the hovered node. positions
    // are deterministic (evenly spaced around the silhouette), nodes
    // are not part of the force sim, and the whole overlay vanishes
    // as soon as the hover clears. thin spokes from hub center to
    // each preview node give a quick visual cue that they belong to
    // the hovered hub. when the parent returns more than `previewCap`
    // entries, the overflow is hinted by a small "+N" chip near the
    // last preview node.
    const previewProvider = props.getHoverPreview;
    if (previewProvider && hov) {
      const hovered = simNodes.find((n) => n.id === hov);
      if (hovered) {
        let previewList: GraphNodeData[] = [];
        try {
          previewList = previewProvider(hovered);
        } catch {
          previewList = [];
        }
        if (previewList.length > 0) {
          const previewCap = 12;
          const shown = previewList.slice(0, previewCap);
          const overflow = previewList.length - shown.length;
          const hubR = nodeSize() / 2;
          const previewSize = nodeSize() * 0.55;
          const ringR = hubR + previewSize * 0.85 + 6 / Math.max(v.k, 0.05);
          const hx = hovered.x ?? 0;
          const hy = hovered.y ?? 0;
          // spokes under the preview nodes
          ctx.save();
          ctx.lineWidth = 1.2 / Math.max(v.k, 0.5);
          ctx.strokeStyle = "rgba(255, 210, 244, 0.55)";
          const startAngle = -Math.PI / 2;
          const positions: { x: number; y: number }[] = [];
          for (let i = 0; i < shown.length; i++) {
            const a = startAngle + (i * Math.PI * 2) / shown.length;
            const px = hx + Math.cos(a) * ringR;
            const py = hy + Math.sin(a) * ringR;
            positions.push({ x: px, y: py });
            ctx.beginPath();
            ctx.moveTo(hx, hy);
            ctx.lineTo(px, py);
            ctx.stroke();
          }
          ctx.restore();
          // preview nodes on top
          for (let i = 0; i < shown.length; i++) {
            const n = shown[i];
            const { x: px, y: py } = positions[i];
            if (nodeKind(n as SimNode) === "artist") {
              drawArtistNode({
                ctx: nctx,
                artist: n as ArtistNodeData,
                x: px,
                y: py,
                size: previewSize,
                state: "idle",
                zoom: v.k,
                showLabel: false,
                time,
                loading: false,
                onImageReady: requestDrawDeferred,
              });
            } else {
              drawAlbumNode({
                ctx: nctx,
                album: n as AlbumNodeData,
                x: px,
                y: py,
                size: previewSize,
                state: "idle",
                zoom: v.k,
                showLabel: false,
                time,
                loading: false,
                onImageReady: requestDrawDeferred,
              });
            }
          }
          // overflow chip near the last preview node
          if (overflow > 0 && positions.length > 0) {
            const last = positions[positions.length - 1];
            ctx.save();
            const chipFont = `600 ${Math.max(9, previewSize * 0.28)}px system-ui, sans-serif`;
            ctx.font = chipFont;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            const label = `+${overflow}`;
            const textW = ctx.measureText(label).width;
            const padX = 6 / Math.max(v.k, 0.5);
            const padY = 3 / Math.max(v.k, 0.5);
            const chipW = textW + padX * 2;
            const chipH = Math.max(9, previewSize * 0.28) + padY * 2;
            const cx = last.x + previewSize * 0.6;
            const cy = last.y + previewSize * 0.6;
            ctx.fillStyle = "rgba(20, 20, 28, 0.92)";
            ctx.strokeStyle = "rgba(255, 210, 244, 0.7)";
            ctx.lineWidth = 1 / Math.max(v.k, 0.5);
            ctx.beginPath();
            const rr = chipH / 2;
            ctx.moveTo(cx - chipW / 2 + rr, cy - chipH / 2);
            ctx.arcTo(cx + chipW / 2, cy - chipH / 2, cx + chipW / 2, cy + chipH / 2, rr);
            ctx.arcTo(cx + chipW / 2, cy + chipH / 2, cx - chipW / 2, cy + chipH / 2, rr);
            ctx.arcTo(cx - chipW / 2, cy + chipH / 2, cx - chipW / 2, cy - chipH / 2, rr);
            ctx.arcTo(cx - chipW / 2, cy - chipH / 2, cx + chipW / 2, cy - chipH / 2, rr);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = "#ffd2f4";
            ctx.fillText(label, cx, cy);
            ctx.restore();
          }
        }
      }
    }
    gauge("nodes.total", simNodes.length);
    gauge("edges.total", simLinks.length);
    bump("draw.nodes.drawn", drawnCount);
    bump("draw.nodes.culled", culledCount);
    bump("draw.nodes.deferred", deferred.length);
    timing("draw.nodes.ms", performance.now() - nodesT0);
    ctx.restore();

    // node labels (screen space) — hover/selection focus only.
    // hovered or selected node gets a readable label below the node
    // (artist name for artist circles, title + artist for albums).
    // albums delegate the in-tile band to drawAlbumNode only when the
    // tile is big enough on screen; at low zoom the in-tile overlay
    // is suppressed and this pass renders the label below the tile
    // instead so it stays legible. non-focused nodes get no label.
    const focusLabelRects: { x: number; y: number; w: number; h: number }[] = [];
    const focusLabelDraws: { primary: string; secondary: string | null; sx: number; sy: number }[] =
      [];
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
          const isSyntheticHub = isAnyHubId(a.artistId);
          if (isSyntheticHub) continue;
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
        focusLabelRects.push({ x: bx, y: by, w: bw, h: bh });
        focusLabelDraws.push({ primary, secondary, sx: l.sx, sy: l.sy });
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
    // plus a scattered subset of:
    // - selected edges
    // - edges touching hovered/selected nodes
    // so dense clusters don't drown the canvas in pills. labels avoid
    // overlapping node tiles and each other; caps scale with viewport area.
    type LabelCand = {
      link: SimLink;
      sxm: number;
      sym: number;
      isHover: boolean;
      isSelected: boolean;
      isFocusNodeEdge: boolean;
    };
    const candidates: LabelCand[] = [];
    const labelScope = getEdgeVisibilityScope();
    for (const link of simLinks) {
      const isHov = link._key === hovEdge;
      const isSel = selEdges.has(link._key);
      const src = link.source as SimNode;
      const tgt = link.target as SimNode;
      const touchesFocused =
        labelScope.focusNodeIds.has(src.id) || labelScope.focusNodeIds.has(tgt.id);
      const isFocusNodeEdge = touchesFocused && !isHov && !isSel;
      if (!isHov && !isSel && !isFocusNodeEdge) continue;
      if (!isEdgeVisibleInScope(link, src.id, tgt.id, labelScope)) continue;
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
      candidates.push({
        link,
        sxm,
        sym,
        isHover: isHov,
        isSelected: isSel,
        isFocusNodeEdge,
      });
    }

    if (candidates.length > 0) {
      ctx.save();
      ctx.font = "600 11px system-ui, sans-serif";

      // node screen rects for collision (only visible nodes worth
      // checking against; off-screen ones can't intersect anything).
      const ns = nodeSize() * v.k;
      const nodeRects: { x: number; y: number; w: number; h: number }[] = [];
      const focusNodeRects: { x: number; y: number; w: number; h: number }[] = [];
      const multiSel = props.selectedIds;
      for (const n of simNodes) {
        const nsx = (n.x ?? 0) * v.k + v.tx;
        const nsy = (n.y ?? 0) * v.k + v.ty;
        if (nsx + ns < 0 || nsy + ns < 0 || nsx - ns > width || nsy - ns > height) continue;
        const rect = { x: nsx - ns / 2, y: nsy - ns / 2, w: ns, h: ns };
        nodeRects.push(rect);
        const isFocused =
          n.id === hoverId() || n.id === selectedId() || ((multiSel?.has(n.id) ?? false) && n.id);
        if (isFocused) focusNodeRects.push(rect);
      }

      // cap non-hover edge labels by viewport area so a 10k-node graph
      // doesn't try to render 1000 pills at once. hover label is always
      // drawn regardless of cap.
      const areaCap = Math.max(4, Math.min(20, Math.floor((width * height) / 40000)));

      // deterministic scatter: stable hash by `_key` so the same edges
      // get picked across redraws (no flicker as the user pans/zooms).
      const hovCands: LabelCand[] = [];
      const selCands: LabelCand[] = [];
      const focusNodeCands: LabelCand[] = [];
      for (const c of candidates) {
        if (c.isHover) hovCands.push(c);
        else if (c.isSelected) selCands.push(c);
        else if (c.isFocusNodeEdge) focusNodeCands.push(c);
      }
      selCands.sort((a, b) => stableHash32(a.link._key) - stableHash32(b.link._key));
      focusNodeCands.sort((a, b) => stableHash32(a.link._key) - stableHash32(b.link._key));

      const labelKeyFor = (link: SimLink): string => `${link.kind}|${link.label ?? ""}`;
      const uniqueByLabel = new Map<string, LabelCand>();
      const pickUnique = (c: LabelCand) => {
        const k = labelKeyFor(c.link);
        const prev = uniqueByLabel.get(k);
        if (!prev) {
          uniqueByLabel.set(k, c);
          return;
        }
        const prevPri = prev.isSelected ? 2 : prev.isFocusNodeEdge ? 1 : 0;
        const nextPri = c.isSelected ? 2 : c.isFocusNodeEdge ? 1 : 0;
        if (nextPri > prevPri) {
          uniqueByLabel.set(k, c);
          return;
        }
        if (nextPri === prevPri && stableHash32(c.link._key) < stableHash32(prev.link._key)) {
          uniqueByLabel.set(k, c);
        }
      };
      for (const c of selCands) pickUnique(c);
      for (const c of focusNodeCands) pickUnique(c);
      const uniqueLabelCands = Array.from(uniqueByLabel.values()).sort(
        (a, b) => stableHash32(labelKeyFor(a.link)) - stableHash32(labelKeyFor(b.link))
      );
      const uniqueKeys = new Set(uniqueLabelCands.map((c) => c.link._key));
      const extraSelCands = selCands.filter((c) => !uniqueKeys.has(c.link._key));
      const extraFocusCands = focusNodeCands.filter((c) => !uniqueKeys.has(c.link._key));

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
        // edge labels should never sit on focused nodes.
        for (const r of focusNodeRects) if (overlap(rect, r, 4)) return false;
        // and never sit on focused node labels.
        for (const r of focusLabelRects) if (overlap(rect, r, 6)) return false;
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

      // unique kind+label combos should each get at least one chance
      // before duplicate labels consume the cap.
      const maxNonHover = Math.max(areaCap, uniqueLabelCands.length);
      const maxFocusOnly = Math.max(2, Math.min(8, Math.floor(areaCap * 0.6)));
      let nonHoverPlaced = 0;

      let focusPlaced = 0;
      for (const c of uniqueLabelCands) {
        if (nonHoverPlaced >= maxNonHover) break;
        let placedOk = tryPlace(c, lowZoom);
        if (!placedOk) placedOk = tryPlace(c, true);
        if (!placedOk) continue;
        nonHoverPlaced++;
        if (c.isFocusNodeEdge) focusPlaced++;
      }

      for (const c of extraSelCands) {
        if (nonHoverPlaced >= maxNonHover) break;
        let placedOk = tryPlace(c, lowZoom);
        if (!placedOk) placedOk = tryPlace(c, true);
        if (placedOk) nonHoverPlaced++;
      }

      for (const c of extraFocusCands) {
        if (nonHoverPlaced >= maxNonHover) break;
        if (focusPlaced >= maxFocusOnly) break;
        let placedOk = tryPlace(c, lowZoom);
        if (!placedOk) placedOk = tryPlace(c, true);
        if (placedOk) {
          focusPlaced++;
          nonHoverPlaced++;
        }
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
        ctx.strokeStyle = linkColor(link.kind, link.label);
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

    // redraw focused node labels last so they stay above edge labels.
    if (focusLabelDraws.length > 0) {
      ctx.save();
      ctx.font = "600 11px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (const d of focusLabelDraws) {
        const lineH = 13;
        const padX = 6;
        const tw1 = ctx.measureText(d.primary).width;
        const tw2 = d.secondary ? ctx.measureText(d.secondary).width : 0;
        const bw = Math.max(tw1, tw2) + padX * 2;
        const bh = d.secondary ? lineH * 2 + 4 : lineH + 4;
        const bx = d.sx - bw / 2;
        const by = d.sy;
        const rr = 5;
        ctx.fillStyle = "rgba(20,20,28,0.88)";
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
        const baseY = by + 2 + lineH / 2;
        ctx.fillText(d.primary, d.sx, baseY);
        if (d.secondary) {
          ctx.fillStyle = "#9aa0aa";
          ctx.fillText(d.secondary, d.sx, by + 2 + lineH + lineH / 2);
        }
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

  function getEdgeVisibilityScope(): {
    showEdges: boolean;
    focusNodeIds: Set<string>;
    selectedEdgeKeysSet: Set<string>;
    hoveredEdgeKey: string | null;
    siblingEdgeKeys: Set<string> | null;
  } {
    const hov = hoverId();
    const sel = selectedId();
    const multiSel = props.selectedIds;
    const selectedEdgeKeysSet = selectedEdgeKeys();
    const hoveredEdgeKey = hoverEdgeKey();

    const focusNodeIds = new Set<string>();
    if (hov) focusNodeIds.add(hov);
    if (sel) focusNodeIds.add(sel);
    if (multiSel && multiSel.size > 0) {
      for (const id of multiSel) focusNodeIds.add(id);
    }

    const showEdges =
      focusNodeIds.size > 0 || selectedEdgeKeysSet.size > 0 || hoveredEdgeKey !== null;

    let siblingEdgeKeys: Set<string> | null = null;
    if (selectedEdgeKeysSet.size > 0) {
      siblingEdgeKeys = new Set<string>();
      const tuples = new Set<string>();
      for (const l of simLinks) {
        if (selectedEdgeKeysSet.has(l._key)) tuples.add(`${String(l.kind)}|${l.label ?? ""}`);
      }
      for (const l of simLinks) {
        const key = `${String(l.kind)}|${l.label ?? ""}`;
        if (tuples.has(key)) siblingEdgeKeys.add(l._key);
      }
    }

    return {
      showEdges,
      focusNodeIds,
      selectedEdgeKeysSet,
      hoveredEdgeKey,
      siblingEdgeKeys,
    };
  }

  function isEdgeVisibleInScope(
    link: SimLink,
    aId: string,
    bId: string,
    scope: {
      showEdges: boolean;
      focusNodeIds: Set<string>;
      selectedEdgeKeysSet: Set<string>;
      hoveredEdgeKey: string | null;
      siblingEdgeKeys: Set<string> | null;
    }
  ): boolean {
    // hub-scaffolding edges (any edge with a hub node on either end)
    // are always drawn so the drill ancestry chain — selected remote ─
    // relation ─ value ─ entity — stays visible no matter how deep the
    // user walks. without this, the entire trail vanishes the instant
    // the drill leaves a parent hub, because the parent edge no longer
    // touches a focused node.
    const src = typeof link.source === "object" ? (link.source as SimNode) : null;
    const tgt = typeof link.target === "object" ? (link.target as SimNode) : null;
    if ((src && isHubNode(src)) || (tgt && isHubNode(tgt))) return true;

    if (!scope.showEdges) return false;
    const touchesFocused = scope.focusNodeIds.has(aId) || scope.focusNodeIds.has(bId);
    if (touchesFocused) return true;
    if (scope.selectedEdgeKeysSet.has(link._key)) return true;
    if (scope.hoveredEdgeKey === link._key) return true;
    if (scope.siblingEdgeKeys?.has(link._key)) return true;
    return false;
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

  /** find edge near a screen-space point; threshold in screen px.
   *  iterates aggregated pairs (not individual links) — much cheaper
   *  on dense graphs since avg multiplicity is 2-3x. for multi-kind
   *  pairs (rendered as parallel stripes), the signed perpendicular
   *  offset of the click from the centerline picks the specific
   *  stripe — single-clicking still selects a single relation. */
  function findEdgeAt(sx: number, sy: number, threshold = 6): SimLink | null {
    const scope = getEdgeVisibilityScope();
    if (!scope.showEdges) return null;

    const v = view();
    let best: SimLink | null = null;
    let bestDist = threshold;
    const curved = curvature() > 0;
    // stripe spacing in screen px (matches the world-space spacing
    // used by the draw loop: STRIPE_W_SCREEN world-px-per-zoom). kept
    // in sync with the draw-side constant.
    const stripeSpacingScreen = 2.5;
    for (const p of pairs) {
      const ax = (p.a.x ?? 0) * v.k + v.tx;
      const ay = (p.a.y ?? 0) * v.k + v.ty;
      const bx = (p.b.x ?? 0) * v.k + v.tx;
      const by = (p.b.y ?? 0) * v.k + v.ty;
      let cpsx = (ax + bx) * 0.5;
      let cpsy = (ay + by) * 0.5;
      if (curved) {
        const cpW = edgeControlPoint(p.a.x ?? 0, p.a.y ?? 0, p.b.x ?? 0, p.b.y ?? 0);
        cpsx = cpW.cx * v.k + v.tx;
        cpsy = cpW.cy * v.k + v.ty;
      }
      const N = p.links.length;
      const aId = p.a.id;
      const bId = p.b.id;
      // extra pad for the stripe bundle's perpendicular spread.
      const bundlePad = N > 1 ? ((N - 1) / 2) * stripeSpacingScreen : 0;
      const pad = threshold + bundlePad;
      // cheap AABB reject: skip pairs whose curve bbox is too far
      // from the hit point.
      const minX = Math.min(ax, bx, cpsx) - pad;
      const maxX = Math.max(ax, bx, cpsx) + pad;
      if (sx < minX || sx > maxX) continue;
      const minY = Math.min(ay, by, cpsy) - pad;
      const maxY = Math.max(ay, by, cpsy) + pad;
      if (sy < minY || sy > maxY) continue;
      const r = pointCurveDistT(sx, sy, ax, ay, cpsx, cpsy, bx, by, curved);
      if (N === 1) {
        const only = p.links[0];
        if (!isEdgeVisibleInScope(only, aId, bId, scope)) continue;
        if (r.dist < bestDist) {
          bestDist = r.dist;
          best = only;
        }
        continue;
      }
      // multi-kind pair: compute signed perpendicular offset of the
      // click from the centerline, then snap to the nearest stripe.
      const tlen = Math.hypot(r.tanX, r.tanY) || 1;
      const nx = -r.tanY / tlen;
      const ny = r.tanX / tlen;
      const signedOff = (sx - r.cx) * nx + (sy - r.cy) * ny;
      for (let idx = 0; idx < N; idx++) {
        const link = p.links[idx];
        if (!isEdgeVisibleInScope(link, aId, bId, scope)) continue;
        const matchedOff = (idx - (N - 1) / 2) * stripeSpacingScreen;
        const distToStripe = Math.abs(signedOff - matchedOff);
        if (distToStripe < bestDist) {
          bestDist = distToStripe;
          best = link;
        }
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
        startK: number;
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
    | {
        type: "node";
        node: SimNode;
        pointerId: number;
        moved: boolean;
        /** when set, this drag is a "strength gesture" on a relation
         *  hub: cursor delta maps to a 0..1 strength value for the
         *  hub's kind instead of moving the node. populated only if
         *  the hit was a relation hub AND the parent provided an
         *  `onRelationStrengthChange` callback. */
        strength?: {
          kind: string;
          baseValue: number;
          startSx: number;
          startSy: number;
          /** latest cursor position — used to anchor the overlay
           *  label so it tracks the pointer during the drag. */
          latestSx: number;
          latestSy: number;
          /** most recently committed value; used for the overlay
           *  label + ring arc and for the no-op short-circuit when
           *  the cursor hasn't moved. */
          currentValue: number;
        };
      }
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
      startK: v1.k,
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

  // fallback local hit-test used only for press resolution when the
  // worker hit-test returns null (often timeout under load). this keeps
  // click-select responsive for small hub sets without depending on an
  // async round-trip.
  function localHitFromPress(d: Extract<Drag, { type: "press" }>): SimNode | null {
    const wx = (d.startSx - d.startTx) / d.startK;
    const wy = (d.startSy - d.startTy) / d.startK;
    const r = Math.max(nodeSize() * 0.55, 12 / d.startK);
    const r2 = r * r;
    let best: SimNode | null = null;
    let bestD2 = Infinity;
    for (const n of simNodes) {
      const nx = n.x ?? 0;
      const ny = n.y ?? 0;
      const dx = nx - wx;
      const dy = ny - wy;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = n;
      }
    }
    return best;
  }

  function localHitFromHover(sx: number, sy: number): SimNode | null {
    const [wx, wy] = screenToWorld(sx, sy);
    const v0 = view();
    const r = Math.max(nodeSize() * 0.55, 12 / v0.k);
    const r2 = r * r;
    let best: SimNode | null = null;
    let bestD2 = Infinity;
    for (const n of simNodes) {
      const nx = n.x ?? 0;
      const ny = n.y ?? 0;
      const dx = nx - wx;
      const dy = ny - wy;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = n;
      }
    }
    return best;
  }

  /** finalize a press: convert the "press" drag state to node/pan/lasso
   *  (or fire click-select if pointerup already happened). */
  function onPressResolved(pressId: number, nodeId: string | null) {
    const d = drag();
    if (!d || d.type !== "press" || d.pressId !== pressId) return;
    const fromWorker = nodeId ? (simNodesById.get(nodeId) ?? null) : null;
    const hit = fromWorker ?? localHitFromPress(d);

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
      // relation hub + parent wants strength control → enter a
      // "strength drag" sub-mode instead of pinning/moving the node.
      // we still use the "node" Drag variant so the existing
      // press/select pipeline keeps working (a tap without movement
      // still selects the hub).
      let strength: Extract<Drag, { type: "node" }>["strength"] | undefined;
      if (isRelationHubId(hit.artistId) && props.onRelationStrengthChange) {
        const kind = parseRelationHubId(hit.artistId);
        if (kind) {
          const baseValue = clamp(props.relationStrengths?.[kind] ?? 0.5, 0, 1);
          strength = {
            kind,
            baseValue,
            startSx: d.startSx,
            startSy: d.startSy,
            latestSx: d.latestSx,
            latestSy: d.latestSy,
            currentValue: baseValue,
          };
        }
      }
      if (!strength && !props.lockNodes) {
        hit.fx = hit.x;
        hit.fy = hit.y;
        worker?.pin(hit.id, hit.x ?? 0, hit.y ?? 0);
        worker?.alphaTarget(0.3, true);
      }
      setDrag({ type: "node", node: hit, pointerId: d.pointerId, moved: false, strength });
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
      markInteracting();
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
      // relation hub strength gesture: translate cursor delta into a
      // normalized 0..1 strength for the hub's kind. don't pin / move
      // the node, and don't reheat the sim — the parent's strength
      // write triggers its own (debounced) worker update.
      if (d.strength) {
        const dx = sx - d.strength.startSx;
        // up = positive; combining vertical + horizontal makes the
        // gesture work whether the user prefers swiping up or right.
        const dy = d.strength.startSy - sy;
        const RANGE_PX = 140;
        const next = clamp(d.strength.baseValue + (dx + dy) / RANGE_PX, 0, 1);
        if (!d.moved && Math.abs(dx) + Math.abs(dy) > 3) {
          d.moved = true;
          props.onUserInteract?.();
        }
        // mutate in-place so the next move sees the latest values
        // (createSignal cmp would otherwise be a no-op).
        d.strength.latestSx = sx;
        d.strength.latestSy = sy;
        d.strength.currentValue = next;
        // re-emit the signal so the overlay <Show/> reacts.
        setDrag({ ...d, strength: { ...d.strength } });
        props.onRelationStrengthChange?.(d.strength.kind, next);
        return;
      }
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
      markInteracting();
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
      // relation hub strength gesture: no pin/unpin to undo and no
      // selection change on release if the user actually dragged.
      // a no-move release still falls through to the click-select
      // path below so a plain tap on the hub keeps working.
      if (d.strength) {
        if (d.moved) {
          setDrag(null);
          requestDraw();
          return;
        }
        // fall through: treat as click-select
      } else {
        d.node.fx = null;
        d.node.fy = null;
        worker?.unpin(d.node.id);
        if (!props.lockNodes) worker?.alphaTarget(0);
      }
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
    markInteracting();
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
    const key = props.topologyKey;
    if (key === lastTopologyKey) return;
    lastTopologyKey = key;
    // topology switch (e.g. remote change): reset camera + transient
    // picks so the new graph starts from a truly fresh baseline.
    setView({ tx: 0, ty: 0, k: 1 });
    setHoverId(null);
    setHoverEdgeKey(null);
    setInternalSelected(null);
    setSelectedEdgeKeys(new Set<string>());
    hoverEdgeScreenPos = null;
    hardResetTopologyState();
    rebuild();
  });

  createEffect(() => {
    void props.nodes;
    if (!deriveMode()) void props.edges;
    void props.relationStrengths;
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

  // redraw when the loading-node set changes so newly-flagged nodes
  // start their comet trail (and cleared ones stop) on the next frame.
  createEffect(() => {
    void props.loadingNodeIds;
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
      {/* relation-hub strength gesture overlay \u2014 small floating label
          showing the current strength as a percentage. positioned at
          the cursor so it doesn't get hidden under the pointer. */}
      <Show
        when={(() => {
          const d = drag();
          return d?.type === "node" && d.strength ? d : null;
        })()}
        keyed
      >
        {(d) => {
          const s = d.strength!;
          return (
            <div
              class="pointer-events-none absolute z-20 rounded-md border border-white/20 bg-black/70 px-2 py-1 text-[11px] font-mono leading-none text-white shadow-lg backdrop-blur-sm"
              style={{
                left: `${s.latestSx + 14}px`,
                top: `${s.latestSy + 14}px`,
              }}
            >
              {s.kind} strength: {Math.round(s.currentValue * 100)}%
            </div>
          );
        }}
      </Show>
    </div>
  );
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// distance from point to either a straight or bezier curve, plus the
// curve parameter `t` of the closest point, the closest point
// (`cx`,`cy`) and the (un-normalized) tangent direction at that point
// (`tanX`,`tanY`). used by the aggregated edge hit-test to pick the
// specific parallel stripe a click landed on (via signed perpendicular
// offset from the centerline).
function pointCurveDistT(
  px: number,
  py: number,
  sx: number,
  sy: number,
  cx: number,
  cy: number,
  tx: number,
  ty: number,
  curved: boolean,
  samples = 12
): { dist: number; t: number; cx: number; cy: number; tanX: number; tanY: number } {
  if (!curved) {
    const dx = tx - sx;
    const dy = ty - sy;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) {
      return {
        dist: Math.hypot(px - sx, py - sy),
        t: 0,
        cx: sx,
        cy: sy,
        tanX: 1,
        tanY: 0,
      };
    }
    let t = ((px - sx) * dx + (py - sy) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const x = sx + dx * t;
    const y = sy + dy * t;
    return { dist: Math.hypot(px - x, py - y), t, cx: x, cy: y, tanX: dx, tanY: dy };
  }
  // bezier: sample into line segments, find the closest sub-segment AND
  // the projection parameter within it; interpolate to get the curve t.
  let best = Infinity;
  let bestT = 0;
  let bestCX = sx;
  let bestCY = sy;
  let prevX = sx;
  let prevY = sy;
  for (let i = 1; i <= samples; i++) {
    const t = i / samples;
    const it = 1 - t;
    const x = it * it * sx + 2 * it * t * cx + t * t * tx;
    const y = it * it * sy + 2 * it * t * cy + t * t * ty;
    const ddx = x - prevX;
    const ddy = y - prevY;
    const lenSq = ddx * ddx + ddy * ddy;
    let u = 0;
    if (lenSq > 0) {
      u = ((px - prevX) * ddx + (py - prevY) * ddy) / lenSq;
      if (u < 0) u = 0;
      else if (u > 1) u = 1;
    }
    const xx = prevX + ddx * u;
    const yy = prevY + ddy * u;
    const d = Math.hypot(px - xx, py - yy);
    if (d < best) {
      best = d;
      const tPrev = (i - 1) / samples;
      bestT = tPrev + (t - tPrev) * u;
      bestCX = xx;
      bestCY = yy;
    }
    prevX = x;
    prevY = y;
  }
  // tangent of B(t) = 2(1-t)(P1-P0) + 2t(P2-P1).
  const itB = 1 - bestT;
  const tanX = 2 * itB * (cx - sx) + 2 * bestT * (tx - cx);
  const tanY = 2 * itB * (cy - sy) + 2 * bestT * (ty - cy);
  return { dist: best, t: bestT, cx: bestCX, cy: bestCY, tanX, tanY };
}
