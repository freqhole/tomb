// shared "stage + map to wire shape" helper for the `images` field shared
// by SongQueryResult's song/artist/album and VideosQueryResult's video
// entries (all three inline the exact same z.object shape - see
// codegen/schema.ts, no shared `Image` type is generated for it).

import { getBlob } from "../../music/services/storage/blobs";
import { ensureBlobServable } from "./blobServing";
import type { ImageMetadata } from "../../music/services/storage/types";

export interface ApiImage {
  blob_id: string;
  is_primary: number;
  blob_type: "original" | "thumbnail" | "waveform" | "preview" | "rendition" | "subtitle";
}

/** maps + stages `images` for wire serving. only images this browser peer
 * actually holds bytes for (`local_blob_id` set - already a blake3 hex
 * digest, reliquary's `storeBlob()` scheme) can be advertised; images that
 * only carry a `remote_blob_id`/`remote_url` (originally synced in from a
 * THIRD peer) are skipped - this peer has no bytes of its own to stage for
 * those, and advertising them would 404 on fetch. */
export async function stageAndMapImages(
  images: ImageMetadata[] | undefined
): Promise<ApiImage[] | undefined> {
  if (!images || images.length === 0) return undefined;

  const result: ApiImage[] = [];
  for (const img of images) {
    if (!img.local_blob_id) continue;
    const blobId = img.local_blob_id;
    await ensureBlobServable(blobId, () => getBlob(blobId));
    result.push({ blob_id: blobId, is_primary: img.is_primary ? 1 : 0, blob_type: img.blob_type });
  }
  return result.length > 0 ? result : undefined;
}
