// primitive canvas-2d path helpers, role-agnostic. each function
// just sets up a path on the provided context — the caller decides
// whether to fill, stroke, clip, etc. all coordinates are in
// world-space; the caller is responsible for any zoom/dpr scaling
// applied to the context itself.

/** circle of `r` centered at (cx, cy). */
export function circlePath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
}

/** regular n-gon inscribed in a circle of radius `r` centered at
 *  (cx, cy). `rotation` (radians) controls orientation; default
 *  -PI/2 puts the first vertex at the top. */
export function regularPolygonPath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  sides: number,
  rotation: number = -Math.PI / 2,
): void {
  const step = (Math.PI * 2) / sides;
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const a = rotation + i * step;
    const px = cx + Math.cos(a) * r;
    const py = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/** the freqhole-mark wonky 4-sided silhouette used for remote
 *  root hubs. inscribed in a `size x size` bbox centered at (cx, cy).
 *  vertices are hardcoded fractions of the bbox so the shape stays
 *  visually identical to the brand mark across all sizes. */
export function freqholeMarkPath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
): void {
  const x0 = cx - size / 2;
  const y0 = cy - size / 2;
  ctx.beginPath();
  ctx.moveTo(x0 + 0.5 * size, y0 + 0.95 * size);
  ctx.lineTo(x0 + 0.14 * size, y0 + 0.18 * size);
  ctx.lineTo(x0 + 0.86 * size, y0 + 0.18 * size);
  ctx.lineTo(x0 + 0.66 * size, y0 + 0.74 * size);
  ctx.closePath();
}

/** rounded-corner rectangle path. corner radius is clamped to half
 *  the smaller axis so degenerate inputs don't blow up. */
export function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
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
