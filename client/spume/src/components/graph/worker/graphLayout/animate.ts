// from→to position interpolator. fed a pair of layout snapshots,
// emits per-frame lerped positions until the duration elapses, then
// stays at the destination forever.
//
// the worker drives the animator with a per-rAF tick callback,
// streaming into the same Float32Array buffers the renderer already
// consumes. nodes present in `to` but not `from` snap in at their
// destination with a fade alpha; nodes in `from` but not `to`
// gradually fade out at their old position.

export const DURATION_MS_DEFAULT = 280;
export const EASING_DEFAULT = (t: number) => 1 - Math.pow(1 - t, 3);

export interface AnimSnapshot {
  /** node id → world position. */
  positions: Map<string, { x: number; y: number }>;
  /** node ids in render order. drives the Float32Array layout. */
  order: string[];
}

export interface AnimFrame {
  /** [x0,y0,x1,y1,...] in the `order` of the to-snapshot. */
  buf: Float32Array;
  /** per-id alphas in the same order. lets the renderer cross-fade
   *  appearing/disappearing nodes without re-architecting. */
  alphas: Float32Array;
  /** true on the final frame (t = 1). */
  done: boolean;
}

export interface Animator {
  /** start a new animation from the current displayed positions
   *  toward `to`. if an animation is already running, the current
   *  on-screen positions become the new `from`. */
  start(from: AnimSnapshot, to: AnimSnapshot, durationMs?: number): void;
  /** advance to wall-clock `nowMs` and write the current frame. */
  tick(nowMs: number): AnimFrame;
  /** ids currently being rendered (same as the most-recent `to.order`). */
  currentOrder(): string[];
  isAnimating(): boolean;
}

export function createAnimator(): Animator {
  let from: AnimSnapshot = { positions: new Map(), order: [] };
  let to: AnimSnapshot = { positions: new Map(), order: [] };
  let startMs = 0;
  let durationMs = DURATION_MS_DEFAULT;
  let animating = false;

  return {
    start(nextFrom, nextTo, dur = DURATION_MS_DEFAULT) {
      from = nextFrom;
      to = nextTo;
      durationMs = Math.max(dur, 1);
      startMs = -1; // first tick captures the wall clock.
      animating = true;
    },
    tick(nowMs) {
      if (startMs < 0) startMs = nowMs;
      const elapsed = nowMs - startMs;
      const tRaw = Math.min(1, Math.max(0, elapsed / durationMs));
      const t = EASING_DEFAULT(tRaw);
      const done = tRaw >= 1;
      if (done) animating = false;

      const n = to.order.length;
      const buf = new Float32Array(n * 2);
      const alphas = new Float32Array(n);

      for (let i = 0; i < n; i++) {
        const id = to.order[i];
        const dst = to.positions.get(id);
        if (!dst) {
          buf[i * 2] = 0;
          buf[i * 2 + 1] = 0;
          alphas[i] = 0;
          continue;
        }
        const src = from.positions.get(id);
        if (src) {
          // present in both: lerp position, full alpha.
          buf[i * 2] = src.x + (dst.x - src.x) * t;
          buf[i * 2 + 1] = src.y + (dst.y - src.y) * t;
          alphas[i] = 1;
        } else {
          // new in `to`: snap to destination, fade alpha in.
          buf[i * 2] = dst.x;
          buf[i * 2 + 1] = dst.y;
          alphas[i] = t;
        }
      }

      return { buf, alphas, done };
    },
    currentOrder() {
      return to.order;
    },
    isAnimating() {
      return animating;
    },
  };
}
