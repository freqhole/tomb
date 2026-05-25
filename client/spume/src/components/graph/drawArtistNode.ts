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
import { isRelationHubId, isRelationValueHubId, isRemoteHubId } from "./hubNodes";

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
  /** when true, paint an animated comet-trail arc around the node's
   *  silhouette so the user sees that this node is fetching/crunching
   *  data. mirrors the player-bar play/pause loading ring. caller is
   *  responsible for keeping the canvas redrawing each frame while
   *  any node is loading (see `onLoading` callback). */
  loading?: boolean;
  /** notify caller that the comet trail is active and needs another
   *  frame to keep animating. */
  onLoading?: () => void;
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
    loading = false,
    onLoading,
  } = args;

  const r = size / 2;
  const isRelationHub = isRelationHubId(artist.artistId);
  const isRemoteHub = isRemoteHubId(artist.artistId);
  const isRelationValueHub = isRelationValueHubId(artist.artistId);
  // `isHub` gates the text renderer path: hubs render through
  // `drawHubText` (name + count, polygon-aware bounds); everything
  // else falls to `drawAcronym`. relation_value (octagon) hubs were
  // historically excluded, which silently dropped their album count
  // — they now share the same code path as hex / wonky-triangle hubs.
  const isHub = isRelationHub || isRemoteHub || isRelationValueHub;
  const isHoverLabelHub = isHub;
  // when drawHubText falls back to an acronym (full name doesn't fit
  // inside the hub silhouette at the current size), promote the
  // external label chip from hover-only to always-on so the user can
  // still read the full label even with the abbreviated glyph inside.
  let usedHubAcronym = false;
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

  // border first (was previously stroked AFTER the in-shape glyph,
  // which caused the outline to draw on top of any text whose bounding
  // box brushed the silhouette edge — visible as a hairline cutting
  // through the letterforms on hubs). painting the border before the
  // text means the glyph sits on top of the stroke and never gets
  // sliced. skipped when selected (magenta ring sits flush) or when
  // small/tiny since the stroke would be sub-pixel anyway.
  if (state !== "selected" && !lodSmall) {
    ctx.lineWidth = 0.5 / Math.max(zoom, 0.5);
    ctx.strokeStyle = isRemoteHub ? "#7b2d70" : isRelationHub ? "#335d8a" : borderColor;
    drawHubShapePath();
    ctx.stroke();
  }

  // hover / selected ring — drawn BEFORE the in-shape glyph for the
  // same reason as the border above: at high zoom the 2-3px ring at
  // the silhouette edge would otherwise cut across the text on hubs.
  // we lay it down on top of the fill but under the glyph so the
  // letterforms always sit on top of any chrome. uses the node's
  // silhouette path (hub triangle / hex / octagon / circle) so the
  // ring traces the actual node shape instead of an always-round
  // halo around polygonal hubs.
  if (state === "hover" || state === "selected") {
    const ringW = (state === "selected" ? 3 : 2) / Math.max(zoom, 0.5);
    ctx.lineWidth = ringW;
    ctx.strokeStyle = ringColor;
    drawHubShapePath();
    ctx.stroke();
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
      // hover/selected hubs pop their glyph to pure white so the
      // label reads as the focused element; the dim default
      // (`#9aa0aa`) is reserved for resting hubs.
      const glyphColor = state === "hover" || state === "selected" ? "#ffffff" : textColor;
      if (isHub) {
        usedHubAcronym = drawHubText(ctx, artist, x, y, size, glyphColor, zoom);
      } else {
        drawAcronym(ctx, artist, x, y, size, glyphColor, zoom);
      }
    }
  }

  // loading comet-trail — mirrors the player-bar play/pause ring.
  // stroked over the silhouette path with a long dash that sweeps
  // around the perimeter. layered as several passes with shrinking
  // dash lengths + brightening alpha to fake a tapered comet head.
  if (loading) {
    onLoading?.();
    const trailW = 2.5 / Math.max(zoom, 0.5);
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = trailW;
    // perimeter estimate — uses bounding circle circumference as a
    // coarse-but-good-enough length for dash math; the actual path
    // perimeter doesn't need to be exact since dashes wrap around
    // and the visual is forgiving.
    const perim = 2 * Math.PI * r;
    // sweep one full lap every 1.5s, same speed as the player bar.
    const speed = perim / 1500;
    const offset = (time * speed) % perim;
    // 3-pass comet: tail (long, dim), body (medium, mid), head
    // (short, bright). all share the same lineDashOffset so the
    // bright head leads and faint tail trails behind.
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
      drawHubShapePath();
      ctx.stroke();
    }
    ctx.restore();
  }

  // hub labels are hover-only, except when the in-shape glyph
  // collapsed to an acronym — in that case we always render the
  // chip so the full name stays visible at every zoom level.
  if (isHoverLabelHub && (showLabel || usedHubAcronym)) {
    const label = artist.name ?? artist.abbreviation ?? "";
    if (label) {
      const fontSize = Math.max(8, size * 0.2);
      ctx.font = `600 ${fontSize}px system-ui, sans-serif`;
      const textW = ctx.measureText(label).width;
      // chip shrinks to fit its text + horizontal padding, capped at
      // a hub-kind ceiling so very long names still scroll as a
      // marquee inside a known-width pill rather than ballooning the
      // chip across the canvas. previously the chip was always drawn
      // at the ceiling width, leaving short labels marooned in a sea
      // of empty backdrop.
      const pad = Math.max(4, size * 0.08);
      const maxChipW = size * (isRemoteHub ? 2.8 : 2.4);
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
        // short label — anchor in the chip's geometric center so
        // the text sits visually balanced against the pill.
        ctx.textAlign = "center";
        ctx.fillText(label, lx + chipW / 2, ly + h / 2);
      } else {
        // long label — marquee scroll inside the bounded pill.
        ctx.textAlign = "left";
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
): boolean {
  const screenEdge = size * Math.max(zoom ?? 1, 0.05);
  const isRelationHub = isRelationHubId(artist.artistId);
  const isRemoteHub = isRemoteHubId(artist.artistId);
  const full = artist.name ?? "";
  const short = artist.abbreviation || full.slice(0, 3).toUpperCase();
  const countText = String(Math.max(0, Math.round(artist.albumCount ?? 0)));
  // wonky-triangle centroid offset. the freqhole-mark silhouette is
  // asymmetric so the bbox center sits slightly above-and-left of the
  // visual mass center. mean of the four vertices gives ~(0.54, 0.51)
  // of the size×size cell, so we nudge the text anchor right + down a
  // hair to land in the optical middle of the polygon.
  const remoteCx = isRemoteHub ? cx + size * 0.04 : cx;
  const remoteCy = isRemoteHub ? cy + size * 0.012 : cy;
  // low zoom: shorthand in-node (full label still available on hover).
  // threshold lowered so the album count stays visible further out;
  // hub size now scales by count, and seeing the number is the whole
  // point of the scaling.
  if (!full || screenEdge < 28) {
    drawHubAcronymWithCount(
      ctx,
      { ...artist, abbreviation: short, name: short },
      isRemoteHub ? remoteCx : cx,
      isRemoteHub ? remoteCy : cy,
      size,
      textColor,
      countText
    );
    return true;
  }

  if (isRemoteHub) {
    // wonky triangle is much narrower than the bounding circle —
    // at the centroid's y its inscribed horizontal span is roughly
    // 0.45 × size. keep text well inside that with padding so glyphs
    // never bleed past the outline.
    const maxW = size * 0.4;
    let fontSize = Math.max(8, size * 0.17);
    ctx.font = `700 ${fontSize}px system-ui, sans-serif`;
    while (fontSize > 7 && ctx.measureText(full).width > maxW) {
      fontSize -= 0.5;
      ctx.font = `700 ${fontSize}px system-ui, sans-serif`;
    }
    if (fontSize <= 7 && ctx.measureText(full).width > maxW) {
      // can't fit cleanly — fall back to the acronym placeholder and
      // let the caller surface the full name as a permanent label
      // chip below the node (see `forceLabelChip` in drawArtistNode).
      // remote hubs don't show a count, so plain acronym is fine.
      drawAcronymDirect(
        ctx,
        { ...artist, abbreviation: short, name: short },
        remoteCx,
        remoteCy,
        size,
        textColor
      );
      return true;
    }
    ctx.save();
    ctx.fillStyle = textColor;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.beginPath();
    ctx.rect(remoteCx - maxW / 2, remoteCy - size * 0.16, maxW, size * 0.32);
    ctx.clip();
    ctx.fillText(full, remoteCx, remoteCy);
    ctx.restore();
    return false;
  }

  // hexagon-inscribed text bounds. flat-edge-to-flat-edge width of a
  // pointy-top hex of radius r is √3·r ≈ 0.866·size, but glyphs that
  // reach right to that limit visually collide with the hex border.
  // 0.7·size leaves a comfortable margin so longer relation kind
  // names like "related_artist" never overlap the silhouette.
  const maxW = size * 0.7;
  const maxH = size * 0.42;

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
      drawHubAcronymWithCount(
        ctx,
        { ...artist, abbreviation: short, name: short },
        cx,
        cy,
        size,
        textColor,
        countText
      );
      return true;
    }
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.beginPath();
    ctx.rect(cx - maxW / 2, cy - maxH / 2, maxW, maxH);
    ctx.clip();
    ctx.fillStyle = textColor;
    ctx.font = `700 ${nameSize}px system-ui, sans-serif`;
    // pull the name up a hair so the count, pushed further down,
    // doesn't crowd the hex's bottom edge.
    ctx.fillText(full, cx, cy - nameSize * 0.2);
    ctx.fillStyle = "#ffd2f4";
    ctx.font = `600 ${countSize}px system-ui, sans-serif`;
    ctx.fillText(countText, cx, cy + nameSize * 0.7 + countSize * 0.05);
    ctx.restore();
    return false;
  }

  // relation-value (octagon) hub. mirrors the hex layout above —
  // name on top, album count beneath in the same pink — but uses
  // the octagon's wider inscribed area so we can give the text a
  // touch more room. count sits a bit lower than the name's baseline
  // for visual separation, matching the hex treatment.
  {
    let nameSize = Math.max(7, size * 0.18);
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
      drawHubAcronymWithCount(
        ctx,
        { ...artist, abbreviation: short, name: short },
        cx,
        cy,
        size,
        textColor,
        countText
      );
      return true;
    }
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.beginPath();
    ctx.rect(cx - maxW / 2, cy - maxH / 2, maxW, maxH);
    ctx.clip();
    ctx.fillStyle = textColor;
    ctx.font = `700 ${nameSize}px system-ui, sans-serif`;
    ctx.fillText(full, cx, cy - nameSize * 0.2);
    ctx.fillStyle = "#ffd2f4";
    ctx.font = `600 ${countSize}px system-ui, sans-serif`;
    ctx.fillText(countText, cx, cy + nameSize * 0.7 + countSize * 0.05);
    ctx.restore();
    return false;
  }
}

