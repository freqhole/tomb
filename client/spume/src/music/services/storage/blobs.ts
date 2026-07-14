// blob storage - thin wrapper over @freqhole/reliquary/blobs, preserving
// spume's existing free-function api and its "freqhole_blobs" IndexedDB
// database name so on-disk browser data keeps resolving unchanged.
//
// one real behavior change worth knowing: ids returned by storeBlob() are
// now blake3 hex digests (reliquary's canonical scheme) instead of sha256
// - safe here because these ids (`local_blob_id` throughout the app) are
// purely a local caching key, never compared against a server-provided
// hash elsewhere (the server's own blob id, `remote_blob_id`, is already
// tracked as a separate field wherever both exist - see
// music/services/sync/syncSongToLocal.ts). both algorithms produce the
// same 64-hex-character format, so no format/length assumption elsewhere
// breaks either. old sha256-keyed records already on disk keep resolving
// via reliquary's resolver chain (primary key -> blake3 index -> sha256
// index), so existing local caches are not invalidated by this change.
//
// getCachedBlobObjectURL has no equivalent on reliquary's BlobStore (its
// own getBlobObjectURL is always async) - this file keeps its own small
// mirror cache, populated whenever getBlobObjectURL resolves an id, so
// synchronous-only lookups keep working exactly as before.
//
// closeBlobDB is kept as a no-op: reliquary's underlying db layer opens a
// fresh IndexedDB connection per operation and closes it immediately
// after (never holds a persistent connection the way the old
// single-instance-per-page implementation did), so the "close before
// delete" step callers used to need is no longer necessary - kept as a
// harmless no-op rather than touched at its one call site
// (settings/services/storageManager.ts's "clear all data" reset flow),
// since that flow is not something to lightly modify without very
// thorough testing.

import { createBlobStore, type BlobRecord } from "@freqhole/reliquary/blobs";

export const BLOB_DB_NAME = "freqhole_blobs";

export type BlobStorageType = "opfs" | "cache";
export type { BlobRecord };

const store = createBlobStore({
  dbName: BLOB_DB_NAME,
  // preserves the old implementation's opfs-or-cache-api fallback
  // behavior (it always wrote to whichever backend was available).
  allowCacheFallback: true,
});

const syncUrlCache = new Map<string, string>();

/**
 * store a blob locally and return its id (a blake3 hex digest - see the
 * file header for why the sha256 -> blake3 id change is safe here).
 * automatically chooses OPFS or Cache API based on availability.
 */
export async function storeBlob(data: Blob, mimeType: string): Promise<string> {
  const buffer = await data.arrayBuffer();
  const record = await store.storeBlob(buffer, {
    // no filename concept existed in the old signature (data: Blob, not
    // File) - reliquary requires one, so a fixed placeholder is used; it
    // is not read by any existing caller.
    filename: "blob",
    mime: mimeType,
  });
  return record.blob_id;
}

/**
 * get blob metadata by ID (accepts a blake3 id, or a legacy sha256 id
 * from a record stored before this file adopted reliquary's store).
 */
export async function getBlobMetadata(blobId: string): Promise<BlobRecord | null> {
  return store.resolveBlob(blobId);
}

/**
 * get blob data by ID.
 */
export async function getBlob(blobId: string): Promise<Blob | null> {
  return store.getBlob(blobId);
}

/**
 * get blob object URL by ID, cached to avoid repeated OPFS reads and URL creations.
 * returns an object URL string usable directly in an img src.
 * URLs are cached for the session and revoked on page unload.
 */
export async function getBlobObjectURL(blobId: string): Promise<string | null> {
  if (!blobId) return null;
  const url = await store.getBlobObjectURL(blobId);
  if (url) syncUrlCache.set(blobId, url);
  return url;
}

/**
 * synchronous blob URL cache lookup (no OPFS read).
 * returns cached object URL if available, null otherwise.
 */
export function getCachedBlobObjectURL(blobId: string): string | null {
  if (!blobId) return null;
  return syncUrlCache.get(blobId) ?? null;
}

/**
 * clear all cached blob URLs and revoke object URLs
 */
export function clearBlobUrlCache(): void {
  store.clearBlobUrlCache();
  syncUrlCache.clear();
}

/**
 * delete a blob by ID (metadata + underlying bytes).
 */
export async function deleteBlob(blobId: string): Promise<void> {
  await store.deleteBlob(blobId);
  syncUrlCache.delete(blobId);
}

/**
 * close database connection - a no-op now (see file header); kept so
 * settings/services/storageManager.ts's reset flow needs no changes.
 */
export function closeBlobDB(): void {}

