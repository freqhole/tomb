// web/browser counterpart of app/services/send/sendReviewedSessionToRemote.ts -
// once a locally-imported (IndexedDB) "add media" review session is fully
// reviewed, send its albums to the real target remote it was originally
// destined for. reuses the exact same sync mechanism (sendToRemote.ts),
// just sourced from the browser's own local library instead of a
// charnel-managed grimoire instance, and using this browser's own midden
// node id as the "source" identity (see localBrowserSource.ts) since
// there's no Remote row representing "myself" in plain web mode.
//
// same no-toasts-here contract as the grimoire version - progress is
// reported structurally via `onProgress` for ImportReviewModal's inline
// `sendProgress` panel.
import { getAlbumById, getSongsByAlbumId } from "../../../music/services/storage/db";
import { sendToRemote, type SendAlbumPayload } from "../../../music/services/send/sendToRemote";
import type { RemoteSong } from "../../../music/data/remote/adapters";
import { getLocalBrowserSourceRemote } from "../../../music/services/send/localBrowserSource";
import {
  addTrackedJob,
  updateJobStatus,
  updateJobStage,
  updateJobProgress,
} from "../../../music/import/remoteImport";
import { getRemoteById } from "../remotes/remoteManager";
import type { SendReviewProgress } from "./sendReviewedSessionToRemote";
import { error as logError } from "../../../utils/logger";

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
 * send every album in `albumIds` (already imported into this browser's own
 * IndexedDB library) to `targetRemoteId`, reporting progress via
 * `onProgress`. best-effort per album, same as the grimoire version.
 */
export async function sendReviewedLocalAlbumsToRemote(
  targetRemoteId: string,
  targetRemoteName: string,
  albumIds: string[],
  onProgress?: (progress: SendReviewProgress) => void
): Promise<void> {
  const progress = emptyProgress(targetRemoteName, albumIds.length);
  const emit = () => onProgress?.({ ...progress });

  if (albumIds.length === 0) {
    progress.done = true;
    emit();
    return;
  }

  const dest = await getRemoteById(targetRemoteId);
  if (!dest) {
    progress.errors.push(`couldn't find ${targetRemoteName} to send to`);
    progress.done = true;
    emit();
    return;
  }

  let localSource;
  try {
    localSource = await getLocalBrowserSourceRemote();
  } catch (e) {
    progress.errors.push((e as Error).message);
    progress.done = true;
    emit();
    return;
  }
  emit();

  for (const albumId of albumIds) {
    let trackId: string | null = null;
    try {
      const [album, songs] = await Promise.all([getAlbumById(albumId), getSongsByAlbumId(albumId)]);
      if (songs.length === 0) {
        progress.completedAlbums += 1;
        emit();
        continue;
      }
      const first = songs[0];
      const albumTitle = album?.title ?? first.album_title ?? "unknown album";
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
        albumType: album?.album_type ?? null,
        releaseDate: album?.release_date ?? null,
        label: album?.label ?? null,
        genres: [],
        images: album?.images,
        // local IndexedDB songs are a structural superset of RemoteSong's
        // required fields except for a few user/display-only ones
        // (is_favorite, album_tags, ...) sendToRemote never reads - same
        // loose-cast convention already used by PlaylistDetailPanel's
        // buildPlaylistSendPayload.
        songs: songs as unknown as RemoteSong[],
      };
      const result = await sendToRemote(payload, localSource, dest, {
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
      logError("sendReviewedLocalSessionToRemote", `album ${albumId} send failed: ${msg}`);
    }
    emit();
  }

  progress.currentAlbumTitle = null;
  progress.done = true;
  emit();
}
