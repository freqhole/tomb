// video blob access — resolves a playable URL for a QueuedVideo.
//
// two sources: a locally-imported video (browser OPFS, no server
// involved) or a server-backed video (grimoire's video domain), resolved
// via the existing `resolveBlobUrl` remote transport path (same
// P2P/Tauri/HTTP resolution songs already use for remote playback). see
// docs/video-domain-plan.md phase 9 for scope notes.

import type { BlobProgressCallback } from "@freqhole/api-client";
import { resolveBlobUrl, usesBlobResolver } from "../../music/services/storage/blobResolver";
import { getCachedBlob, preCacheBlob } from "../../music/services/cache/blobCache";
import { getClientForRemote } from "../../app/api/client";
import { getRemoteById } from "../../app/services/remotes/remoteManager";
import type { QueuedVideo } from "../../app/services/storage/mediaItem";
import { readVideoFromOPFS } from "./opfs/helpers";
import { getLocalVideoById } from "./storage/db/videos";
import { warn } from "../../utils/logger";

/** resolve the media_blob_id to actually play for a remote video: the
 * first available transcoded rendition, if the server has produced one,
 * else the original blob. failures fall back to the original silently
 * (rendition playback is a nice-to-have, never a hard requirement).
 * exported so `syncVideoToLocal` can sync whichever blob is actually
 * played, without re-deriving this selection logic. */
export async function resolvePlaybackBlobId(video: QueuedVideo, remoteId: string): Promise<string> {
  const mediaBlobId = video.media_blob_id!;
  try {
    const remote = await getRemoteById(remoteId);
    if (!remote) return mediaBlobId;
    const client = await getClientForRemote(remote);
    const result = await client.video.getVideoRenditions({ media_blob_id: mediaBlobId });
    if (result.success) {
      // "skipped" entries are synthesized placeholders (empty blob_id)
      // for rendition targets the transcode job decided not to produce
      // (source already compatible) - never actually playable blobs.
      const playable = result.data.find((r) => !r.skipped && r.blob_id);
      if (playable) {
        return playable.blob_id;
      }
    }
  } catch (err) {
    warn("videoBlobAccess", `failed to resolve renditions for ${mediaBlobId}:`, err);
  }
  return mediaBlobId;
}

export async function getVideoURL(
  video: QueuedVideo,
  onProgress?: BlobProgressCallback
): Promise<string> {
  if (video.source_type === "local") {
    if (!video.opfs_path) {
      throw new Error(`local video has no opfs_path (id=${video.id})`);
    }
    const file = await readVideoFromOPFS(video.opfs_path);
    return URL.createObjectURL(file);
  }

  // a remote video may have since been synced to local storage (see
  // syncVideoToLocal.ts) without the in-memory queue item's source_type
  // being updated - check the local library by id first so a synced
  // copy is served from disk instead of re-fetched remotely.
  const localCopy = await getLocalVideoById(video.id);
  if (localCopy?.opfs_path) {
    const file = await readVideoFromOPFS(localCopy.opfs_path);
    return URL.createObjectURL(file);
  }

  if (!video.media_blob_id) {
    throw new Error(`video has no media_blob_id (id=${video.id})`);
  }
  if (!video.remote_server_id) {
    throw new Error(`remote video has no remote_server_id (id=${video.id})`);
  }
  const remoteId = video.remote_server_id;
  const blobId = await resolvePlaybackBlobId(video, remoteId);

  // P2P/tauri-managed remotes: resolveBlobUrl already checks the Cache
  // API before fetching from the peer.
  if (await usesBlobResolver(remoteId)) {
    return resolveBlobUrl(blobId, remoteId, "video", onProgress);
  }

  // plain HTTP remote: resolveBlobUrl returns a raw direct URL for this
  // transport with no cache check, so check our own blob cache first -
  // otherwise an already pre-cached video (see videoPreCache.ts's
  // rolling window) would still be re-fetched over the network on play.
  const cachedResponse = await getCachedBlob(remoteId, blobId);
  if (cachedResponse) {
    const blob = await cachedResponse.blob();
    return URL.createObjectURL(blob);
  }

  const remote = await getRemoteById(remoteId);
  if (!remote?.base_url) {
    throw new Error(`remote ${remoteId} has no base_url`);
  }
  const directUrl = `${remote.base_url}/api/blobs/${blobId}`;
  // stream directly now, and cache in the background for next time
  // (mirrors audioAccess.ts's HTTP-remote song path)
  void preCacheBlob(directUrl, "video", remoteId, blobId, 3, video.id);
  return directUrl;
}
