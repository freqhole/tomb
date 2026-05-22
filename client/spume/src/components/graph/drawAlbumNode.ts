// pure canvas-2d draw routine for a single album node.
//
// visual behavior:
// - draws a square thumbnail tile (rounded corners) with the album image
// - if no image, fills the tile with a text-only fallback (artist + title),
//   so unlabeled albums are always identifiable
// - hover/selected ring around the tile
// - when showLabel is true (i.e. hover/selected/edge-focus), draws a
//   translucent label bar across the BOTTOM of the tile with the title and
//   artist; if the title overflows the tile width it marquee-scrolls
// - all sizes are in world units, so labels naturally scale with zoom

import { getImage, getImageFor } from "./imageCache";
import type { AlbumNodeData, NodeState } from "./types";

export interface DrawAlbumNodeArgs {
  ctx: CanvasRenderingContext2D;
  album: AlbumNodeData;
  /** world-space center x */
  x: number;
  /** world-space center y */
  y: number;
  /** edge length of the square tile in world-space units */
  size: number;
  state: NodeState;
  /** current zoom scale (used to keep ring widths consistent) */
  zoom: number;
  /** show the title/artist label overlay (only on hover/selected/focused) */
  showLabel?: boolean;
  /** rAF timestamp (ms); used to drive marquee animation */
  time?: number;
  /** css color for the hover/selected ring */
  ringColor?: string;
  /** css color for the tile bg fallback */
  bgColor?: string;
  /** css color for fallback text */
  textColor?: string;
  /** css color for fallback subtitle */
  mutedColor?: string;
  /** css color for tile border */
  borderColor?: string;
  /** called when an image finishes loading so caller can request a redraw */
  onImageReady?: () => void;
  /** called when this node is marquee-scrolling and needs continuous redraw */
  onMarquee?: () => void;
}

