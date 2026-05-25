// loading comet-trail effect — animated tapered arc that follows a
// node's silhouette path, signaling that the node is fetching /
// crunching data. caller passes a `shapePath` closure so the comet
// adapts to any silhouette (circle, hex, octagon, wonky triangle,
// rounded rect, etc.). callers are responsible for keeping the
// canvas redrawing each frame while any node is loading — that's
// what the `onLoading` callback is for: invoked once per draw so
// the canvas knows to schedule another rAF.
//
// visual tuning mirrors the player-bar play/pause loading ring:
// three layered passes (tail, body, head) with increasing alpha
// and decreasing dash length so the bright head leads and the dim
// tail trails behind.

export interface LoadingCometArgs {
  ctx: CanvasRenderingContext2D;
  /** approximate perimeter of the silhouette in world units, used
   *  for dash math. for non-circular shapes a circle-equivalent
   *  perimeter is good enough — dashes wrap around and the visual
   *  is forgiving. */
  perimeter: number;
  /** zoom (for line-width compensation so the stroke stays a
   *  consistent screen thickness). */
  zoom: number;
  /** rAF timestamp in ms for animation phase. */
  time: number;
  /** invoked once per draw to signal the caller that animation is
   *  still active and another frame should be scheduled. */
  onLoading?: () => void;
  /** sets up the path on `ctx` that the comet should stroke. */
  shapePath: () => void;
}

export function drawLoadingComet(args: LoadingCometArgs): void {
  const { ctx, perimeter, zoom, time, onLoading, shapePath } = args;
  onLoading?.();
  const trailW = 2.5 / Math.max(zoom, 0.5);
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = trailW;
  // sweep one full lap every 1.5s, matching the player bar.
  const speed = perimeter / 1500;
  const offset = (time * speed) % perimeter;
  // 3-pass comet: tail (long, dim), body (medium, mid), head
  // (short, bright). all share the same lineDashOffset so the
  // bright head leads and the faint tail trails behind.
  const passes: Array<{ dash: number; alpha: number; color: string }> = [
    { dash: perimeter * 0.32, alpha: 0.18, color: "#ec4899" },
    { dash: perimeter * 0.18, alpha: 0.5, color: "#c026d3" },
    { dash: perimeter * 0.08, alpha: 0.95, color: "#a855f7" },
  ];
  for (const p of passes) {
    ctx.setLineDash([p.dash, perimeter - p.dash]);
    ctx.lineDashOffset = -offset;
    ctx.globalAlpha = p.alpha;
    ctx.strokeStyle = p.color;
    shapePath();
    ctx.stroke();
  }
  ctx.restore();
}
