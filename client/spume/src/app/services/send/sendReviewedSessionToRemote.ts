// once a locally-imported "add media" review session is fully reviewed,
// send its albums to the real target remote it was originally destined for
// (see pendingSendTargets.ts) - reuses the exact same sync mechanism as the
// share modal's "send to remote" (sendToRemote.ts), just triggered
// automatically once review completes instead of from a user click.
//
// no toasts here - progress is reported structurally via `onProgress` so
// the review modal can render it inline (see ImportReviewModal's
// `sendProgress` prop), plus mirrored into the same upload-job store the
// add-media modal displays, for a persistent record after the modal closes.
import { RemoteMusicDataSource } from "../../../music/data/remote/remoteSource";
import { sendToRemote, type SendAlbumPayload } from "../../../music/services/send/sendToRemote";
import {
  addTrackedJob,
  updateJobStatus,
  updateJobStage,
  updateJobProgress,
  updateJobEntities,
} from "../../../music/import/remoteImport";
import type { Remote } from "../storage/schemas/remote";
import { getRemoteById } from "../remotes/remoteManager";
import { clearPendingSendTarget } from "./pendingSendTargets";
import { error as logError } from "../../../utils/logger";
import { emptyProgress, type SendReviewProgress } from "./sendReviewProgress";

/** re-exported for existing importers (App.tsx, ImportReviewModal.tsx) -
 * the actual definitions live in sendReviewProgress.ts, a dependency-free
 * module `importSessionReducer.ts` can also import without dragging in
 * this file's live api-client/remote-sync machinery. */
export type { SendReviewProgress };
export { emptyProgress };

/**
 * send every album in `albumIds` (already imported into `localRemote`) to
 * `targetRemoteId`, reporting progress via `onProgress`. best-effort per
 * album - one failing album doesn't stop the rest from being attempted.
 *
 * `keepPendingTarget`: set when `albumIds` is deliberately a SUBSET of the
 * session's full album list (e.g. only the albums that don't need review
 * yet) - skips clearing the session's pendingSendTarget registration so
 * whatever's left can still be sent later once it's actually reviewed.
 */
