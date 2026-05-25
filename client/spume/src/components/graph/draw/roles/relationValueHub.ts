// relation-value hub role (octagon). renders an individual value
// within a relation kind (e.g. a single tag string, a single
// favorite-list name) as a flat-top octagon with the value name
// above its album count. mirrors the relation-hub layout but uses
// the octagon's slightly wider inscribed area for the name start
// font size.

import { drawHubFrame } from "../shared/hubFrame";
import { drawHubNameAndCount } from "../shared/hubNameAndCount";
import { drawHubAcronymWithCount, drawHoverLabelChip } from "../shared/labels";
import { drawLoadingComet } from "../shared/loadingComet";
import { regularPolygonPath } from "../shared/shapes";
import type { DrawRoleArgs } from "./types";

// octagon inscribed in its bounding circle — same hit factor as
// the hex (the inscribed-circle radius IS the bounding radius).
export const HIT_INRADIUS_FACTOR = 0.5;

// value hubs inherit the relation-hub blue palette so users can
// read the scaffold as one continuous kind→value chain by color.
const FILL_COLOR = "#12263d";
const BORDER_COLOR = "#335d8a";

export function drawRelationValueHub(args: DrawRoleArgs): void {
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

  const r = size / 2;
  const shapePath = () => regularPolygonPath(ctx, x, y, r, 8);
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
  });

  let usedAcronym = false;
  if (!lod.lodTiny) {
    const glyphColor =
      state === "hover" || state === "selected" ? "#ffffff" : textColor;
    const full = artist.name ?? "";
    const short = artist.abbreviation || full.slice(0, 3).toUpperCase();
    const countText = String(Math.max(0, Math.round(artist.albumCount ?? 0)));
    if (!full || lod.screenEdge < 28) {
      drawHubAcronymWithCount(
        ctx,
        { ...artist, abbreviation: short, name: short },
        x,
        y,
        size,
        glyphColor,
        countText,
      );
      usedAcronym = true;
    } else {
      usedAcronym = drawHubNameAndCount({
        ctx,
        artist,
        cx: x,
        cy: y,
        size,
        textColor: glyphColor,
        maxW: size * 0.7,
        maxH: size * 0.42,
        nameStart: Math.max(7, size * 0.18),
        countStart: Math.max(7, size * 0.15),
      });
    }
  }

  if (loading) {
    drawLoadingComet({
      ctx,
      perimeter: 2 * Math.PI * r,
      zoom,
      time,
      onLoading,
      shapePath,
    });
  }

  if (showLabel || usedAcronym) {
    drawHoverLabelChip({
      ctx,
      artist,
      x,
      y,
      size,
      maxChipWidthMul: 2.4,
      time,
      onMarquee,
    });
  }

  ctx.restore();
}
