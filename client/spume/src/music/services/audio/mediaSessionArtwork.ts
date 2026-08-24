// media session artwork resolution
// separate file to avoid circular dependency with blobResolver

import { resolveBlobUrl } from "../storage/blobResolver";
import { getBlobObjectURL } from "../storage/blobs";
import { getSongDisplayImages, pickBestImage } from "../../../utils/images";
import { debug } from "../../../utils/logger";
import type { Song } from "../storage/types";
import type { QueuedVideo } from "../../../app/services/storage/mediaItem";
import { readVideoPosterFromOPFS } from "../../../video/services/opfs/helpers";

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

// video posters aren't stored in the blob store's object-url cache the way
// local song artwork is (they live at an arbitrary OPFS path), so cache the
// single most-recently-resolved local poster ourselves to avoid re-reading
// OPFS and leaking object urls on every media-session metadata refresh.
let lastLocalPosterPath: string | null = null;
let lastLocalPosterUrl: string | null = null;

/** get artwork URLs for media session for the currently-playing video. */
export async function getMediaSessionArtworkForVideo(video: QueuedVideo): Promise<MediaImage[]> {
  const makeArtwork = (src: string): MediaImage[] => [
    { src, sizes: "512x512", type: "image/jpeg" },
    { src, sizes: "256x256", type: "image/jpeg" },
    { src, sizes: "96x96", type: "image/jpeg" },
  ];

  if (video.source_type === "local") {
    const path = video.poster_opfs_path ?? null;
    if (!path) return [];
    if (path === lastLocalPosterPath && lastLocalPosterUrl) {
      return makeArtwork(lastLocalPosterUrl);
    }
    try {
      const file = await readVideoPosterFromOPFS(path);
      if (lastLocalPosterUrl) URL.revokeObjectURL(lastLocalPosterUrl);
      lastLocalPosterUrl = URL.createObjectURL(file);
      lastLocalPosterPath = path;
      return makeArtwork(lastLocalPosterUrl);
    } catch (err) {
      debug("mediaSession", "failed to read local video poster:", err);
      return [];
    }
  }

  // remote: same P2P/tauri transport resolution the song path uses.
  if (video.poster_blob_id && video.remote_server_id) {
    try {
      const url = await resolveBlobUrl(video.poster_blob_id, video.remote_server_id, "image");
      if (url) return makeArtwork(url);
    } catch (err) {
      debug("mediaSession", "failed to resolve remote video poster:", err);
    }
  }

  return [];
}
