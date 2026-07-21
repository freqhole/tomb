// test content for blob-transfer coverage, sized to actually exercise
// chunked/verified transfer instead of false-greening on a tiny payload.
//
// a short ascii marker string is enough to prove a hash/transfer
// round-trips *a* value, but it never exercises anything past a
// transport's first chunk group (iroh-blobs' BAO tree groups chunks in
// 16KiB units by default) - every real file a user ever transfers
// (images, audio, arbitrary files) is orders of magnitude bigger than a
// short sentence, so a bug that only shows up past the first chunk (a bad
// chunk-range request, a truncated multi-round download, an off-by-one at
// a tail chunk) would never be caught by marker-string content alone.

import { randomBytes as nodeRandomBytes } from "node:crypto";

/** default size for content meant to exercise real chunked transfer - a
 *  few multiples of a 16KiB chunk group, small enough to keep test
 *  runtime reasonable. */
export const DEFAULT_RANDOM_BLOB_SIZE = 96 * 1024; // 96 KiB

/**
 * deterministic pseudo-random bytes (mulberry32 PRNG, seeded) -
 * reproducible across runs (a failing test always fails on the exact
 * same content, instead of a new random blob every run making failures
 * harder to correlate/reproduce), but realistic enough (non-repeating, no
 * long runs of the same byte) to exercise real chunk/BAO-tree code paths
 * the way genuinely random file content would.
 */
export function deterministicBytes(sizeBytes: number, seed = 0xc0ffee): Uint8Array {
  let state = seed >>> 0;
  const next = (): number => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const bytes = new Uint8Array(sizeBytes);
  for (let i = 0; i < sizeBytes; i++) {
    bytes[i] = Math.floor(next() * 256);
  }
  return bytes;
}

/** genuinely random bytes (node `crypto.randomBytes`) - used where
 *  cross-run reproducibility matters less than being sure there's no
 *  accidental structure a bug could hide behind (e.g. verifying a
 *  byte-for-byte disk write independent of any PRNG's own patterns). */
export function randomBlobBytes(sizeBytes: number = DEFAULT_RANDOM_BLOB_SIZE): Uint8Array {
  return new Uint8Array(nodeRandomBytes(sizeBytes));
}
