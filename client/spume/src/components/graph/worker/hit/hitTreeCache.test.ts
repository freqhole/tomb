// hitTreeCache.test
//
// covers the rebuild-on-stale + reset contract used by the worker's
// hit-test path. the cache is allowed to use `performance.mark` /
// `performance.measure`; vitest's jsdom environment provides both.

import { describe, expect, it } from "vitest";
import { createHitTreeCache } from "./hitTreeCache";

interface N {
  id: string;
  x?: number;
  y?: number;
}

describe("createHitTreeCache", () => {
  it("returns a tree that can find the nearest node", () => {
    const cache = createHitTreeCache<N>();
    const nodes: N[] = [
      { id: "a", x: 0, y: 0 },
      { id: "b", x: 100, y: 100 },
      { id: "c", x: -50, y: 30 },
    ];
    const tree = cache.ensure(nodes);
    expect(tree.find(1, 1)?.id).toBe("a");
    expect(tree.find(99, 99)?.id).toBe("b");
  });

  it("caches the tree across calls until marked stale", () => {
    const cache = createHitTreeCache<N>();
    const nodes: N[] = [{ id: "a", x: 0, y: 0 }];
    const t1 = cache.ensure(nodes);
    const t2 = cache.ensure(nodes);
    expect(t2).toBe(t1);
  });

  it("rebuilds when stale", () => {
    const cache = createHitTreeCache<N>();
    const nodes: N[] = [{ id: "a", x: 0, y: 0 }];
    const t1 = cache.ensure(nodes);
    cache.markStale();
    const t2 = cache.ensure(nodes);
    expect(t2).not.toBe(t1);
  });

  it("rebuilds against the latest nodes array", () => {
    const cache = createHitTreeCache<N>();
    const t1 = cache.ensure([{ id: "a", x: 0, y: 0 }]);
    expect(t1.find(1, 1)?.id).toBe("a");
    cache.markStale();
    const t2 = cache.ensure([{ id: "z", x: 0, y: 0 }]);
    expect(t2.find(1, 1)?.id).toBe("z");
  });

  it("reset forces a rebuild even without markStale", () => {
    const cache = createHitTreeCache<N>();
    const nodes: N[] = [{ id: "a", x: 0, y: 0 }];
    const t1 = cache.ensure(nodes);
    cache.reset();
    const t2 = cache.ensure(nodes);
    expect(t2).not.toBe(t1);
  });

  it("treats missing x/y as zero", () => {
    const cache = createHitTreeCache<N>();
    const tree = cache.ensure([{ id: "z" }]);
    expect(tree.find(0, 0)?.id).toBe("z");
  });
});
