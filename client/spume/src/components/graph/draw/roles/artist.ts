// artist circle role — the only non-hub draw under `roles/` that
// shares the `DrawRoleArgs` shape with the hub silhouettes. renders
// either an avatar image (clipped to the circle) or the artist's
// acronym placeholder, with optional hover chip OFF (artists don't
// carry chip labels — their hover affordance lives in the popover).

import { getImage, getImageFor } from "../../imageCache";
import { bump } from "../../perfLog";
import { drawHubFrame } from "../shared/hubFrame";
import { drawAcronym } from "../shared/labels";
import { drawLoadingComet } from "../shared/loadingComet";
import { circlePath } from "../shared/shapes";
import type { DrawRoleArgs } from "./types";

// per-role hit-test inradius factor. artist circles use the inscribed
// circle radius (= size / 2). co-located here so any future
// silhouette change updates render + hit-test together. see
// `draw/shared/hitRadius.ts` for the consolidated dispatch.
export const HIT_INRADIUS_FACTOR = 0.5;

export function drawArtist(args: DrawRoleArgs): void {
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
    time = 0,
    loading = false,
    onLoading,
  } = args;

  const r = size / 2;
  const shapePath = () => circlePath(ctx, x, y, r);

  ctx.save();

  const lod = drawHubFrame({
    ctx,
    x,
    y,
    size,
    state,
    zoom,
    shapePath,
    fillColor: bgColor,
    borderColor,
    ringColor,
  });

  const hasImage = !!(artist.image || artist.imageUrl);
  if (hasImage) {
    const img = artist.image
      ? getImageFor(artist.image, 200, onImageReady)
      : getImage(artist.imageUrl!, onImageReady);
    if (img) {
      bump("draw.artist.img.ready");
      if (lod.lodSmall) {
        // skip circle clip — paint the image as a square. at <24
        // screen px the difference between circle and square is
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
    } else if (!lod.lodTiny) {
      bump("draw.artist.img.loading");
      drawAcronym(ctx, artist, x, y, size, textColor, zoom);
    } else {
      bump("draw.artist.img.loading");
    }
  } else {
    bump("draw.artist.img.none");
    if (!lod.lodTiny) {
      const glyphColor =
        state === "hover" || state === "selected" ? "#ffffff" : textColor;
      drawAcronym(ctx, artist, x, y, size, glyphColor, zoom);
    }
  }

  if (loading) {
    // circle perimeter is exact for this role.
    drawLoadingComet({
      ctx,
      perimeter: 2 * Math.PI * r,
      zoom,
      time,
      onLoading,
      shapePath,
    });
  }

  ctx.restore();
}
