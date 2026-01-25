// utility functions for handling music entity images

import { getCurrentRemote } from "../data";
import type { ImageMetadata } from "../data/types";

/**
 * get image URL from a blob ID using current remote
 * @param blobId - the blob ID to construct URL for
 */
export function getBlobImageUrl(
  blobId: string | null | undefined,
): string | null {
  if (!blobId) return null;

  const remote = getCurrentRemote();
  if (!remote) return null;

  return `${remote.base_url}/api/blobs/${blobId}`;
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
