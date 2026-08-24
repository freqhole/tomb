// video blob access — resolves a playable URL for a QueuedVideo.
//
// two sources: a locally-imported video (browser OPFS, no server
// involved) or a server-backed video (grimoire's video domain), resolved
// via the existing `resolveBlobUrl` remote transport path (same
// P2P/Tauri/HTTP resolution songs already use for remote playback). see
// docs/video-domain-plan.md phase 9 for scope notes.

import type { BlobProgressCallback } from "@freqhole/api-client";
import { resolveBlobUrl } from "../../music/services/storage/blobResolver";
import type { QueuedVideo } from "../../app/services/storage/mediaItem";
import { readVideoFromOPFS } from "./opfs/helpers";

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
  return resolveBlobUrl(video.media_blob_id, video.remote_server_id, "video", onProgress);
}
