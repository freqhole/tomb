// remote-root hub role. silhouette is the freqhole wonky 4-sided
// mark. text is a single line of the remote's name (no album
// count — remote roots aggregate counts but don't surface them in
// the silhouette glyph). hover label chip is wider than the other
// hubs since remote names trend longer.

import type { ArtistNodeData } from "../../types";
import { drawHubFrame, type HubFrameLOD } from "../shared/hubFrame";
import {
  drawAcronymDirect,
  drawHoverLabelChip,
  drawHubAcronymWithCount,
} from "../shared/labels";
import { drawLoadingComet } from "../shared/loadingComet";
import { freqholeMarkPath } from "../shared/shapes";
import type { DrawRoleArgs } from "./types";

// remote hubs use a narrower hit-disc than their bounding box —
// the wonky-triangle silhouette is ~0.45 * size wide at its
// centroid so a 0.5 hit factor would include large empty corners.
// 0.42 fits comfortably inside the inscribed area without making
// the node feel finicky to click.
export const HIT_INRADIUS_FACTOR = 0.42;

const FILL_COLOR = "#381932";
const BORDER_COLOR = "#7b2d70";
const TINY_FALLBACK = "#3a0f34";

export function drawRemoteHub(args: DrawRoleArgs): void {
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
    textColor = "#9aa0aa",
    time = 0,
    onMarquee,
    loading = false,
    onLoading,
  } = args;

  const shapePath = () => freqholeMarkPath(ctx, x, y, size);
  ctx.save();
  const lod = drawHubFrame({
    ctx,
    x,
    y,
    size,
    state,
    zoom,
    shapePath,
    fillColor: FILL_COLOR,
    borderColor: BORDER_COLOR,
    ringColor,
    tinyFallbackFill: TINY_FALLBACK,
  });

  // in-shape glyph
  let usedAcronym = false;
  if (!lod.lodTiny) {
    const glyphColor =
      state === "hover" || state === "selected" ? "#ffffff" : textColor;
    usedAcronym = drawRemoteHubText(ctx, artist, x, y, size, glyphColor, lod);
  }

  if (loading) {
    drawLoadingComet({
      ctx,
      perimeter: 2 * Math.PI * (size / 2),
      zoom,
      time,
      onLoading,
      shapePath,
    });
  }

  // hover chip — promoted to always-on when the in-shape glyph
  // collapsed to the acronym, so the full remote name stays
  // visible at every zoom.
  if (showLabel || usedAcronym) {
    drawHoverLabelChip({
      ctx,
      artist,
      x,
      y,
      size,
      maxChipWidthMul: 2.8,
      time,
      onMarquee,
    });
  }

  ctx.restore();
}

/** render the in-shape text for a remote hub. returns true when
 *  the text fell back to the acronym (caller promotes the hover
 *  chip in that case). */
function drawRemoteHubText(
  ctx: CanvasRenderingContext2D,
  artist: ArtistNodeData,
  cx: number,
  cy: number,
  size: number,
  textColor: string,
  lod: HubFrameLOD,
): boolean {
  const full = artist.name ?? "";
  const short = artist.abbreviation || full.slice(0, 3).toUpperCase();
  const countText = String(Math.max(0, Math.round(artist.albumCount ?? 0)));
  // wonky-triangle centroid offset. the freqhole-mark silhouette is
  // asymmetric so the bbox center sits slightly above-and-left of
  // the visual mass center. mean of the four vertices gives ~(0.54,
  // 0.51) of the size×size cell, so we nudge the text anchor right
  // and down a hair to land in the optical middle of the polygon.
  const remoteCx = cx + size * 0.04;
  const remoteCy = cy + size * 0.012;

  if (!full || lod.screenEdge < 28) {
    drawHubAcronymWithCount(
      ctx,
      { ...artist, abbreviation: short, name: short },
      remoteCx,
      remoteCy,
      size,
      textColor,
      countText,
    );
    return true;
  }

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
    drawAcronymDirect(
      ctx,
      { ...artist, abbreviation: short, name: short },
      remoteCx,
      remoteCy,
      size,
      textColor,
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
