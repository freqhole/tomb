// graph2/WalkCanvas.tsx — SolidJS canvas component.
// renders the walk graph: shapes per role, edge lines, labels, hover highlight.

import { createEffect, createSignal, onCleanup, onMount, createMemo } from "solid-js";
import type { WalkGraph, NodeRole } from "./types";
import { createWalkerClient } from "./worker/client";
import type { VisibleNode, TopologyEdge } from "./worker/messages";
import type { ImageMetadata } from "../../music/services/storage/types";
import { getNodeImage } from "./render/imageAtlas";

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
  /** fires once after onMount, with the internal WalkerClient.
   *  callers can capture this to drive incremental merge/init externally. */
  onClientReady?: (client: import("./worker/client").WalkerClient) => void;
  /** fires once after onMount, with the curated WalkApi for fit/reset/back.
   *  prefer this over onClientReady for ui-level concerns. */
  onReady?: (api: WalkApi) => void;
  /** called whenever the breadcrumb depth changes (1 = at root, 2 = one level deep, etc.).
   *  host uses this to show/hide the back button. */
  onBreadcrumbChange?: (depth: number) => void;
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
}

// ---- colors ----------------------------------------------------------------

const ROLE_COLOR: Record<string, string> = {
  root: "#4b5563",
  remote: "#ec4899",
  relation: "#0891b2",
  value: "#059669",
  artist: "#d97706",
  album: "#475569",
};

// deterministic per-kind color for value nodes. derived from a small string
// hash of the kind so any new taxon kind (genres / tags / era / mood / decade /
// whatever) gets a stable, well-separated hue without a manual table. used as
// the node stroke + as the edge color for wires touching a value node.
function hashKind(kind: string): number {
  // djb2 — small, no deps, fine spread for short strings
  let h = 5381;
  for (let i = 0; i < kind.length; i++) h = (h * 33 + kind.charCodeAt(i)) | 0;
  // multiply by a prime coprime to 360 so similar prefixes don't cluster hues
  return ((h >>> 0) * 137) % 360;
}

/** mid-lightness "active" tone — for strokes + edges (pops on black). */
function valueKindStroke(kind: string): string {
  return `hsl(${hashKind(kind)} 75% 62%)`;
}

function valueKind(id: string): string | undefined {
  // `value::KIND::val` → KIND
  const parts = id.split("::");
  return parts[0] === "value" ? parts[1] : undefined;
}

// fills stay role-neutral so labels rendered on top keep consistent contrast.
// per-kind color only shows up on the stroke + outgoing edge lines.
function nodeFillColor(n: VisibleNode): string {
  return ROLE_COLOR[n.role] ?? "#888";
}

/** color for an edge based on its endpoints — value endpoints win and tint
 *  the wire with their kind's color so "tagged with" relationships are
 *  visually grouped. returns null if neither endpoint is a value. */
function edgeKindColor(a: VisibleNode | undefined, b: VisibleNode | undefined): string | null {
  for (const n of [a, b]) {
    if (!n || n.role !== "value") continue;
    const kind = valueKind(n.id);
    if (kind) return valueKindStroke(kind);
  }
  return null;
}

const EDGE_COLOR = "#6b7280"; // visible on black
const EDGE_ALBUM = "#94a3b8"; // lighter for artist→album wires
const EDGE_BREADCRUMB = "#f59e0b";
const CROSS_REMOTE_COLOR = "#fbbf24"; // amber, slightly brighter than breadcrumb — used dashed
const GHOST_LABEL_COLOR = "rgba(241,245,249,0.55)"; // dimmed label tint for ghost artists
const PIVOT_RING_COLOR = "#ffffff";
const SELECTION_RING_COLOR = "#ff1a9e";
const BREADCRUMB_COLOR = "#fcd34d";
const LABEL_COLOR = "#f1f5f9";
const HOVER_RING_COLOR = "rgba(255,255,255,0.5)";

// loading-comet palette mirrors the conic-gradient on the player-bar
// play/pause ring: pink head → magenta mid → purple tail. used by the
// per-node loading arc so all "async in progress" signals match.
const COMET_HEAD = "#ec4899";
const COMET_MID = "#c026d3";
const COMET_TAIL = "#a855f7";

// ---- shape drawing ---------------------------------------------------------

