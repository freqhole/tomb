// local-only image utilities for OPFS/Cache blob resolution
// remote sources should return full URLs directly from server

import type { ImageMetadata } from "../data/types";
import { getBlobObjectURL } from "../services/storage/blobs";

// cache for local blob object URLs to avoid recreating them
const localBlobURLCache = new Map<string, string>();

// HACK: clear cache on vite HMR to prevent stale blob URLs
// this is ugly and shouldn't be necessary - the real fix is one of:
// 1. don't cache object URLs at all, cache Blob objects instead
// 2. properly revoke URLs and manage lifecycle
// 3. use a different caching strategy tied to component lifecycle
// 4. investigate why blob objects get GC'd on hot reload
// for now this makes dev bearable but is NOT a proper solution
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    localBlobURLCache.clear();
  });
}

/**
 * resolve local blob ID to object URL
 * only for local OPFS/Cache blobs - remote sources handle their own URLs
 */
export async function resolveLocalBlobUrl(
  blobId: string | null | undefined,
): Promise<string | null> {
  if (!blobId) return null;

  // check cache first
  if (localBlobURLCache.has(blobId)) {
    return localBlobURLCache.get(blobId)!;
  }

  // get from OPFS/Cache storage and create object URL
  const objectURL = await getBlobObjectURL(blobId);
  if (objectURL) {
    localBlobURLCache.set(blobId, objectURL);
  }
  return objectURL;
}

/**
 * get primary image blob_id from images array
 * falls back to first image if no primary is set
 */
export function getPrimaryImageBlobId(
  images: ImageMetadata[] | null | undefined,
): string | null {
  if (!images || images.length === 0) return null;

  const primaryImage = images.find((img) => img.is_primary === 1);
  return primaryImage?.blob_id || images[0]?.blob_id || null;
}
