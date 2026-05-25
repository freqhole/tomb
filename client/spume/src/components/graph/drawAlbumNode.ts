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
import { bump } from "./perfLog";
import { getOrRenderSprite } from "./spriteCache";
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
  /** when true, paint an animated comet-trail arc around the tile so
   *  the user sees that this node is fetching/crunching data. */
  loading?: boolean;
  /** notify caller that the comet trail is active and needs another
   *  frame to keep animating. */
  onLoading?: () => void;
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
    loading = false,
    onLoading,
  } = args;

  const half = size / 2;
  const x0 = x - half;
  const y0 = y - half;
  // on-screen tile edge in CSS pixels. drives LOD tiers below so we
  // skip rounded-corner clipping + border strokes when the tile is
  // so small that those details are sub-pixel anyway. measured: at
  // ~2700 visible nodes the per-frame node pass drops from ~30ms to
  // ~10ms when LOD kicks in on a fully zoomed-out view.
  const screenEdge = size * Math.max(zoom, 0.05);
  const lodTiny = screenEdge < 12; // just a square, no clip, no border, no ring
  const lodSmall = screenEdge < 24; // square clip (no roundRect), no border
  // corner radius shrinks as the user zooms in — fully rounded at zoom 1,
  // square by the time the user is zoomed in ~4x, so tiles tile cleanly
  // at the highest zoom levels.
  const rFactor = Math.max(0, 1 - (Math.max(zoom, 1) - 1) / 3);
  const radius = lodSmall ? 0 : Math.min(6, size * 0.1) * rFactor;

  const dimmed = state === "dimmed";
  ctx.save();
  if (dimmed) ctx.globalAlpha = 0.2;

  // tile background
  if (radius > 0) {
    roundRect(ctx, x0, y0, size, size, radius);
    ctx.fillStyle = bgColor;
    ctx.fill();
  } else {
    ctx.fillStyle = bgColor;
    ctx.fillRect(x0, y0, size, size);
  }

  const hasImage = !!(album.image || album.imageUrl);

  if (hasImage) {
    // LOD: when the on-screen tile edge is sub-12px we don't actually
    // draw the image (lodTiny path below skips drawImage anyway), so
    // don't bother kicking off a network/opfs request. for ~4000
    // album graphs zoomed all the way out, this turns the initial
    // burst of ~4000 simultaneous image loads into zero — the loads
    // happen incrementally as the user zooms into regions of the
    // graph. the visible-tier loads still benefit from the in-flight
    // concurrency cap in imageCache so we don't saturate the per-
    // origin connection limit.
    const img = lodTiny
      ? null
      : album.image
        ? getImageFor(album.image, 200, onImageReady)
        : getImage(album.imageUrl!, onImageReady);
    if (img) {
      bump("draw.album.img.ready");
      if (radius > 0) {
        ctx.save();
        roundRect(ctx, x0, y0, size, size, radius);
        ctx.clip();
        ctx.drawImage(img, x0, y0, size, size);
        ctx.restore();
      } else {
        // small/tiny tile — skip clip path entirely. drawImage straight
        // to the square. saves a beginPath+8 quadratics+clip per node.
        ctx.drawImage(img, x0, y0, size, size);
      }
    } else if (!lodTiny) {
      bump("draw.album.img.loading");
      // placeholder while loading: subtle center dot
      ctx.fillStyle = mutedColor;
      ctx.globalAlpha *= 0.4;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(2, size * 0.06), 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha /= 0.4;
    } else {
      bump("draw.album.img.loading");
    }
  } else {
    bump("draw.album.img.none");
    const hoverFallbackMarquee = showLabel && screenEdge >= 32;
    // no image — show artist + title in-tile, but only when the tile is
    // large enough on screen to be legible. below the threshold the tile
    // is just a colored placeholder; hovering / selecting reveals the
    // marquee overlay below so the info isn't lost.
    if (screenEdge >= 32 && !hoverFallbackMarquee) {
      // at very high zoom levels, sprite upscaling can make fallback text
      // look soft. switch to direct text draw so glyphs stay crisp.
      const crispTextMode = screenEdge >= 180;
      if (crispTextMode) {
        drawTextTile(ctx, album, x, y, size, textColor, mutedColor);
      } else {
      // sprite-cached: the text content for a given album never
      // changes, so render it once into an offscreen surface at a
      // bucketed size and blit on every subsequent frame. cuts the
      // text-tile path from ~3 fillText calls per node to a single
      // drawImage.
      const dpr = Math.max(
        1,
        typeof window !== "undefined" ? (window.devicePixelRatio || 1) : 1,
      );
      const screenBucket = Math.max(32, Math.round((screenEdge * dpr) / 8) * 8);
      const bucket = Math.min(384, screenBucket);
      // key on albumId + bucket + colors. title/artist are implicit
      // in albumId so we don't need them in the key (would just
      // bloat memory + slow Map ops).
      const key = `album-text|${album.id}|${bucket}|${textColor}|${mutedColor}`;
      const tile = getOrRenderSprite(key, bucket, bucket, (sctx) => {
        const worldToSprite = bucket / Math.max(size, 1);
        sctx.save();
        sctx.scale(worldToSprite, worldToSprite);
        drawTextTile(
          sctx as CanvasRenderingContext2D,
          album,
          size / 2,
          size / 2,
          size,
          textColor,
          mutedColor,
        );
        sctx.restore();
      });
      if (tile) {
        ctx.drawImage(tile, x0, y0, size, size);
      } else {
        // backing canvas failed — fall back to direct draw.
        drawTextTile(ctx, album, x, y, size, textColor, mutedColor);
      }
      }
    }
  }

  // border — thin hairline; skipped when selected so the magenta ring
  // sits flush against the tile without a competing dark outline. also
  // skipped at small/tiny LOD where a 0.5px stroke is invisible.
  if (state !== "selected" && !lodSmall) {
    ctx.lineWidth = 0.5 / Math.max(zoom, 0.5);
    ctx.strokeStyle = borderColor;
    roundRect(ctx, x0, y0, size, size, radius);
    ctx.stroke();
  }

  // hover / selected ring (drawn slightly outside the tile). always
  // drawn even at tiny LOD so picked nodes stay visible.
  if (state === "hover" || state === "selected") {
    const ringW = (state === "selected" ? 3 : 2) / Math.max(zoom, 0.5);
    ctx.lineWidth = ringW;
    ctx.strokeStyle = ringColor;
    const inset = -ringW * 0.6;
    if (radius > 0) {
      roundRect(ctx, x0 + inset, y0 + inset, size - inset * 2, size - inset * 2, radius);
      ctx.stroke();
    } else {
      ctx.strokeRect(x0 + inset, y0 + inset, size - inset * 2, size - inset * 2);
    }
  }

  // loading comet-trail — mirrors the player-bar play/pause ring.
  // stroked along the tile silhouette so the trail traces the actual
  // node shape (rounded square). 3 layered passes fake a tapered
  // comet head with magenta→purple gradient.
  if (loading) {
    onLoading?.();
    const trailW = 2.5 / Math.max(zoom, 0.5);
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = trailW;
    const perim = size * 4;
    const speed = perim / 1500;
    const offset = (time * speed) % perim;
    const passes: Array<{ dash: number; alpha: number; color: string }> = [
      { dash: perim * 0.32, alpha: 0.18, color: "#ec4899" },
      { dash: perim * 0.18, alpha: 0.5, color: "#c026d3" },
      { dash: perim * 0.08, alpha: 0.95, color: "#a855f7" },
    ];
    for (const p of passes) {
      ctx.setLineDash([p.dash, perim - p.dash]);
      ctx.lineDashOffset = -offset;
      ctx.globalAlpha = p.alpha;
      ctx.strokeStyle = p.color;
      if (radius > 0) {
        roundRect(ctx, x0, y0, size, size, radius);
        ctx.stroke();
      } else {
        ctx.strokeRect(x0, y0, size, size);
      }
    }
    ctx.restore();
  }

  // overlay label — only for image tiles when showLabel
  // (hover / selected / edge-focus).
  //
  // at low on-screen sizes the in-tile band ends up covering most of the
  // artwork with text that's still tiny + cramped, so we suppress it
  // here and let the canvas draw a screen-space label below the tile
  // instead (see GraphCanvas hover/low-zoom label pass).
  if (hasImage && showLabel && screenEdge >= 64) {
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

  // no-image hover: keep text inside the fallback tile (no bottom
  // overlay) and marquee both artist + album when they overflow.
  if (!hasImage && showLabel && screenEdge >= 32) {
    drawFallbackHoverMarquee(
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
      onMarquee,
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

  // artist subtitle (marquee if overflow)
  ctx.font = `400 ${subSize}px system-ui, sans-serif`;
  ctx.fillStyle = mutedColor;
  const sub = album.artistName;
  const subY = titleY + titleSize * 0.6 + subSize * 0.5;
  const sw = ctx.measureText(sub).width;
  if (sw <= innerW) {
    ctx.fillText(sub, innerLeft, subY);
  } else {
    onMarquee?.();
    const overflow = sw - innerW;
    const overflowScreen = overflow * zoom;
    const durationMs = Math.max(2200, 2200 + overflowScreen * 22);
    const phase = (time % durationMs) / durationMs;
    const p = marqueeProgress(phase);
    ctx.save();
    ctx.beginPath();
    ctx.rect(innerLeft, barY, innerW, barH);
    ctx.clip();
    ctx.fillText(sub, innerLeft - overflow * p, subY);
    ctx.restore();
  }

  ctx.restore();
}

function drawFallbackHoverMarquee(
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
  onMarquee?: () => void,
) {
  const titleSize = Math.max(7, size * 0.12);
  const subSize = Math.max(6, size * 0.1);
  const padX = Math.max(4, size * 0.06);
  const innerW = Math.max(8, size - padX * 2);
  const cx = x0 + size / 2;
  const titleY = y0 + size / 2 + subSize * 0.5;
  const subY = y0 + size / 2 - titleSize * 0.7;

  ctx.save();
  roundRect(ctx, x0, y0, size, size, radius);
  ctx.clip();

  // redraw subtle backdrop to improve contrast while hovering.
  ctx.fillStyle = "rgba(0,0,0,0.24)";
  ctx.fillRect(x0, y0, size, size);

  ctx.textBaseline = "middle";

  // artist line
  ctx.font = `400 ${subSize}px system-ui, sans-serif`;
  ctx.fillStyle = mutedColor;
  drawHoverMarqueeLine(ctx, album.artistName, x0 + padX, innerW, subY, time, zoom, onMarquee, cx);

  // album title line
  ctx.font = `600 ${titleSize}px system-ui, sans-serif`;
  ctx.fillStyle = textColor;
  drawHoverMarqueeLine(ctx, album.title, x0 + padX, innerW, titleY, time + 180, zoom, onMarquee, cx);

  ctx.restore();
}

function drawHoverMarqueeLine(
  ctx: CanvasRenderingContext2D,
  text: string,
  innerLeft: number,
  innerW: number,
  y: number,
  time: number,
  zoom: number,
  onMarquee: (() => void) | undefined,
  centerX: number,
) {
  const w = ctx.measureText(text).width;
  if (w <= innerW) {
    ctx.textAlign = "center";
    ctx.fillText(text, centerX, y);
    return;
  }

  onMarquee?.();
  const overflow = w - innerW;
  const overflowScreen = overflow * zoom;
  const durationMs = Math.max(2000, 2000 + overflowScreen * 20);
  const phase = (time % durationMs) / durationMs;
  const p = marqueeProgress(phase);

  ctx.save();
  ctx.textAlign = "left";
  ctx.beginPath();
  ctx.rect(innerLeft, y - 16, innerW, 32);
  ctx.clip();
  ctx.fillText(text, innerLeft - overflow * p, y);
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
