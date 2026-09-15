// once a locally-imported "add media" video review session is fully
// reviewed, send its videos to the real target remote it was originally
// destined for (see pendingSendTargets.ts) - reuses sendVideoToRemote.ts's
// sync mechanism, mirroring sendReviewedSessionToRemote.ts's album/song
// equivalent for music.
//
// no toasts here - progress is reported structurally via `onProgress` so
// the review modal can render it inline, plus mirrored into the same
// video upload-job store the add-media modal displays, for a persistent
// record after the modal closes.
//
// reuses music's `SendReviewProgress` shape (album/song field names)
// rather than a video-specific one: one video maps to one "album" slot
// (currentSongsTotal fixed at 1) so this stays compatible with the shared
// reducer/registry (`importSessionReducer.ts`) music's flow already uses -
// see docs/add-media-review-refactor-plan.md §8's unification strategy.
import { RemoteVideoDataSource } from "../../../video/data/remote/remoteSource";
import {
  sendVideosToRemote,
  type SendVideoItem,
} from "../../../video/services/send/sendVideoToRemote";
import {
  addTrackedJob,
  updateJobStatus,
  updateJobProgress,
} from "../../../video/import/remoteImport";
import type { Remote } from "../storage/schemas/remote";
import { getRemoteById } from "../remotes/remoteManager";
import { getClientForRemote } from "../../api/client";
import { clearPendingSendTarget } from "./pendingSendTargets";
import { error as logError } from "../../../utils/logger";
import { emptyProgress, type SendReviewProgress } from "./sendReviewProgress";

export type { SendReviewProgress };
export { emptyProgress };

/**
 * send every video in `videoIds` (already imported into `localRemote`) to
 * `targetRemoteId`, reporting progress via `onProgress`. best-effort per
 * video - one failing video doesn't stop the rest from being attempted.
 *
 * `keepPendingTarget`: see `sendReviewedAlbumsToRemote`'s identical param -
 * set when `videoIds` is deliberately a subset of the session's full list.
 */
export async function sendReviewedVideosToRemote(
  sessionId: string,
  targetRemoteId: string,
  targetRemoteName: string,
  localRemote: Remote,
  videoIds: string[],
  onProgress?: (progress: SendReviewProgress) => void,
  keepPendingTarget = false
): Promise<void> {
  const progress = emptyProgress(targetRemoteName, videoIds.length);
  const emit = () => onProgress?.({ ...progress });

  if (videoIds.length === 0) {
    progress.done = true;
    emit();
    if (!keepPendingTarget) clearPendingSendTarget(sessionId);
    return;
  }

  const dest = await getRemoteById(targetRemoteId);
  if (!dest) {
    progress.errors.push(`couldn't find ${targetRemoteName} to send to`);
    progress.done = true;
    emit();
    if (!keepPendingTarget) clearPendingSendTarget(sessionId);
    return;
  }
  emit();

  const localSource = new RemoteVideoDataSource(localRemote);

  for (const videoId of videoIds) {
    let trackId: string | null = null;
    try {
      const video = await localSource.getVideoById(videoId);
      if (!video) {
        progress.completedAlbums += 1;
        emit();
        continue;
      }
      progress.currentAlbumTitle = video.title;
      progress.currentSongsDone = 0;
      progress.currentSongsTotal = 1;
      emit();

      trackId = addTrackedJob(`${video.title} \u2192 ${targetRemoteName}`, localRemote.remote_id);
      updateJobStatus(trackId, "uploading");

      // blake3/sha256/size live on the media blob, not denormalized onto
      // the video row - same lookup syncVideoToLocal.ts's fetchBlobMetadata
      // does for the pull direction.
      const client = await getClientForRemote(localRemote);
      const metaResp = await client.music.blobMetadata({ id: video.media_blob_id });
      const meta = metaResp.success ? metaResp.data : undefined;

      const item: SendVideoItem = {
        video,
        blobId: video.media_blob_id,
        blake3: meta?.blake3 ?? null,
        sha256: meta?.sha256 ?? null,
        size: meta?.size ?? null,
        mime: meta?.mime ?? null,
      };

      const result = await sendVideosToRemote([item], localRemote, dest, {
        onProgress: (p) => {
          const done = p.syncedVideos + p.skippedVideos + p.failedVideos;
          progress.currentSongsDone = done > 0 ? 1 : 0;
          emit();
          if (trackId) updateJobProgress(trackId, done > 0 ? 1 : 0);
        },
      });
      progress.completedAlbums += 1;
      if (result.failedVideos > 0) {
        progress.failedAlbums += 1;
        progress.errors.push(`${video.title}: ${result.errors[0] ?? "send failed"}`);
      }
      updateJobStatus(
        trackId,
        result.failedVideos > 0 ? "failed" : "completed",
        result.failedVideos > 0
          ? { error: result.errors[0] ?? "send failed", errorFull: result.errors.join("; ") }
          : undefined
      );
    } catch (e) {
      progress.completedAlbums += 1;
      progress.failedAlbums += 1;
      const msg = String(e);
      progress.errors.push(msg);
      if (trackId) updateJobStatus(trackId, "failed", { error: msg });
      logError("sendReviewedVideosToRemote", `video ${videoId} send failed: ${msg}`);
    }
    emit();
  }

  progress.currentAlbumTitle = null;
  progress.done = true;
  emit();
  if (!keepPendingTarget) clearPendingSendTarget(sessionId);
}
