// text / label rendering shared across roles.
//
// three in-node text variants:
// - `drawAcronymDirect`: render the 1-3 char acronym directly with
//   fillText. used at high zoom for crisp glyphs.
// - `drawAcronym`: sprite-cache the acronym for low / medium zoom so
//   the per-frame text cost stays flat. falls through to
//   `drawAcronymDirect` if the sprite cache can't allocate a surface.
// - `drawHubAcronymWithCount`: acronym + album-count line, used by
//   relation / value hubs when the full name doesn't fit inside the
//   silhouette.
//
// plus the hover-only label chip rendered below the node's
// silhouette (`drawHoverLabelChip`). chip auto-fits short labels and
// marquee-scrolls long ones.

import { getOrRenderSprite } from "../../spriteCache";
import type { ArtistNodeData } from "../../types";
import { roundedRectPath } from "./shapes";

export function drawAcronymDirect(
  ctx: CanvasRenderingContext2D,
  artist: ArtistNodeData,
  cx: number,
  cy: number,
  size: number,
  textColor: string,
): void {
  const text =
    artist.abbreviation || (artist.name ?? "").slice(0, 2).toUpperCase();
  // size the text to fit comfortably inside the circle. shorter labels
  // (1-2 chars) get a bigger glyph; 3-char acronyms shrink slightly so
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

export function drawAcronym(
  ctx: CanvasRenderingContext2D,
  artist: ArtistNodeData,
  cx: number,
  cy: number,
  size: number,
  textColor: string,
  zoom?: number,
): void {
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
    typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1,
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

// fallback used by relation / value hub draw when the full name +
// count don't fit inside the hub silhouette: render the acronym
// (smaller than the regular acronym so we can fit a count beneath)
// plus the count, vertically stacked. when the count is empty / "0"
// we fall through to the plain acronym to keep remote hubs (which
// don't carry counts) looking the same as before.
export function drawHubAcronymWithCount(
  ctx: CanvasRenderingContext2D,
  artist: ArtistNodeData,
  cx: number,
  cy: number,
  size: number,
  textColor: string,
  countText: string,
): void {
  if (!countText || countText === "0") {
    drawAcronymDirect(ctx, artist, cx, cy, size, textColor);
    return;
  }
  const text =
    artist.abbreviation || (artist.name ?? "").slice(0, 2).toUpperCase();
  const charCount = Math.max(1, text.length);
  // shrink the acronym vs the no-count fallback to make headroom for
  // the count glyphs beneath.
  const baseFraction = charCount <= 2 ? 0.32 : 0.26;
  const acronymSize = Math.max(8, size * baseFraction);
  const countSize = Math.max(7, size * 0.18);
  // vertical layout: keep a visible gap between the label and the
  // count line so the two read as distinct labels rather than a
  // single squashed glyph cluster. offsets are measured from the
  // node center and scale with `size` so the gap grows with the
  // silhouette.
  const labelOffset = acronymSize * 0.55 + size * 0.06;
  const countOffset = acronymSize * 0.2 + countSize * 0.55 + size * 0.06;
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = textColor;
  ctx.font = `700 ${acronymSize}px system-ui, sans-serif`;
  ctx.fillText(text, cx, cy - labelOffset);
  ctx.fillStyle = "#ffd2f4";
  ctx.font = `600 ${countSize}px system-ui, sans-serif`;
  ctx.fillText(countText, cx, cy + countOffset);
  ctx.restore();
}

export interface HoverLabelChipArgs {
  ctx: CanvasRenderingContext2D;
  artist: ArtistNodeData;
  /** node center. */
  x: number;
  y: number;
  /** node size in world units (used for chip width / padding scaling). */
  size: number;
  /** max chip width as a multiple of `size`. wider for remote roots
   *  whose names tend to be longer. */
  maxChipWidthMul: number;
  /** rAF timestamp in ms (for marquee animation). */
  time: number;
  /** notify the caller that marquee is active and needs another frame. */
  onMarquee?: () => void;
}

/** hover-only chip below a hub node's silhouette. auto-fits short
 *  labels (chip width tracks text), marquee-scrolls long ones inside
 *  a max-width pill so very long names don't balloon across the
 *  canvas. */
export function drawHoverLabelChip(args: HoverLabelChipArgs): void {
  const { ctx, artist, x, y, size, maxChipWidthMul, time, onMarquee } = args;
  const label = artist.name ?? artist.abbreviation ?? "";
  if (!label) return;
  const r = size / 2;
  const fontSize = Math.max(8, size * 0.2);
  ctx.font = `600 ${fontSize}px system-ui, sans-serif`;
  const textW = ctx.measureText(label).width;
  const pad = Math.max(4, size * 0.08);
  const maxChipW = size * maxChipWidthMul;
  const fitsWithoutScroll = textW + pad * 2 <= maxChipW;
  const chipW = fitsWithoutScroll
    ? Math.max(size * 0.6, textW + pad * 2)
    : maxChipW;
  const h = Math.max(12, size * 0.32);
  const lx = x - chipW / 2;
  const ly = y + r + h * 0.2;
  ctx.fillStyle = "rgba(18,18,24,0.86)";
  roundedRectPath(ctx, lx, ly, chipW, h, Math.min(5, h * 0.35));
  ctx.fill();

  ctx.fillStyle = "#e6e6e6";
  ctx.textBaseline = "middle";

  const clipX = lx + pad;
  const clipY = ly + 1;
  const clipW = chipW - pad * 2;
  const clipH = h - 2;

  ctx.save();
  ctx.beginPath();
  ctx.rect(clipX, clipY, clipW, clipH);
  ctx.clip();
  if (textW <= clipW) {
    ctx.textAlign = "center";
    ctx.fillText(label, lx + chipW / 2, ly + h / 2);
  } else {
    ctx.textAlign = "left";
    const gap = Math.max(20, fontSize * 1.7);
    const cycle = textW + gap;
    const speed = 0.028;
    const shift = (time * speed) % cycle;
    const tx = clipX - shift;
    ctx.fillText(label, tx, ly + h / 2);
    ctx.fillText(label, tx + cycle, ly + h / 2);
    onMarquee?.();
  }
  ctx.restore();
}