export async function sendReviewedAlbumsToRemote(
  sessionId: string,
  targetRemoteId: string,
  targetRemoteName: string,
  localRemote: Remote,
  albumIds: string[],
  onProgress?: (progress: SendReviewProgress) => void,
  keepPendingTarget = false
): Promise<void> {
  const progress = emptyProgress(targetRemoteName, albumIds.length);
  const emit = () => onProgress?.({ ...progress });

  if (albumIds.length === 0) {
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

  const localSource = new RemoteMusicDataSource(localRemote);

  for (const albumId of albumIds) {
    let trackId: string | null = null;
    try {
      const { items: songs } = await localSource.getSongs({ album_id: albumId, limit: 1000 });
      if (songs.length === 0) {
        progress.completedAlbums += 1;
        emit();
        continue;
      }
      const first = songs[0];
      const albumTitle = first.album_title ?? "unknown album";
      progress.currentAlbumTitle = albumTitle;
      progress.currentSongsDone = 0;
      progress.currentSongsTotal = songs.length;
      emit();

      trackId = addTrackedJob(`${albumTitle} \u2192 ${targetRemoteName}`, "file");
      updateJobStatus(trackId, "uploading");
      updateJobEntities(trackId, { remoteId: targetRemoteId, albumId, sessionId });
      const payload: SendAlbumPayload = {
        kind: "album",
        albumId,
        title: albumTitle,
        artistName: first.artist_name ?? "unknown artist",
        albumType: first.album_type ?? null,
        releaseDate: null,
        label: null,
        genres: [],
        images: first.album_images ?? [],
        songs,
      };
      const result = await sendToRemote(payload, localRemote, dest, {
        onProgress: (p) => {
          const done = p.syncedSongs + p.skippedSongs + p.failedSongs;
          progress.currentSongsDone = done;
          progress.currentSongsTotal = p.totalSongs;
          emit();
          if (trackId) {
            if (p.totalSongs > 0) updateJobProgress(trackId, done / p.totalSongs);
            updateJobStage(trackId, `${done}/${p.totalSongs} songs`);
          }
        },
      });
      progress.completedAlbums += 1;
      if (result.failedSongs > 0) {
        progress.failedAlbums += 1;
        progress.errors.push(`${albumTitle}: ${result.failedSongs} song(s) failed`);
      }
      updateJobStatus(
        trackId,
        result.failedSongs > 0 ? "failed" : "completed",
        result.failedSongs > 0
          ? { error: `${result.failedSongs} song(s) failed`, errorFull: result.errors.join("; ") }
          : undefined
      );
      updateJobEntities(trackId, { retryFailedBlake3s: result.failedBlake3s });
    } catch (e) {
      progress.completedAlbums += 1;
      progress.failedAlbums += 1;
      const msg = String(e);
      progress.errors.push(msg);
      if (trackId) updateJobStatus(trackId, "failed", { error: msg });
      logError("sendReviewedAlbumsToRemote", `album ${albumId} send failed: ${msg}`);
    }
    emit();
  }

  progress.currentAlbumTitle = null;
  progress.done = true;
  emit();
  if (!keepPendingTarget) clearPendingSendTarget(sessionId);
}

/**
 * retry a previously-failed "send to remote" job for one album, in place -
 * resends only the specific blake3 hashes that failed last time (see
 * `SendOptions.retryBlake3s`) rather than starting the whole album over,
 * and updates the SAME tracked job row instead of creating a new one.
 */
export async function retryFailedAlbumSend(
  trackId: string,
  albumId: string,
  targetRemoteId: string,
  targetRemoteName: string,
  localRemote: Remote,
  failedBlake3s: string[]
): Promise<void> {
  const dest = await getRemoteById(targetRemoteId);
  if (!dest) {
    updateJobStatus(trackId, "failed", { error: `couldn't find ${targetRemoteName} to send to` });
    return;
  }

  updateJobStatus(trackId, "uploading");
  try {
    const localSource = new RemoteMusicDataSource(localRemote);
    const { items: songs } = await localSource.getSongs({ album_id: albumId, limit: 1000 });
    if (songs.length === 0) {
      updateJobStatus(trackId, "completed");
      updateJobEntities(trackId, { retryFailedBlake3s: [] });
      return;
    }
    const first = songs[0];
    const payload: SendAlbumPayload = {
      kind: "album",
      albumId,
      title: first.album_title ?? "unknown album",
      artistName: first.artist_name ?? "unknown artist",
      albumType: first.album_type ?? null,
      releaseDate: null,
      label: null,
      genres: [],
      images: first.album_images ?? [],
      songs,
    };
    const result = await sendToRemote(payload, localRemote, dest, {
      retryBlake3s: failedBlake3s,
      onProgress: (p) => {
        const done = p.syncedSongs + p.skippedSongs + p.failedSongs;
        if (p.totalSongs > 0) updateJobProgress(trackId, done / p.totalSongs);
        updateJobStage(trackId, `retrying ${done}/${p.totalSongs} songs`);
      },
    });
    updateJobStatus(
      trackId,
      result.failedSongs > 0 ? "failed" : "completed",
      result.failedSongs > 0
        ? { error: `${result.failedSongs} song(s) failed`, errorFull: result.errors.join("; ") }
        : undefined
    );
    updateJobEntities(trackId, {
      retryFailedBlake3s: result.failedSongs > 0 ? result.failedBlake3s : [],
    });
  } catch (e) {
    const msg = String(e);
    updateJobStatus(trackId, "failed", { error: msg });
    logError("retryFailedAlbumSend", `album ${albumId} retry failed: ${msg}`);
  }
}
