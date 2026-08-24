// video blob access — resolves a playable URL for a QueuedVideo.
//
// unlike songs, videos have no "local OPFS library" concept yet (no
// video import pipeline exists) — video content is always server-backed
// (grimoire's video domain), so every video is resolved via the existing
// `resolveBlobUrl` remote transport path (same P2P/Tauri/HTTP resolution
// songs already use for remote playback). see docs/video-domain-plan.md
// phase 9 for scope notes.

import type { BlobProgressCallback } from "@freqhole/api-client";
import { resolveBlobUrl } from "../../music/services/storage/blobResolver";
import type { QueuedVideo } from "../../app/services/storage/mediaItem";

export async function getVideoURL(
  video: QueuedVideo,
  onProgress?: BlobProgressCallback
): Promise<string> {
  if (!video.media_blob_id) {
    throw new Error(`video has no media_blob_id (id=${video.id})`);
  }
  if (!video.remote_server_id) {
    throw new Error(`video has no remote_server_id (id=${video.id})`);
  }
  return resolveBlobUrl(video.media_blob_id, video.remote_server_id, "video", onProgress);
}
