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
// the module specifier is kept in a variable rather than inlined as a
// string literal import so this package's own build/typecheck never needs
// a "midden" module to be resolvable - only the final app that bundles
// this worker (and brings its own midden dependency) does.

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

const MIDDEN_MODULE_SPECIFIER = "midden";

let cached: MiddenBlake3Module | null | undefined;

/**
 * dynamically load the embedding app's midden module, if one is bundled.
 * resolved once and cached; call `resetMiddenBlake3Cache()` to force a
 * fresh attempt (mainly useful in tests).
 */
export async function loadMiddenBlake3(): Promise<MiddenBlake3Module | null> {
  if (cached !== undefined) return cached;
  try {
    cached = (await import(MIDDEN_MODULE_SPECIFIER)) as MiddenBlake3Module;
  } catch {
    cached = null;
  }
  return cached;
}

/** test-only hook: forget the cached resolution so a test can simulate a
 *  fresh worker environment with midden present or absent. */
export function resetMiddenBlake3Cache(): void {
  cached = undefined;
}
