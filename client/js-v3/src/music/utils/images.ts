// utility functions for handling music entity images

import { getCurrentRemote } from "../data";
import type { ImageMetadata } from "../data/types";
import { getBlobObjectURL } from "../services/storage/blobs";

// cache for local blob object URLs to avoid recreating them
const localBlobURLCache = new Map<string, string>();

/**
 * internal helper: get image URL from a blob ID using current remote
 * handles remote URLs, local blob IDs (from OPFS/Cache), and full URLs
 * @param blobId - the blob ID or full URL
 * @internal - use getImageUrl() instead
 */
async function getBlobImageUrl(
  blobId: string | null | undefined,
): Promise<string | null> {
  if (!blobId) return null;

  // trim whitespace in case there are any issues
  const trimmedBlobId = blobId.trim();

  // if already a full URL, return as-is
  if (trimmedBlobId.startsWith('http://') || trimmedBlobId.startsWith('https://')) {
    return trimmedBlobId;
  }

  // check if this is a local blob ID (sha256 hash)
  // sha256 hashes are 64 hex chars, no slashes or special chars
  const isSha256 = /^[a-f0-9]{64}$/i.test(trimmedBlobId);
  
  if (isSha256) {
    // local blob - get from OPFS/Cache storage
    if (localBlobURLCache.has(trimmedBlobId)) {
      return localBlobURLCache.get(trimmedBlobId)!;
    }
    
    const objectURL = await getBlobObjectURL(trimmedBlobId);
    if (objectURL) {
      localBlobURLCache.set(trimmedBlobId, objectURL);
    }
    return objectURL;
  }

  // not a sha256 hash - assume it's a remote blob ID, construct URL
  const remote = getCurrentRemote();
  if (!remote) return null;

  return `${remote.base_url}/api/blobs/${trimmedBlobId}`;
}

/**
 * get primary image URL from an images array
 * falls back to first image if no primary is set
 */
export async function getPrimaryImageUrl(images: ImageMetadata[] | null | undefined): Promise<string | null> {
  if (!images) return null;
  
  // handle case where images might be stored as non-array (shouldn't happen but be defensive)
  if (!Array.isArray(images)) {
    console.warn("images is not an array:", images);
    return null;
  }
  
  if (images.length === 0) return null;

  // find primary image, or use first one
  const primaryImage = images.find((img) => img.is_primary === 1);
  const blobId = primaryImage?.blob_id || images[0]?.blob_id;

  return await getBlobImageUrl(blobId);
}

/**
 * get image URL from either a blob ID or images array
 * useful for cases where we might have either format
 * handles remote URLs, local blob IDs (from OPFS/Cache), and full URLs
 */
export async function getImageUrl(
  source: string | ImageMetadata[] | null | undefined
): Promise<string | null> {
  if (!source) return null;

  if (typeof source === "string") {
    return await getBlobImageUrl(source);
  }

  return await getPrimaryImageUrl(source);
}
