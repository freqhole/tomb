// persistent (opfs + indexeddb-metadata) cache for media blobs pulled from
// a remote peer - survives page reloads/restarts, unlike playbackEngine.ts's
// in-memory `blobCache` map, which this backs as an on-disk fallback. keyed
// by blake3 hash, same id `MediaRef` already carries - reliquary's blob
// store computes its own blake3 of whatever bytes it's given and uses that
// as `blob_id`, so a blob fetched here always lands under the same key a
// later lookup will ask for (see reliquary's `BlobRecord.blob_id` doc
// comment - always equal to `blake3` for records this store creates).
import { createBlobStore } from "@freqhole/reliquary/blobs";

const store = createBlobStore({ dbName: "cenotaph_blobs", allowCacheFallback: true });

export async function getCachedMediaBlob(blake3Hash: string): Promise<Blob | null> {
  return store.getBlob(blake3Hash, blake3Hash);
}

export async function cacheMediaBlob(blake3Hash: string, blob: Blob): Promise<void> {
  await store.storeBlob(await blob.arrayBuffer(), { filename: blake3Hash, mime: blob.type });
}

export async function evictCachedMediaBlob(blake3Hash: string): Promise<void> {
  await store.deleteBlob(blake3Hash);
}
