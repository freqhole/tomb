// video blob access — resolves a playable URL for a QueuedVideo.
//
// two sources: a locally-imported video (browser OPFS, no server
// involved) or a server-backed video (grimoire's video domain), resolved
// via the existing `resolveBlobUrl` remote transport path (same
// P2P/Tauri/HTTP resolution songs already use for remote playback). see
// docs/video-domain-plan.md phase 9 for scope notes.

import type { BlobProgressCallback } from "@freqhole/api-client";
import { resolveBlobUrl } from "../../music/services/storage/blobResolver";
import { getClientForRemote } from "../../app/api/client";
import { getRemoteById } from "../../app/services/remotes/remoteManager";
import type { QueuedVideo } from "../../app/services/storage/mediaItem";
import { readVideoFromOPFS } from "./opfs/helpers";
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
    if (result.success && result.data.length > 0) {
      return result.data[0].blob_id;
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
  if (!video.media_blob_id) {
    throw new Error(`video has no media_blob_id (id=${video.id})`);
  }
  if (!video.remote_server_id) {
    throw new Error(`remote video has no remote_server_id (id=${video.id})`);
  }
  const blobId = await resolvePlaybackBlobId(video, video.remote_server_id);
  return resolveBlobUrl(blobId, video.remote_server_id, "video", onProgress);
}
