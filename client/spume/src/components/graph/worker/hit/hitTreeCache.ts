// hitTreeCache — pure factory wrapping the worker-side quadtree
// used for hit / rect / lasso queries.
//
// extracted from `graphWorker.ts` as the fifth worker slice
// (phase 12). owning the tree + stale flag in a small object
// keeps the worker module from juggling three module-level
// variables and lets us unit-test the rebuild + invalidation
// behaviour without spinning up d3-force.
//
// the cache rebuilds lazily — `markStale()` is cheap (every sim
// tick calls it), and the actual quadtree work only happens on
// the next `ensure()` call (main-thread hover / down / rect /
// lasso queries).

import { quadtree, type Quadtree } from "d3-quadtree";

/** minimum shape a quadtree-cached node needs: numeric x/y. */
export interface XYNode {
  x?: number;
  y?: number;
}

export interface HitTreeCache<T extends XYNode> {
  /** mark the tree dirty so the next `ensure()` rebuilds it. */
  markStale(): void;
  /** rebuild on demand and return the cached quadtree. callers
   *  pass the latest node array so the cache doesn't need a
   *  reference back into the worker's state. */
  ensure(nodes: T[]): Quadtree<T>;
  /** discard the current tree without rebuilding. used when the
   *  underlying node array is fully replaced. */
  reset(): void;
}

export function createHitTreeCache<T extends XYNode>(): HitTreeCache<T> {
  let tree: Quadtree<T> | null = null;
  let stale = true;
  return {
    markStale() {
      stale = true;
    },
    ensure(nodes: T[]) {
      if (tree && !stale) return tree;
      performance.mark("graph-hittree-start");
      tree = quadtree<T>()
        .x((d) => d.x ?? 0)
        .y((d) => d.y ?? 0)
        .addAll(nodes);
      stale = false;
      performance.measure("graph-hittree-build", "graph-hittree-start");
      performance.clearMarks("graph-hittree-start");
      return tree;
    },
    reset() {
      tree = null;
      stale = true;
    },
  };
}