function drawPolygon(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  sides: number,
  rotation = 0
) {
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const angle = rotation + (i / sides) * Math.PI * 2;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

// wonky triangle: slightly irregular like the freqhole logo - one vertex taller
// kept for reference but replaced by freqholeMarkPath below

/** returns the 4 freqhole-mark vertices in world coords. when `gap > 0`,
 *  each vertex is pushed outward from the shape's *centroid* (not the
 *  node center) by `gap` world pixels. uniform-offset outset — needed
 *  because the shape is asymmetric and naïve scaling around (cx, cy)
 *  gives an uneven gap on the left vs the bottom. */
function freqholeMarkVerts(
  cx: number,
  cy: number,
  r: number,
  gap: number
): { x: number; y: number }[] {
  const size = r * 2;
  const x0 = cx - r;
  const y0 = cy - r;
  // shape-local vertex fractions (0..1 over the 2r × 2r bounding box)
  const frac: ReadonlyArray<readonly [number, number]> = [
    [0.5, 0.95], // bottom center
    [0.14, 0.18], // top-left
    [0.86, 0.18], // top-right
    [0.66, 0.74], // inner-right notch
  ];
  // centroid of the 4 vertices in world coords (drives the outset direction).
  // pre-computed: ((0.5+0.14+0.86+0.66)/4, (0.95+0.18+0.18+0.74)/4) = (0.54, 0.5125)
  const ccx = x0 + 0.54 * size;
  const ccy = y0 + 0.5125 * size;
  const out: { x: number; y: number }[] = new Array(frac.length);
  for (let i = 0; i < frac.length; i++) {
    const wx = x0 + frac[i][0] * size;
    const wy = y0 + frac[i][1] * size;
    if (gap === 0) {
      out[i] = { x: wx, y: wy };
      continue;
    }
    const dx = wx - ccx;
    const dy = wy - ccy;
    const d = Math.hypot(dx, dy) || 1;
    out[i] = { x: wx + (dx / d) * gap, y: wy + (dy / d) * gap };
  }
  return out;
}

/** sets up the canvas path for a node's shape without filling or stroking.
 *  used for both the node fill and the hover/pivot ring. for most roles the
 *  ring is achieved by passing `r + gap`; the `remote` role uses a true
 *  uniform outset via freqholeMarkVerts so its asymmetric silhouette gets
 *  an even gap on every side. callers may pass `gap` (defaults to 0) when
 *  drawing a ring instead of the base shape. */
function nodeShapePath(
  ctx: CanvasRenderingContext2D,
  role: string,
  x: number,
  y: number,
  r: number,
  gap: number = 0
) {
  switch (role) {
    case "root":
      ctx.beginPath();
      ctx.arc(x, y, r + gap, 0, Math.PI * 2);
      break;
    case "remote": {
      // uniform outset via shape centroid keeps the hover/selection ring
      // equidistant from every silhouette edge.
      const verts = freqholeMarkVerts(x, y, r, gap);
      ctx.beginPath();
      ctx.moveTo(verts[0].x, verts[0].y);
      for (let i = 1; i < verts.length; i++) ctx.lineTo(verts[i].x, verts[i].y);
      ctx.closePath();
      break;
    }
    case "relation":
      drawPolygon(ctx, x, y, r + gap, 6, 0);
      break;
    case "value":
      drawPolygon(ctx, x, y, r + gap, 8, Math.PI / 8);
      break;
    case "album": {
      const half = r * 0.88 + gap;
      ctx.beginPath();
      ctx.rect(x - half, y - half, half * 2, half * 2);
      break;
    }
    case "artist":
    default:
      ctx.beginPath();
      ctx.arc(x, y, r + gap, 0, Math.PI * 2);
      break;
  }
}

/** outset polyline approximating a node's silhouette, used by drawLoadingComet
 *  to trace the comet around the actual shape (square, hex, octagon,
 *  freqhole mark) rather than always falling back to a circle. polygons use
 *  the same vertex generators as nodeShapePath; circles are discretized to
 *  64 points so the arc-length sampler stays uniform. `outset` pushes every
 *  vertex outward from the node center by that many world pixels. */
function shapePolyline(
  role: string,
  cx: number,
  cy: number,
  r: number,
  outset: number
): { x: number; y: number }[] {
  switch (role) {
    case "remote": {
      // freqhole mark — uniform outset along centroid-to-vertex direction
      // so the comet trails the silhouette evenly on every side.
      return freqholeMarkVerts(cx, cy, r, outset);
    }
    case "relation":
      return regularPolyVerts(cx, cy, r + outset, 6, 0);
    case "value":
      return regularPolyVerts(cx, cy, r + outset, 8, Math.PI / 8);
    case "album": {
      const half = r * 0.88 + outset;
      return [
        { x: cx - half, y: cy - half },
        { x: cx + half, y: cy - half },
        { x: cx + half, y: cy + half },
        { x: cx - half, y: cy + half },
      ];
    }
    case "artist":
    case "root":
    default: {
      // circle → discretize to 64 segments so the perimeter sampler can
      // walk it with the same arc-length math as polygon shapes.
      const N = 64;
      const rr = r + outset;
      const pts: { x: number; y: number }[] = new Array(N);
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2;
        pts[i] = { x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr };
      }
      return pts;
    }
  }
}

