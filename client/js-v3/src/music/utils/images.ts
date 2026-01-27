// local-only image utilities for OPFS/Cache blob resolution
// remote sources should return full URLs directly from server

import type { ImageMetadata } from "../services/storage/types";
import { getBlobObjectURL } from "../services/storage/blobs";

/**
 * resolve local blob ID to object URL
 * only for local OPFS/Cache blobs - remote sources handle their own URLs
 * 
 * creates a fresh blob URL each time - URLs are stored on data objects (song.thumbnail_url)
 * so no need for global caching
 */
export async function resolveLocalBlobUrl(
  blobId: string | null | undefined,
): Promise<string | null> {
  if (!blobId) return null;
  const blob = await getBlobObjectURL(blobId);
  if (!blob) return null;
  return URL.createObjectURL(blob);
}



/**
 * get primary image blob_id from images array
 * falls back to first image if no primary is set
 */
export function getPrimaryImageBlobId(
  images: ImageMetadata[] | null | undefined,
): string | null {
  if (!images || images.length === 0) return null;

  const primaryImage = images.find((img) => img.is_primary === true);
  return primaryImage?.local_blob_id || images[0]?.local_blob_id || null;
}
