// shared draw scaffolding for hub-like roles (remote hub, relation
// hub, relation-value hub) AND the plain artist circle. handles all
// the boilerplate around drawing a single-silhouette node:
//   - LOD branching (skip clip / border at sub-pixel sizes)
//   - dimmed alpha mask
//   - fill (with optional LOD-tiny fast-path that paints a square)
//   - border stroke (skipped when selected so the ring sits flush)
//   - hover / selected ring (drawn ON the silhouette path so the
//     ring traces the polygon outline rather than a bounding circle)
//
// callers pass a `shapePath` closure that sets up the silhouette
// path on the context, plus per-role colors. role-specific in-shape
// glyph rendering (image, acronym, hub text) happens AFTER this
// helper returns, layered on top of the scaffolding it laid down.

import type { NodeState } from "../../types";

export interface DrawHubFrameArgs {
  ctx: CanvasRenderingContext2D;
  /** node center. */
  x: number;
  /** node center. */
  y: number;
  /** edge length / diameter in world units. */
  size: number;
  state: NodeState;
  /** current zoom scale (for LOD branching + stroke compensation). */
  zoom: number;
  /** sets up the silhouette path on `ctx`. invoked multiple times
   *  (fill, border, ring) so it should be idempotent. */
  shapePath: () => void;
  fillColor: string;
  borderColor: string;
  ringColor: string;
  /** color used for the LOD-tiny fast-path square that replaces the
   *  full silhouette below ~12 screen px. defaults to `fillColor`. */
  tinyFallbackFill?: string;
}

export interface HubFrameLOD {
  /** screen-space edge length of the node (size * effective zoom). */
  screenEdge: number;
  /** below ~12px: skip clip + border + text entirely. */
  lodTiny: boolean;
  /** below ~24px: skip image-clip + border stroke (visual diff is
   *  imperceptible at this scale and we save a save/restore). */
  lodSmall: boolean;
  /** state === "dimmed". */
  dimmed: boolean;
}

/** compute LOD flags for a node at the current zoom. returned so
 *  callers can branch their per-role glyph rendering on the same
 *  thresholds the frame uses. */
export function computeHubFrameLOD(
  size: number,
  zoom: number,
  state: NodeState,
): HubFrameLOD {
  const screenEdge = size * Math.max(zoom, 0.05);
  return {
    screenEdge,
    lodTiny: screenEdge < 12,
    lodSmall: screenEdge < 24,
    dimmed: state === "dimmed",
  };
}

/** lay down the silhouette frame (fill + border + hover/selected
 *  ring) for a hub-like node. caller MUST `ctx.save()` BEFORE
 *  invoking this and `ctx.restore()` AFTER its own per-role glyph
 *  rendering completes — this helper applies the dimmed alpha but
 *  does NOT manage its own save/restore so callers can layer
 *  additional state (clip paths, fills, etc.) inside the same
 *  outer save block.
 *
 *  returns the computed LOD so the caller can branch its glyph
 *  rendering on the same thresholds without recomputing. */
export function drawHubFrame(args: DrawHubFrameArgs): HubFrameLOD {
  const {
    ctx,
    x,
    y,
    size,
    state,
    zoom,
    shapePath,
    fillColor,
    borderColor,
    ringColor,
    tinyFallbackFill,
  } = args;
  const lod = computeHubFrameLOD(size, zoom, state);
  const r = size / 2;

  if (lod.dimmed) ctx.globalAlpha = 0.2;

  if (lod.lodTiny) {
    // sub-pixel: collapsing to a filled square is a perf cheat that
    // costs no clip/stroke work and is visually indistinguishable
    // at this size.
    ctx.fillStyle = tinyFallbackFill ?? fillColor;
    ctx.fillRect(x - r, y - r, size, size);
  } else {
    shapePath();
    ctx.fillStyle = fillColor;
    ctx.fill();
  }

  // border first (was previously stroked AFTER the in-shape glyph,
  // which caused the outline to draw on top of any text whose
  // bounding box brushed the silhouette edge — visible as a
  // hairline cutting through the letterforms on hubs). painting
  // the border before the text means the glyph sits on top of the
  // stroke and never gets sliced. skipped when selected (magenta
  // ring sits flush) or when small/tiny since the stroke would be
  // sub-pixel anyway.
  if (state !== "selected" && !lod.lodSmall) {
    ctx.lineWidth = 0.5 / Math.max(zoom, 0.5);
    ctx.strokeStyle = borderColor;
    shapePath();
    ctx.stroke();
  }

  // hover / selected ring — drawn BEFORE the in-shape glyph for
  // the same reason as the border above: at high zoom the 2-3px
  // ring at the silhouette edge would otherwise cut across the
  // text on hubs. uses the silhouette path so the ring traces the
  // actual polygon outline instead of an always-round halo around
  // polygonal hubs.
  if (state === "hover" || state === "selected") {
    const ringW = (state === "selected" ? 3 : 2) / Math.max(zoom, 0.5);
    ctx.lineWidth = ringW;
    ctx.strokeStyle = ringColor;
    shapePath();
    ctx.stroke();
  }

  return lod;
}
