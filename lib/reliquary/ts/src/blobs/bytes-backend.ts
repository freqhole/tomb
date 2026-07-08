// the bytes side of the resolver chain: where raw blob bytes actually live.
//
// two backends, tried in order: OPFS is primary (bytes are content-addressed
// by blake3 hex filename), the Cache API is a fallback for origins where
// OPFS isn't available (webkitgtk historically rejects OPFS writes from the
// main thread) or where a write to OPFS failed for some other reason. a
// record remembers which backend it landed in (`storage_backend`) so a
// later read goes straight there instead of probing every backend on every
// read; records written before that field existed are assumed to be OPFS
// (the only backend that existed at the time).
//
// OPFS writes are content-addressed and shared across every consumer of
// this package at the origin (the same blake3 hash is the same bytes no
// matter which app wrote it), so the OPFS directory name and the cache
// name are fixed, not parameterized per store instance - only the
// IndexedDB metadata database name varies per app (see `store.ts`).
//
// writes go through the blob worker (`../worker`) for OPFS - it uses a
// `FileSystemSyncAccessHandle` when available, which is dramatically
// faster than the async writable-stream API and is only usable off the
// main thread. reads/existence-checks/removals talk to OPFS directly on
// the calling thread instead - plain `getFile()` reads don't need a sync
// access handle, and keeping them off the worker avoids a round trip.

import { BLOB_OPFS_DIR, writeBlobToOpfs as writeBlobToOpfsViaWorker } from "../worker/index.js";
import type { BytesBackendName } from "./types.js";

export interface BytesBackend {
  readonly name: BytesBackendName;
  isAvailable(): Promise<boolean>;
  /** write returns false (never throws) when the backend could not accept
   *  the write, so the caller can fall through to the next backend in the
   *  chain. */
  write(id: string, data: ArrayBuffer, mime: string): Promise<boolean>;
  read(id: string): Promise<ArrayBuffer | null>;
  has(id: string): Promise<boolean>;
  remove(id: string): Promise<void>;
  /** remove every stored blob's bytes - used by `clearAll()`. */
  clear(): Promise<void>;
}

/** true when the origin private file system API is available. */
export function isOPFSSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    "storage" in navigator &&
    typeof navigator.storage.getDirectory === "function"
  );
}

async function getOpfsDir(create: boolean): Promise<FileSystemDirectoryHandle | null> {
  if (!isOPFSSupported()) return null;
  try {
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle(BLOB_OPFS_DIR, { create });
  } catch {
    return null;
  }
}

export function createOpfsBackend(): BytesBackend {
  return {
    name: "opfs",

    async isAvailable(): Promise<boolean> {
      return isOPFSSupported();
    },

    async write(id: string, data: ArrayBuffer): Promise<boolean> {
      try {
        await writeBlobToOpfsViaWorker(id, data);
        return true;
      } catch {
        return false;
      }
    },

    async read(id: string): Promise<ArrayBuffer | null> {
      try {
        const dir = await getOpfsDir(false);
        if (!dir) return null;
        const fileHandle = await dir.getFileHandle(id);
        const file = await fileHandle.getFile();
        return await file.arrayBuffer();
      } catch {
        return null;
      }
    },

    async has(id: string): Promise<boolean> {
      try {
        const dir = await getOpfsDir(false);
        if (!dir) return false;
        await dir.getFileHandle(id, { create: false });
        return true;
      } catch {
        return false;
      }
    },

    async remove(id: string): Promise<void> {
      try {
        const dir = await getOpfsDir(false);
        if (dir) await dir.removeEntry(id);
      } catch {
        // missing entry is fine - remove is best-effort
      }
    },

    async clear(): Promise<void> {
      try {
        const root = await navigator.storage.getDirectory();
        await root.removeEntry(BLOB_OPFS_DIR, { recursive: true });
      } catch {
        // directory may not exist - that's fine
      }
    },
  };
}

/** cache name for the Cache API fallback backend. a synthetic https origin
 *  is used for cache keys (`https://blob.local/<id>`) because webkitgtk
 *  rejects non-http(s) URLs in the Cache API. */
