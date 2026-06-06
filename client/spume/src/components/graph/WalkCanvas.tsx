// graph2/WalkCanvas.tsx — SolidJS canvas component.
// renders the walk graph: shapes per role, edge lines, labels, hover highlight.

import { createEffect, createSignal, onCleanup, onMount, createMemo } from "solid-js";
import type { Accessor } from "solid-js";
import type { WalkGraph, NodeRole } from "./types";
import type { GraphDriver } from "./drivers/GraphDriver";
import type { VisibleNode, TopologyEdge } from "./worker/messages";
import type { ImageMetadata } from "../../music/services/storage/types";
import { getNodeImage } from "./render/imageAtlas";
import { nodeDisplayRadius as sharedNodeDisplayRadius } from "./nodeRadius";

/** imperative api for controlling the walk canvas from outside. obtained via onReady prop. */
export interface WalkApi {
  /** fit all visible nodes into the viewport with a margin. no-op if no visible nodes. */
  fit(): void;
  /** reset viewport to origin (tx=0, ty=0, k=1), clears auto-follow latch. does not touch worker state. */
  resetView(): void;
  /** repivot to the initial pivot with breadcrumb reset, then reset viewport. */
  resetWalk(): void;
  /** pop one breadcrumb step (no-op if already at root). */
  back(): void;
}

export interface WalkCanvasProps {
  graph: WalkGraph;
  /** insets in px reserved by chrome (playerbar bottom, sidebar right, etc.).
   *  defaults to 0. in real freqhole pass { bottom: 72, right: 320 } when bars
   *  are visible. **/
  insets?: { bottom?: number; right?: number };
  /** which node to start focused on */
  initialPivot: string;
  /** optional pre-seeded breadcrumb for stories that start mid-walk */
  initialBreadcrumb?: string[];
  width?: number;
  height?: number;
  /** called when a node is selected (album: inspect only; artist: inspect + pivot) */
  onSelect?: (nodeId: string, role: NodeRole) => void;
  /** called when a click results in a pivot change (expand was called) */
  onPivot?: (nodeId: string) => void;
  /** controlled selection ring, distinct from the pivot ring */
  selectedId?: string | null;
  /** required: host-owned driver. host is responsible for `dispose()`
   *  in its own onCleanup. currently always a `WalkerDriver`
   *  (worker-backed). */
  driver: GraphDriver;
  /** fires once after onMount, with the curated WalkApi for fit/reset/back.
   *  prefer this over onClientReady for ui-level concerns. */
  onReady?: (api: WalkApi) => void;
  /** called whenever the breadcrumb depth changes (1 = at root, 2 = one level deep, etc.).
   *  host uses this to show/hide the back button. `breadcrumbIds` is the
   *  (unordered) set of node ids currently on the breadcrumb path from
   *  root to pivot, inclusive — host uses this to derive the primary
   *  remote for the current walk (the `remote::*` entry). */
  onBreadcrumbChange?: (depth: number, breadcrumbIds: string[]) => void;
  /** per-id image metadata lookup. when provided, album and artist nodes
   *  render their cover/avatar artwork inside the node shape. */
  getImage?: (id: string) => ImageMetadata | null;
  /** per-id offline flag. when true for a node, it's drawn dimmed.
   *  used to mark unreachable remote hubs (and their subtrees) without
   *  taking them out of the graph. */
  isOfflineNode?: (id: string) => boolean;
  /** per-id loading flag. when true, the node renders an animated
   *  pink→purple comet arc orbiting its silhouette, matching the
   *  player-bar play/pause loading ring. used to signal that a remote
   *  hub is fetching its album page (or other async work in progress). */
  isLoadingNode?: (id: string) => boolean;
  /** optional click interceptor. return true to consume the click; the
   *  canvas will skip its default expand/pivot behavior for that node.
   *  used to retry a health check when clicking an offline remote. */
  interceptClick?: (id: string, role: NodeRole) => boolean;
  /** when true, pivot-on-click is suspended; lasso and modifier-key multi-select activate. */
  editMode?: Accessor<boolean>;
  /** node ids currently in the multi-selection. rendered with selection rings. */
  multiSelection?: Accessor<Set<string>>;
  /** fires whenever the multi-selection changes (lasso close or modifier click). */
  onMultiSelectionChange?: (ids: Set<string>) => void;
  /** fires when a drag-drop completes in edit mode over a valid target node. */
  onDrop?: (sourceIds: Set<string>, targetId: string) => void;
  /** fires when the user long-presses a group (7-sided) node to toggle
   *  eager subtree expansion. host should toggle its own bookkeeping
   *  (e.g. set of expanded hub ids) so it can drive album loading for
   *  visible descendant taxons. canvas already calls `expandSubtree`
   *  on the worker; this callback is purely a notification. */
  onExpandSubtree?: (id: string) => void;
  /** fires on right-click over a canvas edge. */
  onEdgeRightClick?: (srcId: string, tgtId: string) => void;
}

import {
  ROLE_COLOR,
  EDGE_COLOR,
  EDGE_ALBUM,
  CROSS_REMOTE_COLOR,
  RELATED_ARTIST_EDGE_COLOR,
  SELECTION_RING_COLOR,
  HOVER_RING_COLOR,
} from "./walkCanvas/colors";
import { nodeRemoteId } from "./walkCanvas/idUtils";
import { edgeKindColor, hubEdgeColor } from "./walkCanvas/nodeStyle";
import { nodeShapePath, pointInPolygon } from "./walkCanvas/shapes";
import { drawNode, drawLabel, drawLoadingComet } from "./walkCanvas/drawing";

