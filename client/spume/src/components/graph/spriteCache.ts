// off-screen sprite cache for static node decorations.
//
// the canvas draw loop re-rasterises the same album text-tiles and
// artist acronyms every frame even though their contents (artist
// name, title, abbreviation) don't change. for a graph with a few
// hundred no-image nodes that's hundreds of extra `fillText` calls
// per frame, each ~tens of microseconds because the browser has to
// shape the glyph runs from scratch.
//
// this module caches the result of one render call to an
// `OffscreenCanvas` (falling back to a detached `HTMLCanvasElement`
// where OffscreenCanvas isn't available) keyed by a caller-supplied
// string. subsequent frames issue a single `ctx.drawImage(sprite,
// ...)` instead of re-doing the text layout.
//
// the cache is bounded with a simple LRU eviction (insertion-ordered
// Map, oldest removed when size > MAX). 512 entries at 96x96px is
// ~18 MB worst case (RGBA), which is comfortable for desktop
// browsers. callers that draw at multiple zoom buckets should round
// their `size` parameter so we don't store 1000 nearly-identical
// sprites per node.

import { bump, gauge } from "./perfLog";

/** what we hand back to canvas drawImage. drawImage accepts both
 *  OffscreenCanvas and HTMLCanvasElement, so callers can blit the
 *  sprite without caring which backed it. */
type Sprite = OffscreenCanvas | HTMLCanvasElement;

const MAX = 512;
const cache = new Map<string, Sprite>();

const hasOffscreen =
  typeof (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas ===
  "function";

/** create a backing canvas of the given pixel size. */
function makeCanvas(w: number, h: number): Sprite {
  if (hasOffscreen) {
    return new OffscreenCanvas(Math.max(1, w), Math.max(1, h));
  }
  const c = document.createElement("canvas");
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  return c;
}

/** get a 2d context from either backing surface. typed loosely
 *  because OffscreenCanvasRenderingContext2D and
 *  CanvasRenderingContext2D share enough of the API for our
 *  render callbacks but TS's structural matching trips on a few
 *  optional members. */
type AnyCtx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
function ctxOf(s: Sprite): AnyCtx | null {
  return (s as HTMLCanvasElement).getContext("2d") as AnyCtx | null;
}

/**
 * fetch a cached sprite for `key`, or render it once and cache.
 * `render` is called with a context whose origin is (0, 0) and
 * whose surface is exactly `w`x`h` device pixels.
 *
 * returns null if the backing canvas couldn't get a 2d context
 * (very rare; would only happen in stripped-down environments).
 */
export function getOrRenderSprite(
  key: string,
  w: number,
  h: number,
  render: (ctx: AnyCtx) => void,
): Sprite | null {
  const hit = cache.get(key);
  if (hit) {
    // LRU bump: re-insert to mark as most recent.
    cache.delete(key);
    cache.set(key, hit);
    bump("sprite.cache.hit");
    return hit;
  }
  bump("sprite.cache.miss");
  const surface = makeCanvas(w, h);
  const sctx = ctxOf(surface);
  if (!sctx) return null;
  render(sctx);
  cache.set(key, surface);
  // evict oldest if over budget. Map iteration is insertion order so
  // the first key is the least recently used (after re-insertion on
  // hit above).
  while (cache.size > MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
    bump("sprite.cache.evict");
  }
  gauge("sprite.cache.size", cache.size);
  return surface;
}

export function clearSpriteCache(): void {
  cache.clear();
}
