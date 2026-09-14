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
} from "../../../music/import/remoteImport";
import type { Remote } from "../storage/schemas/remote";
import { getRemoteById } from "../remotes/remoteManager";
import { clearPendingSendTarget } from "./pendingSendTargets";
import { error as logError } from "../../../utils/logger";

/** structural progress snapshot for rendering inline (no toasts). */
export interface SendReviewProgress {
  targetName: string;
  totalAlbums: number;
  /** includes both successful and failed albums. */
  completedAlbums: number;
  failedAlbums: number;
  currentAlbumTitle: string | null;
  currentSongsDone: number;
  currentSongsTotal: number;
  done: boolean;
  errors: string[];
}

function emptyProgress(targetName: string, totalAlbums: number): SendReviewProgress {
  return {
    targetName,
    totalAlbums,
    completedAlbums: 0,
    failedAlbums: 0,
    currentAlbumTitle: null,
    currentSongsDone: 0,
    currentSongsTotal: 0,
    done: false,
    errors: [],
  };
}

/**
 * send every album in `albumIds` (already imported into `localRemote`) to
 * `targetRemoteId`, reporting progress via `onProgress`. best-effort per
 * album - one failing album doesn't stop the rest from being attempted.
 */
export async function sendReviewedAlbumsToRemote(
  sessionId: string,
  targetRemoteId: string,
  targetRemoteName: string,
  localRemote: Remote,
  albumIds: string[],
  onProgress?: (progress: SendReviewProgress) => void
): Promise<void> {
  const progress = emptyProgress(targetRemoteName, albumIds.length);
  const emit = () => onProgress?.({ ...progress });

  if (albumIds.length === 0) {
    progress.done = true;
    emit();
    clearPendingSendTarget(sessionId);
    return;
  }

  const dest = await getRemoteById(targetRemoteId);
  if (!dest) {
    progress.errors.push(`couldn't find ${targetRemoteName} to send to`);
    progress.done = true;
    emit();
    clearPendingSendTarget(sessionId);
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
  clearPendingSendTarget(sessionId);
}
