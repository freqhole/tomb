// positionBufferPool.test
//
// covers reuse, size-mismatch drop, capacity cap, and the
// allocator fallback. these constraints matter because the worker
// holds many transferred buffers in flight per second; leaking
// or wrong-sized arrays show up as GC pressure and tick jitter.

import { describe, expect, it } from "vitest";
import { createPositionBufferPool } from "./positionBufferPool";

describe("createPositionBufferPool", () => {
  it("allocates a fresh buffer sized n*2 when empty", () => {
    const p = createPositionBufferPool();
    const b = p.obtain(5);
    expect(b).toBeInstanceOf(Float32Array);
    expect(b.length).toBe(10);
    expect(p.size()).toBe(0);
  });

  it("returns a pooled buffer when one of the right size exists", () => {
    const p = createPositionBufferPool();
    const a = p.obtain(3);
    p.release(a, 3);
    expect(p.size()).toBe(1);
    const b = p.obtain(3);
    expect(b).toBe(a);
    expect(p.size()).toBe(0);
  });

  it("drops buffers whose size doesn't match the expected node count", () => {
    const p = createPositionBufferPool();
    const stale = new Float32Array(6); // implies n=3
    p.release(stale, 5); // node count changed to 5
    expect(p.size()).toBe(0);
  });

  it("caps the pool at the configured capacity", () => {
    const p = createPositionBufferPool(2);
    p.release(new Float32Array(4), 2);
    p.release(new Float32Array(4), 2);
    p.release(new Float32Array(4), 2);
    expect(p.size()).toBe(2);
  });

  it("clear() empties the pool", () => {
    const p = createPositionBufferPool();
    p.release(new Float32Array(4), 2);
    p.release(new Float32Array(4), 2);
    expect(p.size()).toBe(2);
    p.clear();
    expect(p.size()).toBe(0);
  });

  it("allocates fresh when the pooled sizes don't match the request", () => {
    const p = createPositionBufferPool();
    const small = new Float32Array(4); // n=2
    p.release(small, 2);
    const big = p.obtain(5);
    expect(big).not.toBe(small);
    expect(big.length).toBe(10);
    // the unmatched buffer stays in the pool for a future n=2 request.
    expect(p.size()).toBe(1);
  });
});
