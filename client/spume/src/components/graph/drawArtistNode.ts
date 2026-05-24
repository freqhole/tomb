// pure canvas-2d draw routine for a single artist circle-avatar node.
//
// visual behavior:
// - draws a filled circle clipped to the node's bounding box
// - if the artist has an image (resolved through the same blob cache
//   the album tile uses), the image is clipped to the circle path
// - otherwise the circle is filled with a muted background and the
//   artist's 2–3 char acronym is drawn centered in bold
// - hover/selected ring matches the album tile so the two node kinds
//   share a single visual language
// - dimmed state respects the same alpha mask as albums

import { getImage, getImageFor } from "./imageCache";
import { bump } from "./perfLog";
import { getOrRenderSprite } from "./spriteCache";
import type { ArtistNodeData, NodeState } from "./types";

export interface DrawArtistNodeArgs {
  ctx: CanvasRenderingContext2D;
  artist: ArtistNodeData;
  x: number;
  y: number;
  /** diameter in world units (same scale as album tile edge length). */
  size: number;
  state: NodeState;
  zoom: number;
  ringColor?: string;
  bgColor?: string;
  textColor?: string;
  borderColor?: string;
  onImageReady?: () => void;
}

export function drawArtistNode(args: DrawArtistNodeArgs): void {
  const {
    ctx,
    artist,
    x,
    y,
    size,
    state,
    zoom,
    ringColor = "#ff1a9e",
    bgColor = "#1a1a1f",
    textColor = "#9aa0aa",
    borderColor = "#2a2a32",
    onImageReady,
  } = args;

  const r = size / 2;
  // LOD: at small on-screen size, skip clip path + border. the
  // circle-clip + stroke geometry is sub-pixel and just burns time.
  const screenEdge = size * Math.max(zoom, 0.05);
  const lodTiny = screenEdge < 12;
  const lodSmall = screenEdge < 24;
  const dimmed = state === "dimmed";
  ctx.save();
  if (dimmed) ctx.globalAlpha = 0.2;

  // circle background (or square at tiny LOD — a 6px circle reads
  // the same as a 6px square, and fillRect is much cheaper).
  if (lodTiny) {
    ctx.fillStyle = bgColor;
    ctx.fillRect(x - r, y - r, size, size);
  } else {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = bgColor;
    ctx.fill();
  }

  const hasImage = !!(artist.image || artist.imageUrl);
  if (hasImage) {
    const img = artist.image
      ? getImageFor(artist.image, 200, onImageReady)
      : getImage(artist.imageUrl!, onImageReady);
    if (img) {
      bump("draw.artist.img.ready");
      if (lodSmall) {
        // skip circle clip — just paint the image as a square. at
        // <24 screen px the difference between circle and square is
        // imperceptible, and we save a save/beginPath/arc/clip/restore
        // per node.
        ctx.drawImage(img, x - r, y - r, size, size);
      } else {
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(img, x - r, y - r, size, size);
        ctx.restore();
      }
    } else if (!lodTiny) {
      bump("draw.artist.img.loading");
      // image is loading — fall back to acronym placeholder so the
      // node isn't a blank disc. tiny-LOD skips this (text would be
      // unreadable anyway).
        drawAcronym(ctx, artist, x, y, size, textColor, zoom);
    } else {
      bump("draw.artist.img.loading");
    }
  } else {
    bump("draw.artist.img.none");
      if (!lodTiny) drawAcronym(ctx, artist, x, y, size, textColor, zoom);
  }

  // border (skipped when selected so the magenta ring sits flush, and
  // when small/tiny since the stroke is invisible).
  if (state !== "selected" && !lodSmall) {
    ctx.lineWidth = 0.5 / Math.max(zoom, 0.5);
    ctx.strokeStyle = borderColor;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // hover / selected ring — always drawn so picks remain visible.
  if (state === "hover" || state === "selected") {
    const ringW = (state === "selected" ? 3 : 2) / Math.max(zoom, 0.5);
    ctx.lineWidth = ringW;
    ctx.strokeStyle = ringColor;
    ctx.beginPath();
    ctx.arc(x, y, r + ringW * 0.6, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
}

function drawAcronym(
  ctx: CanvasRenderingContext2D,
  artist: ArtistNodeData,
  cx: number,
  cy: number,
  size: number,
  textColor: string,
  zoom?: number,
) {
  const screenEdge = size * Math.max(zoom ?? 1, 0.05);
  // high zoom: draw text directly to keep glyph edges crisp.
  if (screenEdge >= 160) {
    drawAcronymDirect(ctx, artist, cx, cy, size, textColor);
    return;
  }
  // sprite-cache the acronym: glyph content for a given artist +
  // size bucket is invariant frame-to-frame, so render once and
  // blit. fall back to direct fillText if the sprite surface
  // couldn't be created.
  const dpr = Math.max(
    1,
    typeof window !== "undefined" ? (window.devicePixelRatio || 1) : 1,
  );
  const screenBucket = Math.max(16, Math.round((screenEdge * dpr) / 8) * 8);
  const bucket = Math.min(320, screenBucket);
  const label =
    artist.abbreviation || (artist.name ?? "").slice(0, 2).toUpperCase();
  const key = `artist-acronym|${label}|${bucket}|${textColor}`;
  const sprite = getOrRenderSprite(key, bucket, bucket, (sctx) => {
    const worldToSprite = bucket / Math.max(size, 1);
    sctx.save();
    sctx.scale(worldToSprite, worldToSprite);
    drawAcronymDirect(
      sctx as CanvasRenderingContext2D,
      artist,
      size / 2,
      size / 2,
      size,
      textColor,
    );
    sctx.restore();
  });
  if (sprite) {
    ctx.drawImage(sprite, cx - size / 2, cy - size / 2, size, size);
  } else {
    drawAcronymDirect(ctx, artist, cx, cy, size, textColor);
  }
}

function drawAcronymDirect(
  ctx: CanvasRenderingContext2D,
  artist: ArtistNodeData,
  cx: number,
  cy: number,
  size: number,
  textColor: string
) {
  const text = artist.abbreviation || (artist.name ?? "").slice(0, 2).toUpperCase();
  // size the text to fit comfortably inside the circle. shorter labels
  // (1–2 chars) get a bigger glyph; 3-char acronyms shrink slightly so
  // they don't bleed past the curve.
  const charCount = Math.max(1, text.length);
  const baseFraction = charCount <= 2 ? 0.42 : 0.34;
  const fontSize = Math.max(8, size * baseFraction);
  ctx.fillStyle = textColor;
  ctx.font = `700 ${fontSize}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // tiny vertical adjustment — system-ui baseline metrics often skew
  // the visual center down a hair; lift the text by 2% of the node
  // size so the glyph optically centers in the disc.
  ctx.fillText(text, cx, cy - size * 0.02);
}
