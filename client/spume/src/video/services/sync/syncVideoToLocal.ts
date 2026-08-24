// sync-to-local for remote video playback — mirrors the essential shape of
// music/services/sync/syncSongToLocal.ts, deliberately scoped down: dedup
// by the video's own id (not a content hash — `Video` has no sha256 field
// yet), no progress UI, no pause/resume, no P2P-specific optimization
// beyond what `resolveBlobUrl` already gives us for free (a P2P/charnel
// blob already fetched for playback is served from its Cache API entry,
// not re-downloaded).
//
// fired (fire-and-forget) from VideoBackend.loadAndPlay whenever a remote
// video is played and the "sync queue to local" setting is on.

import { resolveBlobUrl } from "../../../music/services/storage/blobResolver";
import { getSyncQueueToLocal } from "../../../app/services/storage/db";
import { addLocalVideo, getLocalVideoById } from "../storage/db/videos";
import { writeVideoPosterToOPFS, writeVideoToOPFS } from "../opfs/helpers";
import { resolvePlaybackBlobId } from "../videoBlobAccess";
import type { QueuedVideo } from "../../../app/services/storage/mediaItem";
import { debug, warn } from "../../../utils/logger";

const MIME_TO_EXTENSION: Record<string, string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "video/x-matroska": "mkv",
  "video/ogg": "ogv",
};

function extensionFromMime(mime: string): string {
  return MIME_TO_EXTENSION[mime] ?? "mp4";
}

/** sync the currently-playing remote video to the local OPFS-backed video
 * library, if "sync queue to local" is enabled and it hasn't already been
 * synced. syncs whichever blob is actually being played (the selected
 * rendition, if any, else the original) — the same file downloaded to
 * play, per the user's own framing. never throws; failures are logged
 * and simply skip the sync so playback is never affected. */
export async function syncVideoToLocal(video: QueuedVideo): Promise<void> {
  if (video.source_type !== "remote") return;
  if (!video.remote_server_id || !video.media_blob_id) return;
  if (!getSyncQueueToLocal()) return;

  try {
    if (await getLocalVideoById(video.id)) {
      return; // already synced
    }

    const blobId = await resolvePlaybackBlobId(video, video.remote_server_id);
    const videoUrl = await resolveBlobUrl(blobId, video.remote_server_id, "video");
    const videoResponse = await fetch(videoUrl);
    if (!videoResponse.ok) {
      warn(
        "videoSync",
        `fetch failed for video ${video.id} (status ${videoResponse.status}), skipping sync`
      );
      return;
    }
    const videoBlob = await videoResponse.blob();
    const extension = extensionFromMime(videoBlob.type);
    const opfsPath = await writeVideoToOPFS(videoBlob, video.id, extension);

    let posterOpfsPath: string | null = null;
    if (video.poster_blob_id) {
      try {
        const posterUrl = await resolveBlobUrl(
          video.poster_blob_id,
          video.remote_server_id,
          "image"
        );
        const posterResponse = await fetch(posterUrl);
        if (posterResponse.ok) {
          posterOpfsPath = await writeVideoPosterToOPFS(await posterResponse.blob(), video.id);
        }
      } catch (err) {
        warn("videoSync", `poster sync failed for video ${video.id} (non-fatal):`, err);
      }
    }

    await addLocalVideo({
      id: video.id,
      title: video.title,
      opfs_path: opfsPath,
      poster_opfs_path: posterOpfsPath,
      file_name: `${video.id}.${extension}`,
      file_size: videoBlob.size,
      mime_type: videoBlob.type || "video/mp4",
      duration_seconds: video.duration_seconds ?? null,
    });

    debug("videoSync", `synced video "${video.title}" (${video.id}) to local library`);
  } catch (err) {
    warn("videoSync", `sync-to-local failed for video ${video.id}:`, err);
  }
}