function regularPolyVerts(
  cx: number,
  cy: number,
  r: number,
  sides: number,
  rotation: number
): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = new Array(sides);
  for (let i = 0; i < sides; i++) {
    const a = rotation + (i / sides) * Math.PI * 2;
    pts[i] = { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
  }
  return pts;
}

/** rotating gradient arc — same vibe as the player-bar play/pause loading
 *  ring, but drawn into canvas so it works inside the graph viz. traces the
 *  node's actual silhouette (square / hex / octagon / freqhole mark / circle)
 *  by sampling an outset polyline at uniform arc-length steps; head leads
 *  with pink, tail fades through magenta to translucent purple. `time` is a
 *  monotonic ms value; a full revolution takes ROT_MS. */
function drawLoadingComet(
  ctx: CanvasRenderingContext2D,
  role: string,
  x: number,
  y: number,
  radius: number,
  time: number
) {
  const ROT_MS = 1500;
  const TAIL = 0.7; // tail covers ~70% of perimeter
  const SEGS = 48;

  const poly = shapePolyline(role, x, y, radius, 5);
  const n = poly.length;
  if (n < 2) return;

  // cumulative arc length around the closed loop
  const cum = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    cum[i + 1] = cum[i] + Math.hypot(b.x - a.x, b.y - a.y);
  }
  const total = cum[n];
  if (total <= 0) return;

  // sample a point on the closed polyline at arc-length fraction u ∈ ℝ
  // (wraps automatically); cheap linear search since n is small (≤ 64).
  const sample = (u: number) => {
    let d = (((u % 1) + 1) % 1) * total;
    let lo = 0;
    for (let i = 0; i < n; i++) {
      if (cum[i + 1] >= d) {
        lo = i;
        break;
      }
    }
    const segLen = cum[lo + 1] - cum[lo];
    const f = segLen > 0 ? (d - cum[lo]) / segLen : 0;
    const a = poly[lo];
    const b = poly[(lo + 1) % n];
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
  };

  const headT = (time / ROT_MS) % 1;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineWidth = 3;
  let prev = sample(headT);
  for (let i = 1; i <= SEGS; i++) {
    const t = i / SEGS; // 0 head .. 1 tail
    const u = headT - t * TAIL;
    const cur = sample(u);
    const color = t < 0.33 ? COMET_HEAD : t < 0.66 ? COMET_MID : COMET_TAIL;
    ctx.strokeStyle = color;
    ctx.globalAlpha = (1 - t) ** 1.5;
    ctx.beginPath();
    ctx.moveTo(prev.x, prev.y);
    ctx.lineTo(cur.x, cur.y);
    ctx.stroke();
    prev = cur;
  }
  ctx.restore();
}