const CACHE_NAME = "reliquary-blobs";
const CACHE_URL_ORIGIN = "https://blob.local";

function cacheUrlFor(id: string): string {
  return `${CACHE_URL_ORIGIN}/${id}`;
}

function isCacheApiSupported(): boolean {
  return typeof caches !== "undefined";
}

export function createCacheBackend(): BytesBackend {
  return {
    name: "cache",

    async isAvailable(): Promise<boolean> {
      return isCacheApiSupported();
    },

    async write(id: string, data: ArrayBuffer, mime: string): Promise<boolean> {
      if (!isCacheApiSupported()) return false;
      try {
        const cache = await caches.open(CACHE_NAME);
        const response = new Response(data, { headers: { "Content-Type": mime } });
        await cache.put(cacheUrlFor(id), response);
        return true;
      } catch {
        return false;
      }
    },

    async read(id: string): Promise<ArrayBuffer | null> {
      if (!isCacheApiSupported()) return null;
      try {
        const cache = await caches.open(CACHE_NAME);
        const response = await cache.match(cacheUrlFor(id));
        if (!response) return null;
        return await response.arrayBuffer();
      } catch {
        return null;
      }
    },

    async has(id: string): Promise<boolean> {
      if (!isCacheApiSupported()) return false;
      try {
        const cache = await caches.open(CACHE_NAME);
        return (await cache.match(cacheUrlFor(id))) !== undefined;
      } catch {
        return false;
      }
    },

    async remove(id: string): Promise<void> {
      if (!isCacheApiSupported()) return;
      try {
        const cache = await caches.open(CACHE_NAME);
        await cache.delete(cacheUrlFor(id));
      } catch {
        // missing entry is fine - remove is best-effort
      }
    },

    async clear(): Promise<void> {
      if (!isCacheApiSupported()) return;
      try {
        await caches.delete(CACHE_NAME);
      } catch {
        // cache may not exist - that's fine
      }
    },
  };
}

/** the default resolver chain: OPFS first, Cache API fallback. */
export function defaultBytesChain(): BytesBackend[] {
  return [createOpfsBackend(), createCacheBackend()];
}

/**
 * write bytes through the chain, trying each backend in order until one
 * accepts the write. returns the name of the backend that succeeded, or
 * null if every backend in the chain refused/failed - callers must treat
 * that as a hard failure (a record with bytes nowhere is worse than no
 * record at all).
 */
export async function writeThroughChain(
  chain: BytesBackend[],
  id: string,
  data: ArrayBuffer,
  mime: string
): Promise<BytesBackendName | null> {
  for (const backend of chain) {
    if (!(await backend.isAvailable())) continue;
    if (await backend.write(id, data, mime)) return backend.name;
  }
  return null;
}

/**
 * read bytes given a known backend (from `storage_backend` on the
 * record), or by probing the chain in order when the backend is unknown
 * (legacy records predating that field).
 */
export async function readThroughChain(
  chain: BytesBackend[],
  id: string,
  knownBackend?: BytesBackendName
): Promise<ArrayBuffer | null> {
  if (knownBackend) {
    const backend = chain.find((b) => b.name === knownBackend);
    if (backend) {
      const data = await backend.read(id);
      if (data) return data;
    }
  }
  for (const backend of chain) {
    const data = await backend.read(id);
    if (data) return data;
  }
  return null;
}

/** true if any backend in the chain actually holds bytes for `id`. */
export async function hasBytesInChain(
  chain: BytesBackend[],
  id: string,
  knownBackend?: BytesBackendName
): Promise<boolean> {
  if (knownBackend) {
    const backend = chain.find((b) => b.name === knownBackend);
    if (backend && (await backend.has(id))) return true;
  }
  for (const backend of chain) {
    if (await backend.has(id)) return true;
  }
  return false;
}

/** remove bytes for `id` from every backend in the chain (a record may
 *  have been rewritten across backends over its lifetime; removing from
 *  all of them avoids leaking orphaned bytes). */
export async function removeFromChain(chain: BytesBackend[], id: string): Promise<void> {
  await Promise.all(chain.map((backend) => backend.remove(id)));
}
