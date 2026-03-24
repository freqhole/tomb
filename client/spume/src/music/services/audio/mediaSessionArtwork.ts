// media session artwork resolution
// separate file to avoid circular dependency with blobResolver

import { resolveBlobUrl } from "../storage/blobResolver";
import { getBlobObjectURL } from "../storage/blobs";
import { getSongDisplayImages, pickBestImage } from "../../../utils/images";
import { debug } from "../../../utils/logger";
import type { Song } from "../storage/types";

// get artwork URL for media session (async - may need to fetch from local storage or P2P)
export async function getMediaSessionArtwork(song: Song): Promise<MediaImage[]> {
  const images = getSongDisplayImages(song);
  const bestImage = pickBestImage(images);
  if (!bestImage) return [];

  // helper to create MediaImage array from a URL
  const makeArtwork = (src: string): MediaImage[] => [
    { src, sizes: "512x512", type: "image/jpeg" },
    { src, sizes: "256x256", type: "image/jpeg" },
    { src, sizes: "96x96", type: "image/jpeg" },
  ];

  // priority 1: local blob if available (OPFS/cache)
  if (bestImage.local_blob_id) {
    const objectUrl = await getBlobObjectURL(bestImage.local_blob_id);
    if (objectUrl) {
      return makeArtwork(objectUrl);
    }
  }

  // priority 2: remote blob via P2P/Tauri transport (resolveBlobUrl handles caching)
  if (bestImage.remote_blob_id && bestImage.remote_server_id) {
    try {
      const url = await resolveBlobUrl(
        bestImage.remote_blob_id,
        bestImage.remote_server_id,
        "image"
      );
      if (url) {
        return makeArtwork(url);
      }
    } catch (err) {
      debug("mediaSession", "failed to resolve P2P artwork:", err);
      // fall through to remote_url
    }
  }

  // priority 3: remote URL (HTTP servers)
  if (bestImage.remote_url) {
    return makeArtwork(bestImage.remote_url);
  }

  return [];
}
