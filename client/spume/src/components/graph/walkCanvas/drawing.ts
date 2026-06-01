import type { VisibleNode } from "../worker/messages";
import type { ImageMetadata } from "../../../music/services/storage/types";
import { getNodeImage } from "../render/imageAtlas";
import {
  COMET_HEAD,
  COMET_MID,
  COMET_TAIL,
  PIVOT_RING_COLOR,
  BREADCRUMB_COLOR,
  SELECTION_RING_COLOR,
  HOVER_RING_COLOR,
  GHOST_LABEL_COLOR,
  LABEL_COLOR,
  remoteAccentColor,
  remoteGradientFill,
  valueKindStroke,
  readableTextColor,
} from "./colors";
import { valueKind } from "./idUtils";
import { nodeFillColor } from "./nodeStyle";
import { nodeShapePath, shapePolyline } from "./shapes";

/** rotating gradient arc — same vibe as the player-bar play/pause loading
 *  ring, but drawn into canvas so it works inside the graph viz. traces the
 *  node's actual silhouette (square / hex / octagon / freqhole mark / circle)
 *  by sampling an outset polyline at uniform arc-length steps; head leads
 *  with pink, tail fades through magenta to translucent purple. `time` is a
 *  monotonic ms value; a full revolution takes ROT_MS. */
export function drawLoadingComet(
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

export function drawNode(
  ctx: CanvasRenderingContext2D,
  n: VisibleNode,
  x: number,
  y: number,
  radius: number,
  getImage?: (id: string) => ImageMetadata | null,
  isOffline?: boolean,
  isHovered?: boolean
) {
  // ghost artists are label-only: skip all shape/fill/stroke; drawLabel
  // handles their text styling in the label pass.
  if (n.role === "ghost_artist") return;

  // offline remote hubs: draw an opaque black backdrop disk so the dimmed
  // rounded-square shape doesn't bleed through the connecting edge behind it.
  if (isOffline && n.role === "remote") {
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#000000";
    nodeShapePath(ctx, n.role, x, y, radius);
    ctx.fill();
    ctx.restore();
  }

  // offline nodes (e.g. unreachable remote hubs): dim everything we draw
  // for this node by reducing alpha. label pass also dims separately below.
  if (isOffline) {
    ctx.save();
    ctx.globalAlpha = 0.35;
  }

  // newly-created taxons (no children, no albums yet) render dimmed
  // until they gain at least one link, so authors can tell at a glance
  // which nodes are placeholders waiting for content.
  const isPlaceholderTaxon =
    !isOffline && (n.role === "value" || n.role === "group") && n.childCount === 0;
  if (isPlaceholderTaxon) {
    ctx.save();
    ctx.globalAlpha = 0.55;
  }

  const color = nodeFillColor(n);
  // remote hubs replace their flat fill with a deterministic 3-color
  // gradient (magenta -> purple -> orange) when no avatar image is
  // resolved. the gradient direction + hue offset are seeded from the
  // remote id hash so every remote stays visually distinct.
  if (n.role === "remote") {
    ctx.fillStyle = remoteGradientFill(ctx, x, y, radius, n.id);
  } else {
    ctx.fillStyle = color;
  }
  // value and group nodes get a colored stroke based on their taxon kind so
  // different taxons fanning out around an artist/album are visually distinct.
  // pivot + breadcrumb states still win since they convey navigation state.
  const valueStroke =
    n.role === "value" || n.role === "group"
      ? (valueKind(n.id) && valueKindStroke(valueKind(n.id)!)) || null
      : null;
  ctx.strokeStyle =
    n.role === "root" || n.role === "remote"
      ? color // root/remote: stroke matches the magenta-ish fill (override pivot ring)
      : n.isPivot
        ? PIVOT_RING_COLOR
        : n.isBreadcrumb
          ? BREADCRUMB_COLOR
          : valueStroke
            ? valueStroke
            : color;
  ctx.lineWidth =
    n.role === "root" || n.role === "remote"
      ? 1
      : n.isPivot
        ? 3
        : n.isBreadcrumb
          ? 2
          : valueStroke
            ? n.role === "group"
              ? 3 // group (parent-of-parent) taxons get a thicker stroke
              : 2
            : 1;

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
  } else if (n.role === "remote" && getImage) {
    const img = getNodeImage(n.id, getImage(n.id), undefined);
    if (img) {
      const cornerR = Math.max(2, radius * 0.22);
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(x - radius, y - radius, radius * 2, radius * 2, cornerR);
      ctx.clip();
      ctx.drawImage(img, x - radius, y - radius, radius * 2, radius * 2);
      ctx.restore();
      // re-establish path for stroke (clip block called beginPath)
      nodeShapePath(ctx, n.role, x, y, radius);
    }
  }

  ctx.stroke();

  // strategy A — cross-remote cluster indicator. when this node is
  // the visual representative for an artist/album that exists in
  // multiple remotes, draw a dashed overlay stroke around the node
  // silhouette using the first contributing remote's accent color.
  // skipped for non-clusters or singletons.
  if (
    n.contributorRemotes &&
    n.contributorRemotes.length > 1 &&
    (n.role === "artist" || n.role === "album")
  ) {
    ctx.save();
    ctx.lineWidth = Math.max(2, radius * 0.12);
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = remoteAccentColor(n.contributorRemotes[0]);
    nodeShapePath(ctx, n.role, x, y, radius);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  if (
    (n.role === "relation" || n.role === "value" || (n.role === "remote" && isHovered)) &&
    n.childCount > 0
  ) {
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.font = `bold ${Math.max(9, Math.round(radius * 0.42))}px system-ui,sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(n.childCount), x, y);
    // draw text overlay with contrast-aware color
    ctx.fillStyle = readableTextColor(nodeFillColor(n));
    ctx.fillText(String(n.childCount), x, y);
  }

  if (isOffline) {
    ctx.restore();
  }
  if (isPlaceholderTaxon) {
    ctx.restore();
  }
}

export function drawLabel(
  ctx: CanvasRenderingContext2D,
  n: VisibleNode,
  x: number,
  y: number,
  radius: number,
  cx: number,
  cy: number,
  emphasis: "none" | "hover" | "select" = "none"
) {
  if (n.role === "root") return;
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
    emphasis === "select"
      ? SELECTION_RING_COLOR
      : emphasis === "hover"
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

  // home-icon glyph for charnel-managed remote hubs. drawn just to the
  // right of the label pill, vertically centered on the text baseline,
  // so the local-sidecar remote is visually distinguishable from
  // federated remotes (mirrors the home-icon shown in the top-nav
  // remote source list).
  if (n.role === "remote" && n.isCharnelManaged) {
    drawHomeGlyph(ctx, bx + tw + pw + 4, ly, fontSize, color);
  }
}

// 24x24 material-style "home" path (matches HomeIcon in
// components/icons/navigation.tsx). drawn scaled around (cx,cy) at
// the requested pixel size. fill only \u2014 no stroke.
export const HOME_PATH_2D = new Path2D("M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z");
export function drawHomeGlyph(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  color: string
) {
  const s = size / 24;
  ctx.save();
  ctx.translate(cx, cy - size / 2);
  ctx.scale(s, s);
  ctx.fillStyle = color;
  ctx.fill(HOME_PATH_2D);
  ctx.restore();
}