// fallback used by `drawHubText` when the full name + count don't fit
// inside the hub silhouette: render the acronym (smaller than the
// regular acronym so we can fit a count beneath) plus the count, both
// vertically stacked. when the count is empty / "0" we fall through to
// the plain acronym to keep remote hubs (which don't carry counts)
// looking the same as before.
function drawHubAcronymWithCount(
  ctx: CanvasRenderingContext2D,
  artist: ArtistNodeData,
  cx: number,
  cy: number,
  size: number,
  textColor: string,
  countText: string
) {
  if (!countText || countText === "0") {
    drawAcronymDirect(ctx, artist, cx, cy, size, textColor);
    return;
  }
  const text = artist.abbreviation || (artist.name ?? "").slice(0, 2).toUpperCase();
  const charCount = Math.max(1, text.length);
  // shrink the acronym vs the no-count fallback to make headroom for
  // the count glyphs beneath.
  const baseFraction = charCount <= 2 ? 0.32 : 0.26;
  const acronymSize = Math.max(8, size * baseFraction);
  const countSize = Math.max(7, size * 0.18);
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = textColor;
  ctx.font = `700 ${acronymSize}px system-ui, sans-serif`;
  ctx.fillText(text, cx, cy - acronymSize * 0.42);
  ctx.fillStyle = "#ffd2f4";
  ctx.font = `600 ${countSize}px system-ui, sans-serif`;
  ctx.fillText(countText, cx, cy + acronymSize * 0.42);
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
