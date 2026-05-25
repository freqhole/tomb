// positionBufferPool — Float32Array ping-pong pool used by the
// worker's `positions` post.
//
// extracted from `graphWorker.ts` as the sixth worker slice
// (phase 12). the pool caps at a small number of buffers so we
// don't accumulate stale-sized arrays across topology changes
// that resize the position array.
//
// the caller passes the "expected length" on release so the pool
// can drop mismatched buffers without needing a reference back
// into the worker's `simNodes`.

export interface PositionBufferPool {
  /** obtain a buffer sized for `n` nodes (length = n * 2). reuses
   *  a pooled buffer of the right size if available, otherwise
   *  allocates a fresh one. */
  obtain(n: number): Float32Array;
  /** return a buffer to the pool. `expectedNodeCount` is the
   *  worker's current `simNodes.length`; mismatched buffers (from
   *  before a topology change) are dropped on the floor. */
  release(buf: Float32Array, expectedNodeCount: number): void;
  /** drop all pooled buffers. used after a hard reset. */
  clear(): void;
  /** current pool size — exposed for assertions. */
  size(): number;
}

export function createPositionBufferPool(
  capacity = 4,
): PositionBufferPool {
  const pool: Float32Array[] = [];
  return {
    obtain(n) {
      for (let i = pool.length - 1; i >= 0; i--) {
        const candidate = pool[i];
        if (candidate.length === n * 2) {
          pool.splice(i, 1);
          return candidate;
        }
      }
      return new Float32Array(n * 2);
    },
    release(buf, expectedNodeCount) {
      if (buf.length === expectedNodeCount * 2 && pool.length < capacity) {
        pool.push(buf);
      }
    },
    clear() {
      pool.length = 0;
    },
    size() {
      return pool.length;
    },
  };
}
