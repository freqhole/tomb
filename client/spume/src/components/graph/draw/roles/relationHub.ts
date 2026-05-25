// relation-hub role (hexagon). renders a single relation kind for
// a remote (e.g. "tag", "favorite", "related_artist") as a flat-top
// hex with the kind name above its album count.

import { drawHubFrame } from "../shared/hubFrame";
import { drawHubNameAndCount } from "../shared/hubNameAndCount";
import { drawHubAcronymWithCount, drawHoverLabelChip } from "../shared/labels";
import { drawLoadingComet } from "../shared/loadingComet";
import { regularPolygonPath } from "../shared/shapes";
import type { DrawRoleArgs } from "./types";

// hex inscribed in its bounding circle — the inscribed-circle
// radius IS the bounding radius, so 0.5 is the right hit factor.
export const HIT_INRADIUS_FACTOR = 0.5;

const FILL_COLOR = "#12263d";
const BORDER_COLOR = "#335d8a";

export function drawRelationHub(args: DrawRoleArgs): void {
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
  const shapePath = () => regularPolygonPath(ctx, x, y, r, 6);
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
      // hexagon-inscribed text bounds. flat-edge-to-flat-edge width
      // of a pointy-top hex of radius r is √3·r ≈ 0.866·size, but
      // glyphs that reach right to that limit visually collide with
      // the hex border. 0.7·size leaves a comfortable margin so
      // longer relation kind names like "related_artist" never
      // overlap the silhouette.
      usedAcronym = drawHubNameAndCount({
        ctx,
        artist,
        cx: x,
        cy: y,
        size,
        textColor: glyphColor,
        maxW: size * 0.7,
        maxH: size * 0.42,
        nameStart: Math.max(7, size * 0.17),
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
