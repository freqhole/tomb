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
  /** show hover label chip for hub nodes. */
  showLabel?: boolean;
  ringColor?: string;
  bgColor?: string;
  textColor?: string;
  borderColor?: string;
  onImageReady?: () => void;
  /** timestamp in ms for marquee animation. */
  time?: number;
  /** notify caller that marquee is active and needs another frame. */
  onMarquee?: () => void;
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
    showLabel = false,
    ringColor = "#ff1a9e",
    bgColor = "#1a1a1f",
    textColor = "#9aa0aa",
    borderColor = "#2a2a32",
    onImageReady,
    time = 0,
    onMarquee,
  } = args;

  const r = size / 2;
  const isRelationHub = artist.artistId?.startsWith("hub_relation::") ?? false;
  const isRemoteHub = artist.artistId?.startsWith("hub_remote::") ?? false;
  const isRelationValueHub = artist.artistId?.startsWith("hub_relation_value::") ?? false;
  const isHub = isRelationHub || isRemoteHub;
  const isHoverLabelHub = isRelationHub || isRemoteHub || isRelationValueHub;
  // LOD: at small on-screen size, skip clip path + border. the
  // circle-clip + stroke geometry is sub-pixel and just burns time.
  const screenEdge = size * Math.max(zoom, 0.05);
  const lodTiny = screenEdge < 12;
  const lodSmall = screenEdge < 24;
  const dimmed = state === "dimmed";
  ctx.save();
  if (dimmed) ctx.globalAlpha = 0.2;

  // base glyph shape:
  // - remotes: freqhole mark (wonky 4-sided)
  // - relations: hexagon
  // - relation values: octagon
  // - default: circle
  const drawHubShapePath = () => {
    if (isRemoteHub) {
      const s = size;
      const x0 = x - s / 2;
      const y0 = y - s / 2;
      ctx.beginPath();
      ctx.moveTo(x0 + 0.5 * s, y0 + 0.95 * s);
      ctx.lineTo(x0 + 0.14 * s, y0 + 0.18 * s);
      ctx.lineTo(x0 + 0.86 * s, y0 + 0.18 * s);
      ctx.lineTo(x0 + 0.66 * s, y0 + 0.74 * s);
      ctx.closePath();
      return;
    }
    if (isRelationHub) {
      const rr = r;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (-Math.PI / 2) + (i * Math.PI) / 3;
        const px = x + Math.cos(a) * rr;
        const py = y + Math.sin(a) * rr;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      return;
    }
    if (isRelationValueHub) {
      const rr = r;
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (-Math.PI / 2) + (i * Math.PI) / 4;
        const px = x + Math.cos(a) * rr;
        const py = y + Math.sin(a) * rr;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      return;
    }
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
  };

  if (lodTiny) {
    ctx.fillStyle = isRemoteHub ? "#3a0f34" : isRelationHub ? "#12263d" : bgColor;
    ctx.fillRect(x - r, y - r, size, size);
  } else {
    drawHubShapePath();
    ctx.fillStyle = isRemoteHub ? "#381932" : isRelationHub ? "#12263d" : bgColor;
    ctx.fill();
  }

  const hasImage = !!(artist.image || artist.imageUrl);
  if (hasImage && !isHub) {
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
    if (!lodTiny) {
      if (isHub) {
        drawHubText(ctx, artist, x, y, size, textColor, zoom);
      } else {
        drawAcronym(ctx, artist, x, y, size, textColor, zoom);
      }
    }
  }

  // border (skipped when selected so the magenta ring sits flush, and
  // when small/tiny since the stroke is invisible).
  if (state !== "selected" && !lodSmall) {
    ctx.lineWidth = 0.5 / Math.max(zoom, 0.5);
    ctx.strokeStyle = isRemoteHub ? "#7b2d70" : isRelationHub ? "#335d8a" : borderColor;
    drawHubShapePath();
    ctx.stroke();
  }

  // hover / selected ring — always drawn so picks remain visible.
  if (state === "hover" || state === "selected") {
    const ringW = (state === "selected" ? 3 : 2) / Math.max(zoom, 0.5);
    ctx.lineWidth = ringW;
    ctx.strokeStyle = ringColor;
    if (isHub) {
      ctx.beginPath();
      ctx.arc(x, y, r + ringW * 0.6, 0, Math.PI * 2);
    } else {
      drawHubShapePath();
    }
    ctx.stroke();
  }

  // hub labels are hover-only.
  if (isHoverLabelHub && showLabel) {
    const label = artist.name ?? artist.abbreviation ?? "";
    if (label) {
      const maxW = size * (isRemoteHub ? 2.8 : 2.4);
      const h = Math.max(12, size * 0.32);
      const lx = x - maxW / 2;
      const ly = y + r + h * 0.2;
      const pad = Math.max(4, size * 0.08);
      ctx.fillStyle = "rgba(18,18,24,0.86)";
      roundedRectPath(ctx, lx, ly, maxW, h, Math.min(5, h * 0.35));
      ctx.fill();

      const fontSize = Math.max(8, size * 0.2);
      ctx.fillStyle = "#e6e6e6";
      ctx.font = `600 ${fontSize}px system-ui, sans-serif`;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";

      const clipX = lx + pad;
      const clipY = ly + 1;
      const clipW = maxW - pad * 2;
      const clipH = h - 2;
      const textW = ctx.measureText(label).width;

      ctx.save();
      ctx.beginPath();
      ctx.rect(clipX, clipY, clipW, clipH);
      ctx.clip();
      if (textW <= clipW) {
        ctx.fillText(label, clipX, ly + h / 2);
      } else {
        const gap = Math.max(20, fontSize * 1.7);
        const cycle = textW + gap;
        const speed = 0.028;
        const shift = ((time * speed) % cycle);
        const tx = clipX - shift;
        ctx.fillText(label, tx, ly + h / 2);
        ctx.fillText(label, tx + cycle, ly + h / 2);
        onMarquee?.();
      }
      ctx.restore();
    }
  }

  ctx.restore();
}

