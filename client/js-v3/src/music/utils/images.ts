// utility functions for handling music entity images

import { getCurrentRemote } from "../data";
import type { ImageMetadata } from "../data/types";

/**
 * internal helper: get image URL from a blob ID using current remote
 * handles both full URLs (from remote sources) and raw blob IDs (from local source)
 * @param blobId - the blob ID or full URL
 * @internal - use getImageUrl() instead
 */
function getBlobImageUrl(
  blobId: string | null | undefined,
): string | null {
  if (!blobId) return null;

  // trim whitespace in case there are any issues
  const trimmedBlobId = blobId.trim();

  // if already a full URL, return as-is
  if (trimmedBlobId.startsWith('http://') || trimmedBlobId.startsWith('https://')) {
    return trimmedBlobId;
  }

  // for local blob IDs, use current remote to construct URL
  const remote = getCurrentRemote();
  if (!remote) return null;

  return `${remote.base_url}/api/blobs/${trimmedBlobId}`;
}

/**
 * get primary image URL from an images array
 * falls back to first image if no primary is set
 */
export function getPrimaryImageUrl(images: ImageMetadata[] | null | undefined): string | null {
  if (!images || images.length === 0) return null;

  // find primary image, or use first one
  const primaryImage = images.find((img) => img.is_primary === 1);
  const blobId = primaryImage?.blob_id || images[0]?.blob_id;

  return getBlobImageUrl(blobId);
}

/**
 * get image URL from either a blob ID or images array
 * useful for cases where we might have either format
 * handles both full URLs (from remote) and raw blob IDs (from local)
 */
export function getImageUrl(
  source: string | ImageMetadata[] | null | undefined
): string | null {
  if (!source) return null;

  if (typeof source === "string") {
    return getBlobImageUrl(source);
  }

  return getPrimaryImageUrl(source);
}
