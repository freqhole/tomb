// shared text layout for relation / value hub silhouettes: two
// stacked lines (name + album count) auto-shrunk to fit the
// inscribed text bounds. falls back to `drawHubAcronymWithCount`
// when the full label can't fit even at the minimum font size.
//
// the relation hex and value octagon roles each call this with
// their own `maxW` / `maxH` (the hex is slightly narrower than
// the octagon so the bounds differ). returns true when the text
// fell back to the acronym, so the caller can promote the hover
// label chip to always-on.

import type { ArtistNodeData } from "../../types";
import { drawHubAcronymWithCount } from "./labels";

export interface HubNameAndCountArgs {
  ctx: CanvasRenderingContext2D;
  artist: ArtistNodeData;
  /** node center. */
  cx: number;
  cy: number;
  /** node size in world units (used for fallback acronym sizing). */
  size: number;
  textColor: string;
  /** inscribed text bounds inside the silhouette. */
  maxW: number;
  maxH: number;
  /** starting font size for the name line. */
  nameStart: number;
  /** starting font size for the count line. */
  countStart: number;
}

export function drawHubNameAndCount(args: HubNameAndCountArgs): boolean {
  const { ctx, artist, cx, cy, size, textColor, maxW, maxH } = args;
  const full = artist.name ?? "";
  const short = artist.abbreviation || full.slice(0, 3).toUpperCase();
  const countText = String(Math.max(0, Math.round(artist.albumCount ?? 0)));

  let nameSize = args.nameStart;
  let countSize = args.countStart;
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
      countText,
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
  // doesn't crowd the silhouette's bottom edge.
  ctx.fillText(full, cx, cy - nameSize * 0.2);
  ctx.fillStyle = "#ffd2f4";
  ctx.font = `600 ${countSize}px system-ui, sans-serif`;
  ctx.fillText(countText, cx, cy + nameSize * 0.7 + countSize * 0.05);
  ctx.restore();
  return false;
}
