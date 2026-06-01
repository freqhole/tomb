export function drawPolygon(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  sides: number,
  rotation = 0
) {
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const angle = rotation + (i / sides) * Math.PI * 2;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

// wonky triangle: slightly irregular like the freqhole logo - one vertex taller
// kept for reference but replaced by freqholeMarkPath below

/** returns the 4 freqhole-mark vertices in world coords. when `gap > 0`,
 *  each vertex is pushed outward from the shape's *centroid* (not the
 *  node center) by `gap` world pixels. uniform-offset outset — needed
 *  because the shape is asymmetric and naïve scaling around (cx, cy)
 *  gives an uneven gap on the left vs the bottom. */
export function freqholeMarkVerts(
  cx: number,
  cy: number,
  r: number,
  gap: number
): { x: number; y: number }[] {
  const size = r * 2;
  const x0 = cx - r;
  const y0 = cy - r;
  // shape-local vertex fractions (0..1 over the 2r × 2r bounding box)
  const frac: ReadonlyArray<readonly [number, number]> = [
    [0.5, 0.95], // bottom center
    [0.14, 0.18], // top-left
    [0.86, 0.18], // top-right
    [0.66, 0.74], // inner-right notch
  ];
  // centroid of the 4 vertices in world coords (drives the outset direction).
  // pre-computed: ((0.5+0.14+0.86+0.66)/4, (0.95+0.18+0.18+0.74)/4) = (0.54, 0.5125)
  const ccx = x0 + 0.54 * size;
  const ccy = y0 + 0.5125 * size;
  const out: { x: number; y: number }[] = new Array(frac.length);
  for (let i = 0; i < frac.length; i++) {
    const wx = x0 + frac[i][0] * size;
    const wy = y0 + frac[i][1] * size;
    if (gap === 0) {
      out[i] = { x: wx, y: wy };
      continue;
    }
    const dx = wx - ccx;
    const dy = wy - ccy;
    const d = Math.hypot(dx, dy) || 1;
    out[i] = { x: wx + (dx / d) * gap, y: wy + (dy / d) * gap };
  }
  return out;
}

/** sets up the canvas path for a node's shape without filling or stroking.
 *  used for both the node fill and the hover/pivot ring. for most roles the
 *  ring is achieved by passing `r + gap`; the `root` role uses a true
 *  uniform outset via freqholeMarkVerts so its asymmetric silhouette gets
 *  an even gap on every side. callers may pass `gap` (defaults to 0) when
 *  drawing a ring instead of the base shape. */
export function nodeShapePath(
  ctx: CanvasRenderingContext2D,
  role: string,
  x: number,
  y: number,
  r: number,
  gap: number = 0
) {
  switch (role) {
    case "root": {
      // freqhole-mark silhouette — single root node uses the wonky
      // triangle. uniform outset via shape centroid keeps the hover/
      // selection ring equidistant from every silhouette edge.
      const verts = freqholeMarkVerts(x, y, r, gap);
      ctx.beginPath();
      ctx.moveTo(verts[0].x, verts[0].y);
      for (let i = 1; i < verts.length; i++) ctx.lineTo(verts[i].x, verts[i].y);
      ctx.closePath();
      break;
    }
    case "remote": {
      // rounded square — hosts the remote's avatar image or a
      // deterministic 3-color gradient. ~12% larger than album squares
      // so the hub still reads as a higher-tier node.
      const half = r + gap;
      const radius = Math.max(2, (r + gap) * 0.22);
      ctx.beginPath();
      ctx.roundRect(x - half, y - half, half * 2, half * 2, radius);
      break;
    }
    case "relation":
      drawPolygon(ctx, x, y, r + gap, 6, 0);
      break;
    case "group":
      drawPolygon(ctx, x, y, r + gap, 7, 0);
      break;
    case "value":
      drawPolygon(ctx, x, y, r + gap, 8, Math.PI / 8);
      break;
    case "album": {
      const half = r * 0.88 + gap;
      ctx.beginPath();
      ctx.rect(x - half, y - half, half * 2, half * 2);
      break;
    }
    case "artist":
    default:
      ctx.beginPath();
      ctx.arc(x, y, r + gap, 0, Math.PI * 2);
      break;
  }
}

/** outset polyline approximating a node's silhouette, used by drawLoadingComet
 *  to trace the comet around the actual shape (square, hex, octagon,
 *  freqhole mark) rather than always falling back to a circle. polygons use
 *  the same vertex generators as nodeShapePath; circles are discretized to
 *  64 points so the arc-length sampler stays uniform. `outset` pushes every
 *  vertex outward from the node center by that many world pixels. */
export function shapePolyline(
  role: string,
  cx: number,
  cy: number,
  r: number,
  outset: number
): { x: number; y: number }[] {
  switch (role) {
    case "root": {
      // freqhole mark — uniform outset along centroid-to-vertex direction
      // so the comet trails the silhouette evenly on every side.
      return freqholeMarkVerts(cx, cy, r, outset);
    }
    case "remote": {
      // rounded square — approximate with the bounding square so the
      // comet rides the outer rectangle (corner radius is small enough
      // that the visual diff is negligible at typical zoom).
      const half = r + outset;
      return [
        { x: cx - half, y: cy - half },
        { x: cx + half, y: cy - half },
        { x: cx + half, y: cy + half },
        { x: cx - half, y: cy + half },
      ];
    }
    case "relation":
      return regularPolyVerts(cx, cy, r + outset, 6, 0);
    case "group":
      return regularPolyVerts(cx, cy, r + outset, 7, 0);
    case "value":
      return regularPolyVerts(cx, cy, r + outset, 8, Math.PI / 8);
    case "album": {
      const half = r * 0.88 + outset;
      return [
        { x: cx - half, y: cy - half },
        { x: cx + half, y: cy - half },
        { x: cx + half, y: cy + half },
        { x: cx - half, y: cy + half },
      ];
    }
    case "artist":
    default: {
      // circle → discretize to 64 segments so the perimeter sampler can
      // walk it with the same arc-length math as polygon shapes.
      const N = 64;
      const rr = r + outset;
      const pts: { x: number; y: number }[] = new Array(N);
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2;
        pts[i] = { x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr };
      }
      return pts;
    }
  }
}

export function regularPolyVerts(
  cx: number,
  cy: number,
  r: number,
  sides: number,
  rotation: number
): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = new Array(sides);
  for (let i = 0; i < sides; i++) {
    const a = rotation + (i / sides) * Math.PI * 2;
    pts[i] = { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
  }
  return pts;
}

// ray-casting point-in-polygon test (crossing number algorithm).
export function pointInPolygon(
  px: number,
  py: number,
  poly: { x: number; y: number }[]
): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x,
      yi = poly[i].y;
    const xj = poly[j].x,
      yj = poly[j].y;
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}
