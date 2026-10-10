// polyfills CanvasRenderingContext2D.roundRect/Path2D.roundRect for old
// WebView (Safari/WebKit < 16, e.g. macOS Catalina's system WebKit), which
// predates this API entirely - calling it throws "e.roundRect is not a
// function" and kills whatever drawing code called it (confirmed real-world
// on macOS 10.15.7 - WalkCanvas/walkCanvas/{drawing,shapes}.ts all call
// ctx.roundRect to draw node pills/cards).
//
// standard spec-equivalent path construction (moveTo/lineTo/arcTo around the
// four corners) - works for both CanvasRenderingContext2D and Path2D since
// both expose the same path-building methods this relies on.
type RoundRectRadii = number | number[];

function normalizeRadii(radii: RoundRectRadii | undefined): {
  tl: number;
  tr: number;
  br: number;
  bl: number;
} {
  if (typeof radii === "number") return { tl: radii, tr: radii, br: radii, bl: radii };
  if (Array.isArray(radii)) {
    if (radii.length === 1) return { tl: radii[0], tr: radii[0], br: radii[0], bl: radii[0] };
    if (radii.length === 2) return { tl: radii[0], tr: radii[1], br: radii[0], bl: radii[1] };
    if (radii.length === 4) return { tl: radii[0], tr: radii[1], br: radii[2], bl: radii[3] };
  }
  return { tl: 0, tr: 0, br: 0, bl: 0 };
}

function roundRectPolyfill(
  this: CanvasRenderingContext2D | Path2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radii?: RoundRectRadii
) {
  const r = normalizeRadii(radii);
  this.moveTo(x + r.tl, y);
  this.lineTo(x + w - r.tr, y);
  this.arcTo(x + w, y, x + w, y + r.tr, r.tr);
  this.lineTo(x + w, y + h - r.br);
  this.arcTo(x + w, y + h, x + w - r.br, y + h, r.br);
  this.lineTo(x + r.bl, y + h);
  this.arcTo(x, y + h, x, y + h - r.bl, r.bl);
  this.lineTo(x, y + r.tl);
  this.arcTo(x, y, x + r.tl, y, r.tl);
}

if (
  typeof CanvasRenderingContext2D !== "undefined" &&
  !CanvasRenderingContext2D.prototype.roundRect
) {
  (CanvasRenderingContext2D.prototype as any).roundRect = roundRectPolyfill;
}
if (typeof Path2D !== "undefined" && !Path2D.prototype.roundRect) {
  (Path2D.prototype as any).roundRect = roundRectPolyfill;
}