function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
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

function drawHubText(
  ctx: CanvasRenderingContext2D,
  artist: ArtistNodeData,
  cx: number,
  cy: number,
  size: number,
  textColor: string,
  zoom?: number
) {
  const screenEdge = size * Math.max(zoom ?? 1, 0.05);
  const isRelationHub = artist.artistId?.startsWith("hub_relation::") ?? false;
  const full = artist.name ?? "";
  const short = artist.abbreviation || full.slice(0, 3).toUpperCase();
  const countText = String(Math.max(0, Math.round(artist.albumCount ?? 0)));
  // low zoom: shorthand in-node (full label still available on hover).
  if (!full || screenEdge < 44) {
    drawAcronymDirect(
      ctx,
      { ...artist, abbreviation: short, name: short },
      cx,
      cy,
      size,
      textColor
    );
    return;
  }

  const maxW = size * 0.82;
  const maxH = size * 0.46;

  if (isRelationHub) {
    let nameSize = Math.max(7, size * 0.17);
    let countSize = Math.max(7, size * 0.15);
    const fits = () => {
      ctx.font = `700 ${nameSize}px system-ui, sans-serif`;
      const w1 = ctx.measureText(full).width;
      ctx.font = `600 ${countSize}px system-ui, sans-serif`;
      const w2 = ctx.measureText(countText).width;
      const h = nameSize + countSize + 2;
      return Math.max(w1, w2) <= maxW && h <= maxH;
    };
    while ((nameSize > 6.2 || countSize > 6.2) && !fits()) {
      nameSize = Math.max(6, nameSize - 0.4);
      countSize = Math.max(6, countSize - 0.35);
    }
    if (!fits()) {
      drawAcronymDirect(
        ctx,
        { ...artist, abbreviation: short, name: short },
        cx,
        cy,
        size,
        textColor
      );
      return;
    }
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.beginPath();
    ctx.rect(cx - maxW / 2, cy - maxH / 2, maxW, maxH);
    ctx.clip();
    ctx.fillStyle = textColor;
    ctx.font = `700 ${nameSize}px system-ui, sans-serif`;
    ctx.fillText(full, cx, cy - countSize * 0.45 - 1);
    ctx.fillStyle = "#ffd2f4";
    ctx.font = `600 ${countSize}px system-ui, sans-serif`;
    ctx.fillText(countText, cx, cy + nameSize * 0.35);
    ctx.restore();
    return;
  }

  let fontSize = Math.max(8, size * 0.19);
  ctx.font = `700 ${fontSize}px system-ui, sans-serif`;
  while (fontSize > 6 && ctx.measureText(full).width > maxW) {
    fontSize -= 0.5;
    ctx.font = `700 ${fontSize}px system-ui, sans-serif`;
  }

  if (fontSize <= 6 && ctx.measureText(full).width > maxW) {
    drawAcronymDirect(
      ctx,
      { ...artist, abbreviation: short, name: short },
      cx,
      cy,
      size,
      textColor
    );
    return;
  }

  ctx.save();
  ctx.fillStyle = textColor;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.beginPath();
  ctx.rect(cx - maxW / 2, cy - size * 0.18, maxW, size * 0.36);
  ctx.clip();
  ctx.fillText(full, cx, cy - size * 0.02);
  ctx.restore();
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
