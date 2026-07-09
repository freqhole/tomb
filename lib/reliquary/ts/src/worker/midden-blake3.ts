// optional blake3 hashing backend for the blob worker.
//
// this package does not declare a hard dependency on any specific midden
// wasm build. blake3 hashing (and the opfs-store selftest hooks used
// during development) are provided by whatever midden-shaped module the
// embedding app bundles alongside this worker. the loader below resolves
// that module dynamically at runtime; every caller degrades gracefully
// (an empty hash string, or a clearly thrown error where there is no
// meaningful fallback) when it is not available.
//
// the specifier must be a literal string at the `import()` call site, not
// a variable: bundlers only apply their own alias/resolution config (e.g.
// vite's `resolve.alias`) to dynamic imports they can statically analyze,
// and a variable defeats that analysis entirely - the import then falls
// through to the runtime's native module resolution, which cannot resolve
// a bare specifier without an import map and fails with "failed to
// resolve module specifier". `@ts-ignore` (not `@vite-ignore`) is what's
// needed here: this package never bundles a real "midden" module itself,
// so typechecking a literal import of it is expected to fail, but the
// bundler must still see and rewrite the literal specifier.

import { log } from "../utils/log.js";

const TAG = "blob.worker.midden";

/** structural view of the pieces of a midden-shaped module this worker uses. */
export interface MiddenBlake3Module {
  hash_blake3?(data: Uint8Array): string;
  Blake3Hasher?: new () => Blake3HasherLike;
  opfs_store_selftest?(): Promise<string> | string;
  opfs_store_selftest_persistence?(): Promise<string> | string;
}

/** incremental blake3 hasher, matching the shape midden's wasm bindings expose. */
export interface Blake3HasherLike {
  update(chunk: Uint8Array): void;
  finalize(): string;
  free(): void;
}

let cached: MiddenBlake3Module | null | undefined;

/**
 * dynamically load the embedding app's midden module, if one is bundled.
 * resolved once and cached; call `resetMiddenBlake3Cache()` to force a
 * fresh attempt (mainly useful in tests).
 */
export async function loadMiddenBlake3(): Promise<MiddenBlake3Module | null> {
  if (cached !== undefined) return cached;
  try {
    // @ts-ignore - this package never bundles a real "midden" module; the
    // embedding app aliases the literal specifier below to its own build.
    cached = (await import("midden")) as MiddenBlake3Module;
  } catch (err) {
    log.warn(TAG, "midden module failed to load, blake3 hashing will degrade:", err);
    cached = null;
  }
  return cached;
}

/** test-only hook: forget the cached resolution so a test can simulate a
 *  fresh worker environment with midden present or absent. */
export function resetMiddenBlake3Cache(): void {
  cached = undefined;
}
