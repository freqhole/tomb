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
  const dimmed = state === "dimmed";
  ctx.save();
  if (dimmed) ctx.globalAlpha = 0.2;

  // circle background
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = bgColor;
  ctx.fill();

  const hasImage = !!(artist.image || artist.imageUrl);
  if (hasImage) {
    const img = artist.image
      ? getImageFor(artist.image, 200, onImageReady)
      : getImage(artist.imageUrl!, onImageReady);
    if (img) {
      bump("draw.artist.img.ready");
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(img, x - r, y - r, size, size);
      ctx.restore();
    } else {
      bump("draw.artist.img.loading");
      // image is loading — fall back to acronym placeholder so the
      // node isn't a blank disc.
      drawAcronym(ctx, artist, x, y, size, textColor);
    }
  } else {
    bump("draw.artist.img.none");
    drawAcronym(ctx, artist, x, y, size, textColor);
  }

  // border (skipped when selected so the magenta ring sits flush).
  if (state !== "selected") {
    ctx.lineWidth = 0.5 / Math.max(zoom, 0.5);
    ctx.strokeStyle = borderColor;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // hover / selected ring
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