export default function WalkCanvas(props: WalkCanvasProps) {
  let canvas!: HTMLCanvasElement;

  // when no explicit dimensions given, fill the window minus any chrome insets.
  // update reactively on resize so the worker always gets the real viewport size.
  const [winW, setWinW] = createSignal(window.innerWidth);
  const [winH, setWinH] = createSignal(window.innerHeight);

  const w = createMemo(() => props.width ?? winW() - (props.insets?.right ?? 0));
  const h = createMemo(() => props.height ?? winH() - (props.insets?.bottom ?? 0));

  function onWindowResize() {
    setWinW(window.innerWidth);
    setWinH(window.innerHeight);
  }

  // latest topology snapshot
  let nodes: VisibleNode[] = [];
  let edges: TopologyEdge[] = [];
  // latest position buffer
  let positions: Float32Array = new Float32Array(0);

  const [hoveredId, setHoveredId] = createSignal<string | null>(null);
  let rafId = 0;

  // ---- viewport (pan / zoom) ------------------------------------------------
  // tx/ty translate world→screen, k scales. starts identity.
  // wheel/trackpad/pinch all flow through `setView`. hit-tests convert
  // screen coords back to world via `screenToWorld`.
  type Viewport = { tx: number; ty: number; k: number };
  const [view, setView] = createSignal<Viewport>({ tx: 0, ty: 0, k: 1 });

  function clamp(n: number, lo: number, hi: number) {
    return n < lo ? lo : n > hi ? hi : n;
  }

  function clientToCanvas(e: { clientX: number; clientY: number }): [number, number] {
    const rect = canvas.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  function screenToWorld(sx: number, sy: number): [number, number] {
    const v = view();
    return [(sx - v.tx) / v.k, (sy - v.ty) / v.k];
  }

  // multi-pointer state for drag-pan + pinch-zoom
  const activePointers = new Map<number, { sx: number; sy: number }>();
  type PanState = {
    pointerId: number;
    startSx: number;
    startSy: number;
    startTx: number;
    startTy: number;
    moved: boolean;
  };
  const [panState, setPanState] = createSignal<PanState | null>(null);
  let pinchState: {
    p1: number;
    p2: number;
    initialDist: number;
    initialK: number;
    initialTx: number;
    initialTy: number;
    centerSx: number;
    centerSy: number;
  } | null = null;
  // press-vs-pan disambiguation: if pointer wanders >3px before release,
  // it's a pan; otherwise a click that fires hit-test on pointerup.
  const PAN_THRESHOLD = 3;

  // long-press on a group node \u2192 expand subtree. timer fires after
  // LONG_PRESS_MS without significant pointer movement; the resulting
  // click on pointerup is suppressed via longPressFired.
  const LONG_PRESS_MS = 450;
  const LONG_PRESS_MOVE_TOLERANCE_PX = 6;
  let longPressTimer: number | null = null;
  let longPressPointerId: number | null = null;
  let longPressStart: { sx: number; sy: number } | null = null;
  let longPressFired = false;
  function cancelLongPress() {
    if (longPressTimer !== null) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
    longPressPointerId = null;
    longPressStart = null;
  }

  type LassoState = {
    pointerId: number;
    startSx: number;
    startSy: number;
    startedOnNode: boolean;
  };
  const [lassoState, setLassoState] = createSignal<LassoState | null>(null);
  // lasso trail points in css screen coords; mutable ref to avoid creating a
  // new array on every pointermove event (draw loop reads it directly).
  let lassoPoints: { x: number; y: number }[] = [];
  // node id that was hit on pointer-down in edit mode; used to seed drag-drop.
  let dragSourceId: string | null = null;
  // active drag state: set once the pointer moves past the threshold in edit mode.
  let dragState: {
    sourceIds: Set<string>;
    curSx: number;
    curSy: number;
    targetId: string | null;
  } | null = null;
  // clear lasso trail whenever edit mode is turned off
  createEffect(() => {
    if (!props.editMode?.()) {
      lassoPoints = [];
      setLassoState(null);
      dragState = null;
      dragSourceId = null;
    }
  });

  // latched when the user manually pans (drag or wheel-pan). disables the
  // proportional pivot-follow until the next pivot change clears it, so we
  // never fight the user when they're exploring far from the pivot.
  let userPanned = false;
  let lastPivotId: string | null = null;

  // host owns the driver lifecycle (creation + disposal). we never
  // dispose here; the host's onCleanup does that. this lets the host
  // keep a reference for merge/setHidden/etc. calls.
  const client = props.driver;
  onCleanup(() => {
    cancelAnimationFrame(rafId);
    window.removeEventListener("resize", onWindowResize);
  });

  // register listeners
  client.onTopology((nds, eds) => {
    nodes = nds;
    edges = eds;
    // re-engage auto-follow whenever the pivot changes
    const piv = nds.find((n) => n.isPivot)?.id ?? null;
    if (piv !== lastPivotId) {
      lastPivotId = piv;
      userPanned = false;
    }
    // breadcrumb depth: count nodes with isBreadcrumb=true (ancestors) + 1 for the pivot.
    // also surface the id list (ancestors + pivot) so the host can pick the
    // primary remote (the `remote::*` entry) for cluster-aware popover data.
    const crumbIds: string[] = [];
    for (const n of nds) {
      if (n.isBreadcrumb || n.isPivot) crumbIds.push(n.id);
    }
    const depth = nds.filter((n) => n.isBreadcrumb).length + 1;
    props.onBreadcrumbChange?.(depth, crumbIds);
  });
  client.onFrame((pos) => {
    positions = pos;
  });

  // synchronous hit-test using the current nodes/positions snapshot.
  // used in onPointerDown to decide between lasso-start and node-drag-start.
  function syncHitTest(sx: number, sy: number): string | null {
    const v = view();
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      const wx = positions[i * 2];
      const wy = positions[i * 2 + 1];
      if (!Number.isFinite(wx) || !Number.isFinite(wy)) continue;
      const nsx = wx * v.k + v.tx;
      const nsy = wy * v.k + v.ty;
      const r = nodeDisplayRadius(n) * v.k;
      const dx = sx - nsx;
      const dy = sy - nsy;
      if (dx * dx + dy * dy <= r * r) return n.id;
    }
    return null;
  }

  // converts lasso screen-space polygon to the set of node ids whose
  // screen positions fall inside the closed polygon.
  function computeLassoSelection(poly: { x: number; y: number }[]): Set<string> {
    const v = view();
    const selected = new Set<string>();
    for (let i = 0; i < nodes.length; i++) {
      const wx = positions[i * 2];
      const wy = positions[i * 2 + 1];
      if (!Number.isFinite(wx) || !Number.isFinite(wy)) continue;
      const sx = wx * v.k + v.tx;
      const sy = wy * v.k + v.ty;
      if (pointInPolygon(sx, sy, poly)) selected.add(nodes[i].id);
    }
    return selected;
  }

  onMount(() => {
    // storybook-solidjs-vite wraps story args in a createStore, making props
    // reactive Store proxies. Proxies can't be structured-cloned across worker
    // boundaries, so we serialize to plain JSON first.
    const plainGraph = JSON.parse(JSON.stringify(props.graph));
    const plainBreadcrumb = props.initialBreadcrumb
      ? JSON.parse(JSON.stringify(props.initialBreadcrumb))
      : undefined;
    window.addEventListener("resize", onWindowResize);
    client.init(plainGraph, props.initialPivot, w(), h(), plainBreadcrumb);

    // canvas bitmap + css sizing are owned by the resize createEffect below;
    // running it once at mount is enough to get the first frame right.
    const ctx = canvas.getContext("2d")!;
    // note: no ctx.scale(dpr,dpr) here — we set the full transform every
    // frame in draw() to fold dpr together with the viewport tx/ty/k.

    function draw() {
      // clear in identity space, then apply (dpr * viewport) for content
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // background — pure black
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      if (nodes.length === 0 || positions.length === 0) {
        rafId = requestAnimationFrame(draw);
        return;
      }

      // ---- gentle pivot-follow pan ------------------------------------------
      // proportional controller: if the pivot drifts outside the viewport
      // (with a screen-px margin), nudge tx/ty a small fraction toward
      // bringing it just inside. produces zero delta when in-frame, so it
      // self-stops; never touches k. skipped while user is actively
      // dragging or pinching so we don't fight input. also skipped once the
      // user has manually panned — they're exploring, leave them alone
      // until they pick a new pivot.
      if (!userPanned && !panState() && !pinchState) {
        const pi = nodes.findIndex((n) => n.isPivot);
        if (pi !== -1) {
          const wx = positions[pi * 2];
          const wy = positions[pi * 2 + 1];
          if (Number.isFinite(wx) && Number.isFinite(wy)) {
            const vNow = view();
            const sx = wx * vNow.k + vNow.tx;
            const sy = wy * vNow.k + vNow.ty;
            const margin = 80;
            const W = w();
            const H = h();
            let dx = 0;
            let dy = 0;
            if (sx < margin) dx = margin - sx;
            else if (sx > W - margin) dx = W - margin - sx;
            if (sy < margin) dy = margin - sy;
            else if (sy > H - margin) dy = H - margin - sy;
            if (dx !== 0 || dy !== 0) {
              const FOLLOW_RATE = 0.12;
              setView({
                k: vNow.k,
                tx: vNow.tx + dx * FOLLOW_RATE,
                ty: vNow.ty + dy * FOLLOW_RATE,
              });
            }
          }
        }
      }

      const v = view();
      const dpr = window.devicePixelRatio ?? 1;
      // world → device px:  (world * k + t) * dpr
      ctx.setTransform(dpr * v.k, 0, 0, dpr * v.k, dpr * v.tx, dpr * v.ty);

      const hov = hoveredId();
      const selId = props.selectedId ?? null;

      // compute co-highlight sets: when an artist is hovered/selected,
      // mark all its connected album nodes for secondary ring rendering.
      const coHoveredIds = new Set<string>();
      const coSelectedIds = new Set<string>();

      if (hov) {
        const hovNode = nodes.find((n) => n.id === hov);
        if (hovNode?.role === "artist") {
          for (const e of edges) {
            const src = nodes[e.sourceIdx];
            const tgt = nodes[e.targetIdx];
            if (src?.id === hov && tgt?.role === "album") coHoveredIds.add(tgt.id);
            if (tgt?.id === hov && src?.role === "album") coHoveredIds.add(src.id);
          }
        }
      }

      if (selId) {
        const selNode = nodes.find((n) => n.id === selId);
        if (selNode?.role === "artist") {
          for (const e of edges) {
            const src = nodes[e.sourceIdx];
            const tgt = nodes[e.targetIdx];
            if (src?.id === selId && tgt?.role === "album") coSelectedIds.add(tgt.id);
            if (tgt?.id === selId && src?.role === "album") coSelectedIds.add(src.id);
          }
        }
      }

      // pre-pass: pick which edges deserve a mid-edge label. labelling
      // every related-artist / cross-remote wire gets noisy quickly, so
      // cap to a handful per "distinct connection" (kind/remote-pair)
      // and pick the longest wires — they have room for the pill and
      // benefit most from being named. unlabelled edges still carry the
      // colour/dash hint so the relationship reads visually.
      const MAX_RELATED_ARTIST_LABELS = 3;
      const MAX_CROSS_REMOTE_LABELS_PER_PAIR = 3;
      const labelEdges = new Set<TopologyEdge>();
      const relCands: { e: TopologyEdge; len2: number }[] = [];
      const crossCands = new Map<string, { e: TopologyEdge; len2: number }[]>();
      for (const e of edges) {
        if (!e.isRelatedArtist && !e.isCrossRemote) continue;
        const x0 = positions[e.sourceIdx * 2];
        const y0 = positions[e.sourceIdx * 2 + 1];
        const x1 = positions[e.targetIdx * 2];
        const y1 = positions[e.targetIdx * 2 + 1];
        if (!Number.isFinite(x0) || !Number.isFinite(y0)) continue;
        if (!Number.isFinite(x1) || !Number.isFinite(y1)) continue;
        const dx = x1 - x0;
        const dy = y1 - y0;
        const len2 = dx * dx + dy * dy;
        if (e.isRelatedArtist) {
          relCands.push({ e, len2 });
        } else {
          const sn = nodes[e.sourceIdx];
          const tn = nodes[e.targetIdx];
          const a = sn ? nodeRemoteId(sn.id) : undefined;
          const b = tn ? nodeRemoteId(tn.id) : undefined;
          if (!a || !b || a === b) continue;
          const key = a < b ? `${a}|${b}` : `${b}|${a}`;
          let arr = crossCands.get(key);
          if (!arr) {
            arr = [];
            crossCands.set(key, arr);
          }
          arr.push({ e, len2 });
        }
      }
      relCands.sort((a, b) => b.len2 - a.len2);
      for (let i = 0; i < Math.min(MAX_RELATED_ARTIST_LABELS, relCands.length); i++) {
        labelEdges.add(relCands[i].e);
      }
      for (const arr of crossCands.values()) {
        arr.sort((a, b) => b.len2 - a.len2);
        for (let i = 0; i < Math.min(MAX_CROSS_REMOTE_LABELS_PER_PAIR, arr.length); i++) {
          labelEdges.add(arr[i].e);
        }
      }

      // draw edges
      for (const e of edges) {
        const x0 = positions[e.sourceIdx * 2];
        const y0 = positions[e.sourceIdx * 2 + 1];
        const x1 = positions[e.targetIdx * 2];
        const y1 = positions[e.targetIdx * 2 + 1];
        if (!Number.isFinite(x0) || !Number.isFinite(y0)) continue;

        // by default, an album only shows its parent-artist wire \u2014 the
        // value/relation/remote cross-edges into it would clutter the graph
        // with rays from every taxon hub the album belongs to. when the
        // album is selected we surface them again so the user can see what
        // taxons connect it.
        const sn = nodes[e.sourceIdx];
        const tn = nodes[e.targetIdx];
        const albumEnd = sn?.role === "album" ? sn : tn?.role === "album" ? tn : null;
        if (albumEnd && albumEnd.id !== selId) {
          const otherRole = sn?.role === "album" ? tn?.role : sn?.role;
          if (otherRole !== "artist") continue;
        }

        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        const isAlbumEdge =
          nodes[e.sourceIdx]?.role === "album" || nodes[e.targetIdx]?.role === "album";
        // ghost-incident edges are kept in the sim for force layout
        // (so ghosts stay near their pivot instead of drifting off)
        // but rendered invisible — they'd just add clutter.
        if (sn?.role === "ghost_artist" || tn?.role === "ghost_artist") continue;
        // taxon edges (anything touching a value node) inherit the value
        // kind's color so all "tagged-with" wires for a given kind share a hue.
        const kindEdge = edgeKindColor(nodes[e.sourceIdx], nodes[e.targetIdx]);
        // cross-remote synthetic links: drawn amber-dashed so federation is
        // visually obvious and distinguishable from the breadcrumb path.
        const isRootRemoteEdge =
          (sn?.role === "root" && tn?.role === "remote") ||
          (tn?.role === "root" && sn?.role === "remote");
        if (e.isRelatedArtist) {
          // related-artist edges: lavender, slightly thicker so they
          // pop above the artist→album wires they coexist with.
          // pending rows render dashed + dimmer so they read as
          // "proposed but unconfirmed".
          ctx.strokeStyle = RELATED_ARTIST_EDGE_COLOR;
          ctx.lineWidth = e.isPending ? 1.25 : 1.75;
          ctx.globalAlpha = e.isPending ? 0.5 : 0.85;
          if (e.isPending) ctx.setLineDash([4, 3]);
        } else if (e.isCrossRemote) {
          ctx.setLineDash([6, 4]);
          ctx.strokeStyle = CROSS_REMOTE_COLOR;
          ctx.lineWidth = 1.5;
          ctx.globalAlpha = 0.75;
        } else if (isRootRemoteEdge) {
          // root↔remote spokes use the root's magenta hue so the
          // "federation backbone" reads as a single coherent unit
          // instead of inheriting the breadcrumb amber.
          ctx.strokeStyle = ROLE_COLOR.root;
          ctx.lineWidth = e.isBreadcrumb ? 2.5 : 1.5;
          ctx.globalAlpha = 0.85;
        } else {
          // breadcrumb edges adopt the upstream hub's color so the
          // navigation trail reads as a continuation of the hub it
          // emanates from (root magenta, remote pink, relation cyan,
          // etc.) instead of a uniform amber stripe.
          ctx.strokeStyle = e.isBreadcrumb
            ? hubEdgeColor(sn, tn)
            : kindEdge
              ? kindEdge
              : isAlbumEdge
                ? EDGE_ALBUM
                : EDGE_COLOR;
          ctx.lineWidth = e.isBreadcrumb ? 2.5 : 1;
          ctx.globalAlpha = e.isBreadcrumb ? 0.9 : kindEdge ? 0.65 : isAlbumEdge ? 0.8 : 0.7;
        }
        // focus boost: when either endpoint is the currently hovered or
        // selected node, fatten the edge and crank opacity so the
        // node's connections pop out from the rest of the graph.
        // hover gets the strongest boost; selection is a touch softer
        // so a sticky selection doesn't permanently drown out hover.
        const sId = sn?.id;
        const tId = tn?.id;
        const isHovered = hov != null && (sId === hov || tId === hov);
        const isSelected = selId != null && (sId === selId || tId === selId);
        if (isHovered || isSelected) {
          const boost = isHovered ? 2.6 : 2.0;
          ctx.lineWidth = ctx.lineWidth * boost;
          ctx.globalAlpha = Math.min(1, ctx.globalAlpha + (isHovered ? 0.25 : 0.18));
        }
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;

        // mid-edge label for related-artist edges so the relationship
        // is self-describing. drawn as a small pill at the midpoint.
        // capped via labelEdges to avoid pill-spam when many related-
        // artist wires share the viewport.
        if (e.isRelatedArtist && labelEdges.has(e)) {
          const mx = (x0 + x1) / 2;
          const my = (y0 + y1) / 2;
          const text = "related artist";
          ctx.save();
          ctx.globalAlpha = 0.7;
          ctx.font = "6.5px ui-sans-serif, system-ui, sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          const tw = ctx.measureText(text).width;
          const pillW = tw + 4;
          const pillH = 9;
          ctx.fillStyle = "rgba(0,0,0,0.7)";
          ctx.beginPath();
          ctx.roundRect(mx - pillW / 2, my - pillH / 2, pillW, pillH, 2);
          ctx.fill();
          ctx.strokeStyle = RELATED_ARTIST_EDGE_COLOR;
          ctx.lineWidth = 0.5;
          ctx.stroke();
          ctx.fillStyle = RELATED_ARTIST_EDGE_COLOR;
          ctx.fillText(text, mx, my);
          ctx.restore();
        }

        // mid-edge label for cross-remote dashed edges so the user can
        // see which remote is bridged at a glance. shows the target
        // endpoint's remote id (single name — both endpoints carry the
        // same entity, so either side works; once 1.c lands and the
        // edge re-routes to the source-remote hub, this naturally
        // reads as "lives also on $remote"). capped per remote-pair via
        // labelEdges so a busy bridge shows only a few labels.
        if (e.isCrossRemote && labelEdges.has(e)) {
          const srcR = sn ? nodeRemoteId(sn.id) : undefined;
          const tgtR = tn ? nodeRemoteId(tn.id) : undefined;
          if (srcR && tgtR && srcR !== tgtR) {
            const mx = (x0 + x1) / 2;
            const my = (y0 + y1) / 2;
            const text = tgtR;
            ctx.save();
            ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            const tw = ctx.measureText(text).width;
            const pillW = tw + 8;
            const pillH = 14;
            ctx.fillStyle = "rgba(0,0,0,0.75)";
            ctx.beginPath();
            ctx.roundRect(mx - pillW / 2, my - pillH / 2, pillW, pillH, 3);
            ctx.fill();
            ctx.strokeStyle = CROSS_REMOTE_COLOR;
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.fillStyle = CROSS_REMOTE_COLOR;
            ctx.fillText(text, mx, my);
            ctx.restore();
          }
        }
      }

      // draw nodes (back to front: ghosts (label-only) first, then albums, artists, values, relations, remotes, root)
      const roleOrder = ["ghost_artist", "album", "artist", "value", "relation", "remote", "root"];
      const sorted = [...nodes.keys()].sort((a, b) => {
        return roleOrder.indexOf(nodes[a].role) - roleOrder.indexOf(nodes[b].role);
      });

      // pass 1: shapes + hover rings + selection ring (back to front).
      // the "lifted" node (hovered → any role; else selected →
      // restricted to artist/album) is skipped here and re-drawn
      // after pass 2 so its shape + outline sits on top of every
      // other shape AND label.
      const liftIdx = (() => {
        if (hov !== null) {
          const hi = nodes.findIndex((n) => n.id === hov);
          if (hi !== -1) return hi;
        }
        if (selId !== null) {
          const si = nodes.findIndex((n) => n.id === selId);
          if (si !== -1) {
            const r = nodes[si].role;
            if (r === "artist" || r === "album") return si;
          }
        }
        return -1;
      })();

      for (const i of sorted) {
        const n = nodes[i];
        if (i === liftIdx) continue;
        const x = positions[i * 2];
        const y = positions[i * 2 + 1];
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

        const r = nodeDisplayRadius(n);

        // selection ring — drawn outermost so it's visible behind hover ring
        if (selId === n.id) {
          const selGap = n.role === "root" ? 10 : 11;
          nodeShapePath(ctx, n.role, x, y, r, selGap);
          ctx.strokeStyle = SELECTION_RING_COLOR;
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        // multi-selection ring for nodes in the edit-mode selection set
        const multiSel = props.multiSelection?.();
        if (multiSel && multiSel.has(n.id) && selId !== n.id) {
          const selGap = n.role === "root" ? 10 : 11;
          nodeShapePath(ctx, n.role, x, y, r, selGap);
          ctx.strokeStyle = SELECTION_RING_COLOR;
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        if (hov === n.id) {
          const gap = n.role === "root" ? 5 : 6;
          nodeShapePath(ctx, n.role, x, y, r, gap);
          ctx.strokeStyle = HOVER_RING_COLOR;
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        // co-highlight ring: when an artist is HOVERED, draw a
        // prominent ring on its connected album neighbors so the
        // artist's discography pops out visually. selection alone
        // doesn't trigger the ring (would be too noisy and the
        // selected artist's albums are already visually obvious
        // around the pivot).
        if (coHoveredIds.has(n.id) && hov !== n.id) {
          ctx.beginPath();
          ctx.arc(x, y, r + 7, 0, Math.PI * 2);
          ctx.strokeStyle = "rgba(255,255,255,0.75)";
          ctx.lineWidth = 3;
          ctx.stroke();
        }

        drawNode(ctx, n, x, y, r, props.getImage, props.isOfflineNode?.(n.id), hov === n.id);

        // loading comet — drawn last so it sits on top of the node fill,
        // image, stroke, and badge. uses the same rAF-driven clock as the
        // sim so it animates smoothly without its own ticker.
        if (props.isLoadingNode?.(n.id)) {
          drawLoadingComet(ctx, n.role, x, y, r, performance.now());
        }
      }

      // pass 2: all labels for non-hovered, non-lifted nodes
      const cx = w() / 2;
      const cy = h() / 2;
      for (const i of sorted) {
        const n = nodes[i];
        if (hov === n.id) continue; // drawn in pass 3
        if (i === liftIdx) continue; // drawn in lifted pass
        const x = positions[i * 2];
        const y = positions[i * 2 + 1];
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        const emph: "none" | "select" = selId === n.id ? "select" : "none";
        drawLabel(ctx, n, x, y, nodeDisplayRadius(n), cx, cy, emph);
      }

      // lifted pass: draw the hover-or-select artist/album on top of
      // every shape AND every label so its image + outline isn't buried
      // by neighbouring nodes or labels.
      if (liftIdx !== -1) {
        const n = nodes[liftIdx];
        const x = positions[liftIdx * 2];
        const y = positions[liftIdx * 2 + 1];
        if (Number.isFinite(x) && Number.isFinite(y)) {
          const r = nodeDisplayRadius(n);
          if (selId === n.id) {
            const selGap = n.role === "root" ? 10 : 11;
            nodeShapePath(ctx, n.role, x, y, r, selGap);
            ctx.strokeStyle = SELECTION_RING_COLOR;
            ctx.lineWidth = 2;
            ctx.stroke();
          }
          if (hov === n.id) {
            const gap = n.role === "root" ? 5 : 6;
            nodeShapePath(ctx, n.role, x, y, r, gap);
            ctx.strokeStyle = HOVER_RING_COLOR;
            ctx.lineWidth = 2;
            ctx.stroke();
          }
          // co-highlight ring for lifted node (hover only, same as pass 1)
          if (coHoveredIds.has(n.id) && hov !== n.id) {
            ctx.beginPath();
            ctx.arc(x, y, r + 7, 0, Math.PI * 2);
            ctx.strokeStyle = "rgba(255,255,255,0.75)";
            ctx.lineWidth = 3;
            ctx.stroke();
          }
          drawNode(ctx, n, x, y, r, props.getImage, props.isOfflineNode?.(n.id), hov === n.id);
          if (props.isLoadingNode?.(n.id)) {
            drawLoadingComet(ctx, n.role, x, y, r, performance.now());
          }
          // its label too — but only when not the hovered node (pass 3
          // handles that case so hover always wins z-order).
          if (hov !== n.id) {
            drawLabel(ctx, n, x, y, r, cx, cy, "select");
          }
        }
      }

      // pass 3: hovered node label — always on top regardless of role
      if (hov !== null) {
        const hi = nodes.findIndex((n) => n.id === hov);
        if (hi !== -1 && Number.isFinite(positions[hi * 2])) {
          drawLabel(
            ctx,
            nodes[hi],
            positions[hi * 2],
            positions[hi * 2 + 1],
            nodeDisplayRadius(nodes[hi]),
            cx,
            cy,
            "hover"
          );
        }
      }

      // lasso trail overlay — screen-space, drawn last so it sits above all nodes
      const lsSnap = lassoState();
      if (lsSnap && !lsSnap.startedOnNode && lassoPoints.length >= 2) {
        const dprLasso = window.devicePixelRatio ?? 1;
        ctx.setTransform(dprLasso, 0, 0, dprLasso, 0, 0);
        ctx.strokeStyle = "rgba(255, 58, 163, 0.65)";
        ctx.lineWidth = 2;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.moveTo(lassoPoints[0].x, lassoPoints[0].y);
        for (let pi = 1; pi < lassoPoints.length; pi++)
          ctx.lineTo(lassoPoints[pi].x, lassoPoints[pi].y);
        ctx.stroke();
      }

      // drag-drop wire overlay — screen-space. one curved line per source
      // node, ending at the target node center (snapped) or the cursor.
      const dragSnap = dragState;
      if (dragSnap && dragSnap.sourceIds.size > 0) {
        const dprDrag = window.devicePixelRatio ?? 1;
        ctx.setTransform(dprDrag, 0, 0, dprDrag, 0, 0);
        const vDrag = view();
        const nodeScreenPos = (id: string): { sx: number; sy: number; r: number } | null => {
          const idx = nodes.findIndex((n) => n.id === id);
          if (idx === -1) return null;
          const wx = positions[idx * 2];
          const wy = positions[idx * 2 + 1];
          if (!Number.isFinite(wx) || !Number.isFinite(wy)) return null;
          return {
            sx: wx * vDrag.k + vDrag.tx,
            sy: wy * vDrag.k + vDrag.ty,
            r: nodeDisplayRadius(nodes[idx]) * vDrag.k,
          };
        };
        const tgt = dragSnap.targetId ? nodeScreenPos(dragSnap.targetId) : null;
        const endSx = tgt ? tgt.sx : dragSnap.curSx;
        const endSy = tgt ? tgt.sy : dragSnap.curSy;
        const wireColor = tgt ? "rgba(110, 231, 183, 0.95)" : "rgba(255, 58, 163, 0.85)";

        ctx.strokeStyle = wireColor;
        ctx.lineWidth = tgt ? 3.5 : 2.5;
        ctx.lineCap = "round";
        ctx.setLineDash(tgt ? [] : [6, 4]);
        ctx.globalAlpha = 1;
        for (const sid of dragSnap.sourceIds) {
          const src = nodeScreenPos(sid);
          if (!src) continue;
          const dx = endSx - src.sx;
          const dy = endSy - src.sy;
          const mx = (src.sx + endSx) / 2;
          const my = (src.sy + endSy) / 2;
          // perpendicular sag for a gentle curve
          const len = Math.hypot(dx, dy) || 1;
          const sag = Math.min(40, len * 0.15);
          const cx = mx + (-dy / len) * sag;
          const cy = my + (dx / len) * sag;
          ctx.beginPath();
          ctx.moveTo(src.sx, src.sy);
          ctx.quadraticCurveTo(cx, cy, endSx, endSy);
          ctx.stroke();
        }
        ctx.setLineDash([]);

        if (tgt) {
          // pulse a snap ring around the target
          const t = (performance.now() / 600) % 1;
          const pulse = 1 + 0.18 * Math.sin(t * Math.PI * 2);
          ctx.strokeStyle = "rgba(110, 231, 183, 0.9)";
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.arc(tgt.sx, tgt.sy, tgt.r * 1.25 * pulse, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          // small dot at the cursor end when not over a target
          ctx.fillStyle = "rgba(255, 58, 163, 0.85)";
          ctx.beginPath();
          ctx.arc(endSx, endSy, 4, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      rafId = requestAnimationFrame(draw);
    }

    rafId = requestAnimationFrame(draw);

    // warm the image atlas for nodes that become visible early — kick the load
    // queue so images are ready (or in-flight) before drawNode asks for them.
    // the rAF loop picks them up without needing the onReady callback.
    client.onVisibleIds((ids) => {
      if (!props.getImage) return;
      const gi = props.getImage;
      for (const id of ids) {
        getNodeImage(id, gi(id), undefined);
      }
    });

    // curated imperative api built once the driver + listeners are wired.
    // S24: getBounds returns node centers; pad by 40px to keep largest nodes in frame.
    const FIT_MARGIN = 40;
    const api: WalkApi = {
      fit() {
        void client.getBounds().then((bounds) => {
          if (!bounds) return;
          const W = w();
          const H = h();
          const rangeX = bounds.maxX - bounds.minX;
          const rangeY = bounds.maxY - bounds.minY;
          if (rangeX <= 0 || rangeY <= 0) return;
          const k = Math.min(
            Math.max(0.1, Math.min(8, (W - 2 * FIT_MARGIN) / rangeX)),
            Math.max(0.1, Math.min(8, (H - 2 * FIT_MARGIN) / rangeY))
          );
          const cx = (bounds.minX + bounds.maxX) / 2;
          const cy = (bounds.minY + bounds.maxY) / 2;
          setView({ k, tx: W / 2 - cx * k, ty: H / 2 - cy * k });
          userPanned = false;
        });
      },
      resetView() {
        setView({ tx: 0, ty: 0, k: 1 });
        userPanned = false;
      },
      resetWalk() {
        client.repivot(props.initialPivot, true);
        setView({ tx: 0, ty: 0, k: 1 });
        userPanned = false;
      },
      back() {
        client.back();
      },
    };
    props.onReady?.(api);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !props.editMode?.()) return;
      lassoPoints = [];
      setLassoState(null);
      dragState = null;
      dragSourceId = null;
    };
    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => window.removeEventListener("keydown", onKeyDown));
  });

  // resize: keep worker sim, canvas bitmap, and canvas css dimensions in sync
  // whenever w()/h() change (driven by ResizeObserver in the parent or by
  // window resize in fullscreen mode). without the canvas updates the
  // bitmap stays at its onMount size and the rendered viz is clipped /
  // letterboxed when the host pane resizes (player bar appears, queue
  // sidebar toggles, viewport changes).
  createEffect(() => {
    const ww = w();
    const hh = h();
    const dpr = window.devicePixelRatio ?? 1;
    canvas.width = Math.max(1, Math.floor(ww * dpr));
    canvas.height = Math.max(1, Math.floor(hh * dpr));
    canvas.style.width = `${ww}px`;
    canvas.style.height = `${hh}px`;
    client.resize(ww, hh);
  });

  // ---- pointer + wheel handlers ---------------------------------------------

  function onPointerDown(e: PointerEvent) {
    canvas.setPointerCapture(e.pointerId);
    const [sx, sy] = clientToCanvas(e);
    activePointers.set(e.pointerId, { sx, sy });

    // two pointers → start pinch-zoom
    if (activePointers.size === 2) {
      const [a, b] = [...activePointers.entries()];
      const dx = a[1].sx - b[1].sx;
      const dy = a[1].sy - b[1].sy;
      const v = view();
      pinchState = {
        p1: a[0],
        p2: b[0],
        initialDist: Math.hypot(dx, dy) || 1,
        initialK: v.k,
        initialTx: v.tx,
        initialTy: v.ty,
        centerSx: (a[1].sx + b[1].sx) / 2,
        centerSy: (a[1].sy + b[1].sy) / 2,
      };
      setPanState(null);
      lassoPoints = [];
      setLassoState(null);
      return;
    }

    if (props.editMode?.()) {
      // in edit mode: sync hit-test to decide lasso-start vs node-drag-start
      const hitId = syncHitTest(sx, sy);
      lassoPoints = [{ x: sx, y: sy }];
      setLassoState({
        pointerId: e.pointerId,
        startSx: sx,
        startSy: sy,
        startedOnNode: hitId !== null,
      });
      dragSourceId = hitId;
      return;
    }

    // single pointer → potential pan or click
    const v = view();
    setPanState({
      pointerId: e.pointerId,
      startSx: sx,
      startSy: sy,
      startTx: v.tx,
      startTy: v.ty,
      moved: false,
    });

    // long-press on a group (7-sided) node → expand its subtree
    // (immediate children + each artist child's albums). swallows the
    // click that would otherwise fire on pointerup.
    const lpHit = syncHitTest(sx, sy);
    if (lpHit) {
      const lpNode = nodes.find((n) => n.id === lpHit);
      if (lpNode?.role === "group") {
        longPressPointerId = e.pointerId;
        longPressStart = { sx, sy };
        longPressFired = false;
        longPressTimer = window.setTimeout(() => {
          longPressFired = true;
          client.expandSubtree(lpHit);
          props.onExpandSubtree?.(lpHit);
          longPressTimer = null;
        }, LONG_PRESS_MS);
      }
    }
  }

  function onPointerMove(e: PointerEvent) {
    const [sx, sy] = clientToCanvas(e);
    if (activePointers.has(e.pointerId)) activePointers.set(e.pointerId, { sx, sy });

    // long-press cancel on movement past tolerance
    if (
      longPressPointerId === e.pointerId &&
      longPressStart &&
      (Math.abs(sx - longPressStart.sx) > LONG_PRESS_MOVE_TOLERANCE_PX ||
        Math.abs(sy - longPressStart.sy) > LONG_PRESS_MOVE_TOLERANCE_PX)
    ) {
      cancelLongPress();
    }

    // pinch
    if (pinchState && activePointers.size >= 2) {
      const a = activePointers.get(pinchState.p1);
      const b = activePointers.get(pinchState.p2);
      if (!a || !b) return;
      const newDist = Math.hypot(a.sx - b.sx, a.sy - b.sy) || 1;
      const scaleRatio = newDist / pinchState.initialDist;
      const newK = clamp(pinchState.initialK * scaleRatio, 0.1, 8);
      // anchor world point under the initial pinch center
      const wx = (pinchState.centerSx - pinchState.initialTx) / pinchState.initialK;
      const wy = (pinchState.centerSy - pinchState.initialTy) / pinchState.initialK;
      const cx = (a.sx + b.sx) / 2;
      const cy = (a.sy + b.sy) / 2;
      setView({ k: newK, tx: cx - wx * newK, ty: cy - wy * newK });
      return;
    }

    // lasso accumulation: edit mode drag on empty canvas
    const ls = lassoState();
    if (ls && e.pointerId === ls.pointerId) {
      if (ls.startedOnNode) {
        // drag-drop: detect threshold, then track cursor and async hit-test target
        const dx = sx - ls.startSx;
        const dy = sy - ls.startSy;
        if (Math.hypot(dx, dy) > 7) {
          if (!dragState && dragSourceId) {
            const multi = props.multiSelection?.();
            const sources = new Set<string>();
            if (multi && multi.size > 0) {
              for (const id of multi) sources.add(id);
            } else {
              sources.add(dragSourceId);
            }
            dragState = { sourceIds: sources, curSx: sx, curSy: sy, targetId: null };
          } else if (dragState) {
            dragState.curSx = sx;
            dragState.curSy = sy;
            const v = view();
            const wx = (sx - v.tx) / v.k;
            const wy = (sy - v.ty) / v.k;
            client.hitTest(wx, wy, v.k).then((id) => {
              if (dragState && id && !dragState.sourceIds.has(id)) {
                dragState.targetId = id;
              } else if (dragState) {
                dragState.targetId = null;
              }
            });
          }
        }
      } else {
        const dx = sx - ls.startSx;
        const dy = sy - ls.startSy;
        if (Math.hypot(dx, dy) > PAN_THRESHOLD) {
          lassoPoints.push({ x: sx, y: sy });
          setHoveredId(null);
        }
      }
      return;
    }

    // active drag-pan
    const ps = panState();
    if (ps && e.pointerId === ps.pointerId) {
      const dx = sx - ps.startSx;
      const dy = sy - ps.startSy;
      if (!ps.moved && Math.abs(dx) + Math.abs(dy) > PAN_THRESHOLD) {
        setPanState({ ...ps, moved: true });
        setHoveredId(null); // clear hover on pan start
        userPanned = true; // disable auto-follow until next pivot change
      }
      if (ps.moved || Math.abs(dx) + Math.abs(dy) > PAN_THRESHOLD) {
        setView((v) => ({ ...v, tx: ps.startTx + dx, ty: ps.startTy + dy }));
      }
      return;
    }

    // plain hover → world-space hit-test
    const v = view();
    const [wx, wy] = screenToWorld(sx, sy);
    client.hitTest(wx, wy, v.k).then((id) => setHoveredId(id));
  }

  function onPointerUp(e: PointerEvent) {
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    activePointers.delete(e.pointerId);
    if (pinchState && (e.pointerId === pinchState.p1 || e.pointerId === pinchState.p2)) {
      pinchState = null;
    }

    // edit mode: handle lasso completion or modifier-key click
    const ls = lassoState();
    if (ls && e.pointerId === ls.pointerId) {
      const [csx, csy] = clientToCanvas(e);
      const distMoved = Math.hypot(csx - ls.startSx, csy - ls.startSy);
      const points = [...lassoPoints];
      lassoPoints = [];
      setLassoState(null);
      // dispatch drag-drop if a drag was in progress
      if (dragState) {
        const ds = dragState;
        dragState = null;
        dragSourceId = null;
        if (ds.targetId) props.onDrop?.(ds.sourceIds, ds.targetId);
        return;
      }
      if (!ls.startedOnNode && points.length >= 3 && distMoved >= 5) {
        // lasso closed: hit-test all nodes against the polygon
        props.onMultiSelectionChange?.(computeLassoSelection(points));
      } else if (distMoved < 5) {
        // treat as click: modifier-key multi-select, no expand/pivot
        const v = view();
        const [wx, wy] = screenToWorld(ls.startSx, ls.startSy);
        const isMeta = e.metaKey || e.ctrlKey;
        const isShift = e.shiftKey;
        client.hitTest(wx, wy, v.k).then((id) => {
          if (!id) return;
          const node = nodes.find((n) => n.id === id);
          const role = node?.role;
          if (role && props.interceptClick?.(id, role)) return;
          if (isMeta) {
            // toggle in multi-selection; promote selectedId into set if set is empty
            const cur = new Set<string>(props.multiSelection?.() ?? []);
            const selId = props.selectedId ?? null;
            if (cur.size === 0 && selId) cur.add(selId);
            if (cur.has(id)) cur.delete(id);
            else cur.add(id);
            props.onMultiSelectionChange?.(cur);
          } else if (isShift) {
            // TODO(phase 5): real range-extend along walk DFS
            const cur = new Set<string>(props.multiSelection?.() ?? []);
            const selId = props.selectedId ?? null;
            if (cur.size === 0 && selId) cur.add(selId);
            cur.add(id);
            props.onMultiSelectionChange?.(cur);
          } else if (
            role === "relation" ||
            role === "value" ||
            role === "group" ||
            role === "remote"
          ) {
            // hub-like nodes: still drill in even in edit mode so the
            // taxon tree is navigable. otherwise the user can only see
            // the first-order hubs and has no way to expand them.
            props.onMultiSelectionChange?.(new Set<string>());
            props.onSelect?.(id, role);
            client.expand(id);
            props.onPivot?.(id);
          } else {
            // album/artist (or unknown): plain click → select only, no
            // pivot, so drag/drop and inspection work without losing the
            // current view.
            props.onMultiSelectionChange?.(new Set<string>());
            props.onSelect?.(id, role ?? "value");
          }
        });
      }
      return;
    }

    const ps = panState();
    if (!ps || e.pointerId !== ps.pointerId) return;
    const wasPan = ps.moved;
    const sx = ps.startSx;
    const sy = ps.startSy;
    setPanState(null);
    // long-press fired — swallow the click that would otherwise pivot/expand
    if (longPressFired) {
      cancelLongPress();
      longPressFired = false;
      return;
    }
    cancelLongPress();
    if (wasPan) return;
    // click → dispatch by role
    const v = view();
    const [wx, wy] = screenToWorld(sx, sy);
    client.hitTest(wx, wy, v.k).then((id) => {
      if (!id) return;
      const node = nodes.find((n) => n.id === id);
      const role = node?.role;
      // give host a chance to intercept (e.g. retry health for offline remote)
      if (role && props.interceptClick?.(id, role)) return;
      if (role === "album") {
        // albums are leaves — select for inspection, do not pivot
        props.onSelect?.(id, "album");
      } else if (role === "artist") {
        props.onSelect?.(id, "artist");
        client.expand(id);
        props.onPivot?.(id);
      } else if (role === "value" || role === "group") {
        // taxon nodes also expand on click, but fire select so the
        // taxon detail popover can open alongside the pivot
        props.onSelect?.(id, role);
        client.expand(id);
        props.onPivot?.(id);
      } else if (role === "relation") {
        // relation hubs open a kind-level popover alongside their pivot
        props.onSelect?.(id, role);
        client.expand(id);
        props.onPivot?.(id);
      } else if (role === "remote") {
        // remote root hubs open a remote-level popover alongside their pivot
        props.onSelect?.(id, role);
        client.expand(id);
        props.onPivot?.(id);
      } else {
        client.expand(id);
        props.onPivot?.(id);
      }
    });
  }

  function onPointerLeave() {
    setHoveredId(null);
  }

  // right-click in edit mode: find the nearest edge under the cursor
  // (within 8px in screen space) and emit onEdgeRightClick so the host
  // can prompt for removal. native browser context menu always blocked
  // over the canvas to keep the gesture available.
  function onContextMenu(e: MouseEvent) {
    e.preventDefault();
    if (!props.editMode?.()) return;
    const [sx, sy] = clientToCanvas(e);
    const v = view();
    const tol = 8;
    let bestDist = tol;
    let bestEdge: { src: string; tgt: string } | null = null;
    for (const ed of edges) {
      const a = nodes[ed.sourceIdx];
      const b = nodes[ed.targetIdx];
      if (!a || !b) continue;
      const ax = positions[ed.sourceIdx * 2] * v.k + v.tx;
      const ay = positions[ed.sourceIdx * 2 + 1] * v.k + v.ty;
      const bx = positions[ed.targetIdx * 2] * v.k + v.tx;
      const by = positions[ed.targetIdx * 2 + 1] * v.k + v.ty;
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      if (len2 === 0) continue;
      const t = Math.max(0, Math.min(1, ((sx - ax) * dx + (sy - ay) * dy) / len2));
      const cx = ax + t * dx;
      const cy = ay + t * dy;
      const d = Math.hypot(sx - cx, sy - cy);
      if (d < bestDist) {
        bestDist = d;
        bestEdge = { src: a.id, tgt: b.id };
      }
    }
    if (bestEdge) props.onEdgeRightClick?.(bestEdge.src, bestEdge.tgt);
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const [sx, sy] = clientToCanvas(e);
    const v = view();
    // mac pinch comes through as wheel + ctrlKey
    const isPinch = e.ctrlKey;
    // trackpad two-finger scroll: small deltas, deltaMode 0 → pan
    const isTrackpadPan =
      !isPinch && e.deltaMode === 0 && (Math.abs(e.deltaX) > 0 || Math.abs(e.deltaY) < 50);

    if (isTrackpadPan) {
      setView({ ...v, tx: v.tx - e.deltaX, ty: v.ty - e.deltaY });
      userPanned = true;
      return;
    }
    // zoom anchored on cursor
    const factor = Math.exp(-e.deltaY * (isPinch ? 0.012 : 0.0025));
    const newK = clamp(v.k * factor, 0.1, 8);
    const wx = (sx - v.tx) / v.k;
    const wy = (sy - v.ty) / v.k;
    setView({ k: newK, tx: sx - wx * newK, ty: sy - wy * newK });
  }

  return (
    <canvas
      ref={canvas}
      style={{
        display: "block",
        // when no explicit size given, fill the viewport
        ...(props.width == null
          ? {
              position: "fixed" as const,
              inset: "0",
              width: "100vw",
              height: "100vh",
              "margin-bottom": `${props.insets?.bottom ?? 0}px`,
              "margin-right": `${props.insets?.right ?? 0}px`,
            }
          : {
              // in-pane mode: fill the host element. the resize createEffect
              // also sets explicit pixel canvas.style.width/height to keep
              // the bitmap in sync with the laid-out box, but these defaults
              // ensure the first paint doesn't overflow the container while
              // the effect catches up.
              width: "100%",
              height: "100%",
            }),
        cursor: panState()?.moved
          ? "grabbing"
          : lassoState() && !lassoState()?.startedOnNode
            ? "crosshair"
            : hoveredId()
              ? "pointer"
              : "default",
        "touch-action": "none",
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={onPointerLeave}
      onWheel={onWheel}
      onContextMenu={onContextMenu}
    />
  );
}

// ---- helpers ----------------------------------------------------------------

function nodeDisplayRadius(n: VisibleNode): number {
  return sharedNodeDisplayRadius(n.role, n.childCount);
}