export function drawAlbumNode(args: DrawAlbumNodeArgs): void {
  const {
    ctx,
    album,
    x,
    y,
    size,
    state,
    zoom,
    showLabel = false,
    time = 0,
    ringColor = "#ff1a9e",
    bgColor = "#1a1a1f",
    textColor = "#e6e6e6",
    mutedColor = "#9aa0aa",
    borderColor = "#2a2a32",
    onImageReady,
    onMarquee,
  } = args;

  const half = size / 2;
  const x0 = x - half;
  const y0 = y - half;
  // corner radius shrinks as the user zooms in — fully rounded at zoom 1,
  // square by the time the user is zoomed in ~4x, so tiles tile cleanly
  // at the highest zoom levels.
  const rFactor = Math.max(0, 1 - (Math.max(zoom, 1) - 1) / 3);
  const radius = Math.min(6, size * 0.1) * rFactor;

  const dimmed = state === "dimmed";
  ctx.save();
  if (dimmed) ctx.globalAlpha = 0.2;

  // tile background
  roundRect(ctx, x0, y0, size, size, radius);
  ctx.fillStyle = bgColor;
  ctx.fill();

  const hasImage = !!(album.image || album.imageUrl);

  if (hasImage) {
    // prefer the canonical resolver (handles local opfs / p2p / charnel
    // / plain http with the same primitives MediaImage uses). fall back
    // to the legacy raw url if no metadata was attached (storybook /
    // mocks).
    const img = album.image
      ? getImageFor(album.image, 200, onImageReady)
      : getImage(album.imageUrl!, onImageReady);
    if (img) {
      ctx.save();
      roundRect(ctx, x0, y0, size, size, radius);
      ctx.clip();
      ctx.drawImage(img, x0, y0, size, size);
      ctx.restore();
    } else {
      // placeholder while loading: subtle center dot
      ctx.fillStyle = mutedColor;
      ctx.globalAlpha *= 0.4;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(2, size * 0.06), 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha /= 0.4;
    }
  } else {
    // no image — show artist + title in-tile, but only when the tile is
    // large enough on screen to be legible. below the threshold the tile
    // is just a colored placeholder; hovering / selecting reveals the
    // marquee overlay below so the info isn't lost.
    const screenSize = size * Math.max(zoom, 0.05);
    if (screenSize >= 32) {
      drawTextTile(ctx, album, x, y, size, textColor, mutedColor);
    }
  }

  // border — thin hairline; skipped when selected so the magenta ring
  // sits flush against the tile without a competing dark outline.
  if (state !== "selected") {
    ctx.lineWidth = 0.5 / Math.max(zoom, 0.5);
    ctx.strokeStyle = borderColor;
    roundRect(ctx, x0, y0, size, size, radius);
    ctx.stroke();
  }

  // hover / selected ring (drawn slightly outside the tile)
  if (state === "hover" || state === "selected") {
    const ringW = (state === "selected" ? 3 : 2) / Math.max(zoom, 0.5);
    ctx.lineWidth = ringW;
    ctx.strokeStyle = ringColor;
    const inset = -ringW * 0.6;
    roundRect(ctx, x0 + inset, y0 + inset, size - inset * 2, size - inset * 2, radius);
    ctx.stroke();
  }

  // overlay label — only when showLabel (hover / selected / edge-focus).
  // shown for both image and text-only tiles so zoomed-out text-only tiles
  // still get a readable marquee on hover.
  //
  // at low on-screen sizes the in-tile band ends up covering most of the
  // artwork with text that's still tiny + cramped, so we suppress it
  // here and let the canvas draw a screen-space label below the tile
  // instead (see AlbumGraphCanvas hover/low-zoom label pass).
  const overlayScreenSize = size * Math.max(zoom, 0.05);
  if (showLabel && overlayScreenSize >= 64) {
    drawLabelOverlay(
      ctx,
      album,
      x0,
      y0,
      size,
      radius,
      time,
      zoom,
      textColor,
      mutedColor,
      onMarquee
    );
  }

  ctx.restore();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawTextTile(
  ctx: CanvasRenderingContext2D,
  album: AlbumNodeData,
  cx: number,
  cy: number,
  size: number,
  textColor: string,
  mutedColor: string
) {
  const titleSize = Math.max(7, size * 0.12);
  const subSize = Math.max(6, size * 0.1);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  ctx.fillStyle = mutedColor;
  ctx.font = `400 ${subSize}px system-ui, sans-serif`;
  const sub = clip(ctx, album.artistName, size - 8);
  ctx.fillText(sub, cx, cy - titleSize * 0.7);

  ctx.fillStyle = textColor;
  ctx.font = `600 ${titleSize}px system-ui, sans-serif`;
  const title = clip(ctx, album.title, size - 8);
  ctx.fillText(title, cx, cy + subSize * 0.5);
}

function drawLabelOverlay(
  ctx: CanvasRenderingContext2D,
  album: AlbumNodeData,
  x0: number,
  y0: number,
  size: number,
  radius: number,
  time: number,
  zoom: number,
  textColor: string,
  mutedColor: string,
  onMarquee?: () => void
) {
  // target a screen-pixel font size that grows gently with zoom, then
  // convert back to world units so it appears stable on screen.
  // higher zoom -> smaller world font -> more chars fit in the tile width.
  const z = Math.max(zoom, 0.25);
  const titleScreen = Math.min(22, Math.max(11, 11 * Math.sqrt(z)));
  const subScreen = Math.min(18, Math.max(9, 9 * Math.sqrt(z)));
  const titleSize = titleScreen / z;
  const subSize = subScreen / z;
  const padX = size * 0.06;
  const padY = Math.min(size * 0.06, 6 / z);
  const barH = titleSize + subSize + padY * 2 + 2 / z;
  const barY = y0 + size - barH;

  // clip to the tile so overlay stays within rounded corners
  ctx.save();
  roundRect(ctx, x0, y0, size, size, radius);
  ctx.clip();

  // translucent dark backdrop
  ctx.fillStyle = "rgba(0,0,0,0.72)";
  ctx.fillRect(x0, barY, size, barH);

  const innerLeft = x0 + padX;
  const innerW = size - padX * 2;

  // title (marquee if overflow)
  ctx.font = `600 ${titleSize}px system-ui, sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = textColor;
  const title = album.title;
  const tw = ctx.measureText(title).width;
  const titleY = barY + padY + titleSize / 2;

  if (tw <= innerW) {
    ctx.fillText(title, innerLeft, titleY);
  } else {
    // bouncing marquee — mimics components/text/MarqueeText.tsx: dwell
    // briefly at each end, ease-in-out between. duration scales with the
    // on-screen overflow distance (so feel is similar at every zoom).
    onMarquee?.();
    const overflow = tw - innerW;
    const overflowScreen = overflow * zoom;
    const durationMs = Math.max(2000, 2000 + overflowScreen * 20);
    const phase = (time % durationMs) / durationMs;
    const p = marqueeProgress(phase);
    // sub-clip to the inner band so the text doesn't bleed under padding
    ctx.save();
    ctx.beginPath();
    ctx.rect(innerLeft, barY, innerW, barH);
    ctx.clip();
    ctx.fillText(title, innerLeft - overflow * p, titleY);
    ctx.restore();
  }

  // artist subtitle (clipped with ellipsis — no marquee)
  ctx.font = `400 ${subSize}px system-ui, sans-serif`;
  ctx.fillStyle = mutedColor;
  const sub = clip(ctx, album.artistName, innerW);
  ctx.fillText(sub, innerLeft, titleY + titleSize * 0.6 + subSize * 0.5);

  ctx.restore();
}

function clip(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  const ell = "…";
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(text.slice(0, mid) + ell).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo) + ell;
}

// bouncing marquee progress, modeled on MarqueeText.tsx keyframes:
//   0–5%   hold at 0
//   5–45%  ease-in-out to 1
//  45–55%  hold at 1
//  55–95%  ease-in-out back to 0
//  95–100% hold at 0
function marqueeProgress(phase: number): number {
  const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  if (phase < 0.05) return 0;
  if (phase < 0.45) return ease((phase - 0.05) / 0.4);
  if (phase < 0.55) return 1;
  if (phase < 0.95) return 1 - ease((phase - 0.55) / 0.4);
  return 0;
}