function drawNode(
  ctx: CanvasRenderingContext2D,
  n: VisibleNode,
  x: number,
  y: number,
  radius: number,
  getImage?: (id: string) => ImageMetadata | null,
  isOffline?: boolean
) {
  // ghost artists are label-only: skip all shape/fill/stroke; drawLabel
  // handles their text styling in the label pass.
  if (n.role === "ghost_artist") return;

  // offline nodes (e.g. unreachable remote hubs): dim everything we draw
  // for this node by reducing alpha. label pass also dims separately below.
  if (isOffline) {
    ctx.save();
    ctx.globalAlpha = 0.35;
  }

  const color = nodeFillColor(n);
  ctx.fillStyle = color;
  // value nodes get a colored stroke based on their taxon kind so different
  // taxons fanning out around an artist/album are visually distinct. pivot +
  // breadcrumb states still win since they convey navigation state.
  const valueStroke =
    n.role === "value" ? (valueKind(n.id) && valueKindStroke(valueKind(n.id)!)) || null : null;
  ctx.strokeStyle = n.isPivot
    ? PIVOT_RING_COLOR
    : n.isBreadcrumb
      ? BREADCRUMB_COLOR
      : valueStroke
        ? valueStroke
        : color;
  ctx.lineWidth = n.isPivot ? 3 : n.isBreadcrumb ? 2 : valueStroke ? 2 : 1;

  nodeShapePath(ctx, n.role, x, y, radius);
  ctx.fill();

  // artwork for album and artist nodes: clip image to the node shape interior.
  // drawn after fill (image covers the placeholder color) but before stroke
  // (outline is always visible on top). the rAF loop redraws every frame so
  // onReady is a noop — image will appear on the next frame automatically.
  if (n.role === "album" && getImage) {
    const half = radius * 0.88;
    const img = getNodeImage(n.id, getImage(n.id), undefined);
    if (img) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x - half, y - half, half * 2, half * 2);
      ctx.clip();
      ctx.drawImage(img, x - half, y - half, half * 2, half * 2);
      ctx.restore();
      // re-establish path for stroke (clip block called beginPath)
      nodeShapePath(ctx, n.role, x, y, radius);
    }
  } else if (n.role === "artist" && getImage) {
    const img = getNodeImage(n.id, getImage(n.id), undefined);
    if (img) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(img, x - radius, y - radius, radius * 2, radius * 2);
      ctx.restore();
      // re-establish path for stroke (clip block called beginPath)
      nodeShapePath(ctx, n.role, x, y, radius);
    }
  }

  ctx.stroke();

  // count badge for hub nodes
  if ((n.role === "relation" || n.role === "value" || n.role === "remote") && n.childCount > 0) {
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.font = `bold ${Math.max(9, Math.round(radius * 0.42))}px system-ui,sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(n.childCount), x, y);
  }

  if (isOffline) {
    ctx.restore();
  }
}

function drawLabel(
  ctx: CanvasRenderingContext2D,
  n: VisibleNode,
  x: number,
  y: number,
  radius: number,
  cx: number,
  cy: number,
  emphasis: "none" | "hover" | "select" = "none"
) {
  const baseFontSize = n.role === "album" ? 10 : 12;
  // bump font + weight when emphasized so the active label clearly
  // pairs with its node and pops above neighbouring labels.
  const fontSize = emphasis === "none" ? baseFontSize : baseFontSize + 2;
  const weight = emphasis === "none" ? "" : "600 ";
  const italic = n.role === "ghost_artist" ? "italic " : "";
  ctx.font = `${italic}${weight}${fontSize}px system-ui,sans-serif`;

  // when emphasized, show the FULL label and marquee-bounce horizontally
  // if it overflows the visible cap. when not emphasized, truncate with
  // an ellipsis like before to avoid label sprawl.
  const MAX_LABEL_PX = 180;
  const truncated = n.label.length > 18 ? n.label.slice(0, 17) + "…" : n.label;
  const label = emphasis === "none" ? truncated : n.label;
  const fullW = ctx.measureText(label).width;
  const tw = emphasis !== "none" && fullW > MAX_LABEL_PX ? MAX_LABEL_PX : fullW;
  const isMarquee = emphasis !== "none" && fullW > MAX_LABEL_PX;

  const color =
    emphasis !== "none"
      ? "#ffffff"
      : n.isPivot
        ? "#ffffff"
        : n.isBreadcrumb
          ? BREADCRUMB_COLOR
          : n.role === "ghost_artist"
            ? GHOST_LABEL_COLOR
            : LABEL_COLOR;

  let lx: number, ly: number;

  if (n.role === "artist" || n.role === "album") {
    // radial label: offset away from canvas center so labels don't crowd
    const angle = Math.atan2(y - cy, x - cx);
    const dist = radius + 12; // clear the hover ring (gap=6) plus a small margin
    lx = x + Math.cos(angle) * dist;
    ly = y + Math.sin(angle) * dist;
    const a = Math.abs(angle);
    if (a < Math.PI / 4) {
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
    } else if (a > (Math.PI * 3) / 4) {
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
    } else if (angle < 0) {
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
    } else {
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
    }
  } else if (n.role === "ghost_artist") {
    // no shape — center label exactly on node position
    lx = x;
    ly = y;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
  } else {
    // hubs (relation/value/remote/root) — center label vertically on
    // its own baseline anchor so the pill hugs the glyphs evenly top
    // and bottom (textBaseline="top" leaves a big optical gap above).
    lx = x;
    ly = y + radius + 12 + fontSize / 2;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
  }

  // semi-transparent pill behind the label for legibility. emphasized
  // labels get a thicker, more opaque pill with an accent border so the
  // pairing with the active node is unambiguous.
  const pw = emphasis === "none" ? 4 : 6;
  const ph = emphasis === "none" ? 2 : 3;
  const pillH = fontSize + ph * 2;
  let bx: number;
  if (ctx.textAlign === "right") bx = lx - tw;
  else if (ctx.textAlign === "center") bx = lx - tw / 2;
  else bx = lx;
  let by: number;
  if (ctx.textBaseline === "bottom") by = ly - fontSize;
  else if (ctx.textBaseline === "middle") by = ly - fontSize / 2;
  else by = ly;
  const pillY = by - ph;
  ctx.fillStyle = emphasis === "none" ? "rgba(0,0,0,0.65)" : "rgba(0,0,0,0.85)";
  ctx.beginPath();
  ctx.roundRect(bx - pw, pillY, tw + pw * 2, pillH, 3);
  ctx.fill();
  if (emphasis !== "none") {
    ctx.strokeStyle = emphasis === "select" ? SELECTION_RING_COLOR : HOVER_RING_COLOR;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  ctx.fillStyle = color;

  if (isMarquee) {
    // marquee bounce: triangle-wave offset across the overflow with a
    // brief dwell at each extreme so the eye can settle. clip to the
    // pill interior so the text doesn't escape the border.
    const overflow = fullW - tw;
    const period = 4000; // ms for a full round trip
    const t = (performance.now() % period) / period;
    const tri = t < 0.5 ? t * 2 : 2 - t * 2;
    // ease: dwell ~10% at each extreme
    const eased = tri < 0.1 ? 0 : tri > 0.9 ? 1 : (tri - 0.1) / 0.8;
    const offset = overflow * eased;
    ctx.save();
    ctx.beginPath();
    ctx.rect(bx, pillY, tw, pillH);
    ctx.clip();
    // switch to left-align for predictable origin while clipped
    const prevAlign = ctx.textAlign;
    ctx.textAlign = "left";
    ctx.fillText(label, bx - offset, ly);
    ctx.textAlign = prevAlign;
    ctx.restore();
  } else {
    ctx.fillText(label, lx, ly);
  }
}

// ---- component -------------------------------------------------------------

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

  // latched when the user manually pans (drag or wheel-pan). disables the
  // proportional pivot-follow until the next pivot change clears it, so we
  // never fight the user when they're exploring far from the pivot.
  let userPanned = false;
  let lastPivotId: string | null = null;

  const client = createWalkerClient();
  onCleanup(() => {
    cancelAnimationFrame(rafId);
    client.dispose();
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
    // breadcrumb depth: count nodes with isBreadcrumb=true (ancestors) + 1 for the pivot
    const depth = nds.filter((n) => n.isBreadcrumb).length + 1;
    props.onBreadcrumbChange?.(depth);
  });
  client.onFrame((pos) => {
    positions = pos;
  });

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
        // taxon edges (anything touching a value node) inherit the value
        // kind's color so all "tagged-with" wires for a given kind share a hue.
        const kindEdge = edgeKindColor(nodes[e.sourceIdx], nodes[e.targetIdx]);
        // cross-remote synthetic links: drawn amber-dashed so federation is
        // visually obvious and distinguishable from the breadcrumb path.
        if (e.isCrossRemote) {
          ctx.setLineDash([6, 4]);
          ctx.strokeStyle = CROSS_REMOTE_COLOR;
          ctx.lineWidth = 1.5;
          ctx.globalAlpha = 0.75;
        } else {
          ctx.strokeStyle = e.isBreadcrumb
            ? EDGE_BREADCRUMB
            : kindEdge
              ? kindEdge
              : isAlbumEdge
                ? EDGE_ALBUM
                : EDGE_COLOR;
          ctx.lineWidth = e.isBreadcrumb ? 2.5 : 1;
          ctx.globalAlpha = e.isBreadcrumb ? 0.9 : kindEdge ? 0.65 : isAlbumEdge ? 0.8 : 0.7;
        }
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }

      // draw nodes (back to front: ghosts (label-only) first, then albums, artists, values, relations, remotes, root)
      const roleOrder = ["ghost_artist", "album", "artist", "value", "relation", "remote", "root"];
      const sorted = [...nodes.keys()].sort((a, b) => {
        return roleOrder.indexOf(nodes[a].role) - roleOrder.indexOf(nodes[b].role);
      });

      // pass 1: shapes + hover rings + selection ring (back to front).
      // the "lifted" node (hovered, else selected — restricted to
      // artist/album) is skipped here and re-drawn after pass 2 so it
      // sits on top of every other shape AND label.
      const liftIdx = (() => {
        const pick = (id: string | null) => {
          if (id === null) return -1;
          const i = nodes.findIndex((n) => n.id === id);
          if (i === -1) return -1;
          const r = nodes[i].role;
          return r === "artist" || r === "album" ? i : -1;
        };
        const hi = pick(hov);
        if (hi !== -1) return hi;
        return pick(selId);
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
          const selGap = n.role === "remote" ? 10 : 11;
          nodeShapePath(ctx, n.role, x, y, r, selGap);
          ctx.strokeStyle = SELECTION_RING_COLOR;
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        if (hov === n.id) {
          const gap = n.role === "remote" ? 5 : 6;
          nodeShapePath(ctx, n.role, x, y, r, gap);
          ctx.strokeStyle = HOVER_RING_COLOR;
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        drawNode(ctx, n, x, y, r, props.getImage, props.isOfflineNode?.(n.id));

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
            const selGap = n.role === "remote" ? 10 : 11;
            nodeShapePath(ctx, n.role, x, y, r, selGap);
            ctx.strokeStyle = SELECTION_RING_COLOR;
            ctx.lineWidth = 2;
            ctx.stroke();
          }
          if (hov === n.id) {
            const gap = n.role === "remote" ? 5 : 6;
            nodeShapePath(ctx, n.role, x, y, r, gap);
            ctx.strokeStyle = HOVER_RING_COLOR;
            ctx.lineWidth = 2;
            ctx.stroke();
          }
          drawNode(ctx, n, x, y, r, props.getImage, props.isOfflineNode?.(n.id));
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

    // notify caller so it can drive incremental init/merge externally.
    // fires after listeners are registered so the first topology/frame
    // events won't be missed.
    props.onClientReady?.(client);

    // curated imperative api — built after onClientReady so the client is ready.
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
  }

  function onPointerMove(e: PointerEvent) {
    const [sx, sy] = clientToCanvas(e);
    if (activePointers.has(e.pointerId)) activePointers.set(e.pointerId, { sx, sy });

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
    const ps = panState();
    if (!ps || e.pointerId !== ps.pointerId) return;
    const wasPan = ps.moved;
    const sx = ps.startSx;
    const sy = ps.startSy;
    setPanState(null);
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
      } else {
        client.expand(id);
        props.onPivot?.(id);
      }
    });
  }

  function onPointerLeave() {
    setHoveredId(null);
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
        cursor: panState()?.moved ? "grabbing" : hoveredId() ? "pointer" : "default",
        "touch-action": "none",
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={onPointerLeave}
      onWheel={onWheel}
    />
  );
}

// ---- helpers ----------------------------------------------------------------

function nodeDisplayRadius(n: VisibleNode): number {
  switch (n.role) {
    case "root":
      return 14;
    case "remote":
      return 28 + Math.min(Math.sqrt(n.childCount) * 3, 16);
    case "relation":
      return 20 + Math.min(Math.sqrt(n.childCount) * 4, 20);
    case "value":
      return 14 + Math.min(Math.sqrt(n.childCount) * 3, 16);
    case "artist":
      return 18;
    case "album":
      return 11;
    default:
      return 14;
  }
}
