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
  updateJobEntities,
} from "../../../video/import/remoteImport";
import type { Remote } from "../storage/schemas/remote";
import { getRemoteById } from "../remotes/remoteManager";
import { getClientForRemote } from "../../api/client";
import { clearPendingSendTarget } from "./pendingSendTargets";
import { error as logError } from "../../../utils/logger";
import { emptyProgress, type SendReviewProgress } from "./sendReviewProgress";
import { getLocalBrowserSourceRemote } from "../../../music/services/send/localBrowserSource";
import { getLocalVideoById } from "../../../video/services/storage/db/videos";
import type { CurrentRemoteInfo } from "../../../music/data/currentState";
import { getLocalVideoImportSession } from "../../../video/services/storage/db/importReview";

async function videoSendItem(
  videoId: string,
  localRemote: CurrentRemoteInfo | null
): Promise<SendVideoItem> {
  if (!localRemote) {
    const video = await getLocalVideoById(videoId);
    if (!video) throw new Error("video no longer found locally");
    return {
      video: { ...video, images: undefined },
      blobId: video.id,
      blake3: video.blake3 ?? null,
      size: video.file_size,
      mime: video.mime_type,
    };
  }
  const video = await new RemoteVideoDataSource(localRemote).getVideoById(videoId);
  if (!video) throw new Error("video no longer found locally");
  const metadata = await (
    await getClientForRemote(localRemote)
  ).music.blobMetadata({ id: video.media_blob_id });
  if (!metadata.success)
    throw new Error(metadata.error?.issues?.[0]?.message ?? "video metadata unavailable");
  return {
    video,
    blobId: video.media_blob_id,
    blake3: metadata.data.blake3 ?? null,
    size: metadata.data.size,
    mime: metadata.data.mime,
  };
}

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
  localRemote: CurrentRemoteInfo | null,
  videoIds: string[],
  onProgress?: (progress: SendReviewProgress) => void,
  keepPendingTarget = false
): Promise<void> {
  if (!localRemote && !keepPendingTarget) {
    try {
      videoIds = (await getLocalVideoImportSession(sessionId)).video_ids;
    } catch (error) {
      const progress = emptyProgress(targetRemoteName, videoIds.length, "videos");
      progress.errors.push(String(error));
      progress.done = true;
      onProgress?.(progress);
      return;
    }
  }
  const progress = emptyProgress(targetRemoteName, videoIds.length, "videos");
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

  let source: Remote;
  try {
    const resolved = localRemote
      ? await getRemoteById(localRemote.remote_id)
      : await getLocalBrowserSourceRemote();
    if (!resolved) throw new Error("review library no longer exists");
    source = resolved;
  } catch (error) {
    progress.errors.push(String(error));
    progress.done = true;
    emit();
    return;
  }

  for (const videoId of videoIds) {
    let trackId: string | null = null;
    try {
      const item = await videoSendItem(videoId, localRemote);
      const video = item.video;
      progress.currentAlbumTitle = video.title;
      progress.currentSongsDone = 0;
      progress.currentSongsTotal = 1;
      emit();

      trackId = addTrackedJob(`${video.title} \u2192 ${targetRemoteName}`, targetRemoteId);
      updateJobStatus(trackId, "uploading");
      updateJobEntities(trackId, { videoId, sessionId, isRemoteSend: true });

      if (!item.blake3) throw new Error("video has no content hash; re-import it before sending");
      const result = await sendVideosToRemote([item], source, dest, {
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

/**
 * retry a previously-failed "send to remote" job for one video, in place -
 * mirrors music's `retryFailedAlbumSend`, but simpler: video sends are
 * already one-item-at-a-time (`sendVideosToRemote([item], ...)`), so
 * "retry" just means re-running that same single-item send rather than
 * needing a `retryBlake3s` subset.
 */
export async function retryFailedVideoSend(
  trackId: string,
  videoId: string,
  targetRemoteId: string,
  targetRemoteName: string,
  localRemote: CurrentRemoteInfo | null
): Promise<void> {
  const dest = await getRemoteById(targetRemoteId);
  if (!dest) {
    updateJobStatus(trackId, "failed", { error: `couldn't find ${targetRemoteName} to send to` });
    return;
  }

  updateJobStatus(trackId, "uploading");
  try {
    const source = localRemote
      ? await getRemoteById(localRemote.remote_id)
      : await getLocalBrowserSourceRemote();
    if (!source) throw new Error("review library no longer exists");
    const item = await videoSendItem(videoId, localRemote);
    if (!item.blake3) throw new Error("video has no content hash; re-import it before sending");

    const result = await sendVideosToRemote([item], source, dest, {
      onProgress: (p) => {
        const done = p.syncedVideos + p.skippedVideos + p.failedVideos;
        updateJobProgress(trackId, done > 0 ? 1 : 0);
      },
    });
    updateJobStatus(
      trackId,
      result.failedVideos > 0 ? "failed" : "completed",
      result.failedVideos > 0
        ? { error: result.errors[0] ?? "send failed", errorFull: result.errors.join("; ") }
        : undefined
    );
  } catch (e) {
    const msg = String(e);
    updateJobStatus(trackId, "failed", { error: msg });
    logError("retryFailedVideoSend", `video ${videoId} retry failed: ${msg}`);
  }
}
