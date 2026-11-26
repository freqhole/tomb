// orchestrator: send an album, playlist, or song from a source remote to
// the local browser library (idb + opfs).
//
// mirrors the shape of `sendToRemote` (same SendProgress / SendOptions)
// so the share-modal ui can reuse its progress + retry-failed flows.
//
// implementation just dispatches each song through `syncSongToLocal` —
// that helper auto-detects browser vs charnel modes and handles dedup,
// image download, etc. in tauri/charnel mode the existing
// charnel-managed remote in the eligible-list already provides a
// destination, so this orchestrator is primarily for browser web.

import { syncSongToLocal, canSyncSong } from "../sync";
import {
  registerBlobTransfer,
  updateBlobTransferProgress,
  completeBlobTransfer,
} from "../../../app/services/transfers/blobTransferRegistry";
import { initMusicDB } from "../storage/db";
import { upsertLocalPlaylistWithItems } from "../storage/playlists";
import { findExistingSongByContentHash } from "../storage/db/songs";
import { getLocalVideoById, getVideoByBlake3 } from "../../../video/services/storage/db/videos";
import { syncVideoToLocal } from "../../../video/services/sync/syncVideoToLocal";
import { debug, error as logError } from "../../../utils/logger";
import type { Remote } from "../../../app/services/storage/schemas/remote";
import type { Song } from "../storage/types";
import type { SendOptions, SendPayload, SendProgress } from "./sendToRemote";
import { SendToRemoteError } from "./sendToRemote";

/**
 * send `payload` to the local library. resolves with the final progress
 * snapshot. throws `SendToRemoteError` on fatal validation errors.
 */
export async function sendToLocalLibrary(
  payload: SendPayload,
  source: Remote,
  opts: SendOptions = {}
): Promise<SendProgress> {
  const concurrency = Math.max(1, opts.concurrency ?? 2);
  const retrySet = opts.retryBlake3s ? new Set(opts.retryBlake3s) : null;

  const songs = payload.kind === "song" ? [payload.song] : payload.songs;
  const videos = payload.kind === "playlist" ? payload.videos ?? [] : [];
  const songIds = new Map<string, string>();
  const videoIds = new Map<string, string>();

  const progress: SendProgress = {
    phase: "preparing",
    totalSongs: songs.length,
    syncedSongs: 0,
    skippedSongs: 0,
    failedSongs: 0,
    errors: [],
    syncedBlake3s: [],
    failedBlake3s: [],
    totalVideos: videos.length,
    syncedVideos: 0,
    skippedVideos: 0,
    failedVideos: 0,
    syncedVideoBlake3s: [],
    failedVideoBlake3s: [],
  };
  const emit = () => opts.onProgress?.({ ...progress });
  emit();

  // require a source remote_id so syncSongToLocal can resolve the source.
  if (!source.remote_id) {
    throw new SendToRemoteError("source remote is missing remote_id", progress);
  }

  // tag each song with the source remote_id (syncSongToLocal needs this
  // to resolve the source) and filter to ones that can be synced.
  const taggedSongs = songs.map((s) => ({
    ...s,
    remote_server_id: s.remote_server_id || source.remote_id,
  }));
  const syncable = taggedSongs.filter((s) => canSyncSong(s as unknown as Song));
  const skippedNotSyncable = songs.length - syncable.length;
  if (skippedNotSyncable > 0) {
    progress.skippedSongs += skippedNotSyncable;
    progress.errors.push(`${skippedNotSyncable} song(s) skipped — missing required fields`);
  }

  // when retrying, narrow to the requested blake3 subset.
  let eligibleSongs = syncable;
  if (retrySet) {
    eligibleSongs = eligibleSongs.filter((s) => s.blake3 && retrySet.has(s.blake3));
  }
  // totalSongs reflects what THIS run will attempt (matters for retries).
  progress.totalSongs = eligibleSongs.length;
  const eligibleVideos = retrySet
    ? videos.filter((video) => video.blake3 && retrySet.has(video.blake3))
    : videos;
  progress.totalVideos = eligibleVideos.length;
  emit();

  progress.phase = "syncing-songs";
  emit();

  await runWithConcurrency(eligibleSongs, concurrency, async (song) => {
    const blake3 = song.blake3 ?? null;
    // bucket A's registry previously only ever got fed "upload" (this
    // node serving a remote peer) entries - a send TO the local library
    // is the opposite direction (bytes pulled in from the source), which
    // nothing registered here before. SendToRemoteSection.tsx's
    // `blendedProgress` already checks both directions (see its own
    // fix) - this is the producer side of that.
    if (blake3)
      registerBlobTransfer(blake3, "download", { bytesTotal: song.file_size ?? undefined });
    try {
      // syncSongToLocal accepts the SyncableSong subset; RemoteSong is a
      // structural superset. mark playlist songs to skip per-song feed
      // events (the playlist envelope emits one).
      const result = await syncSongToLocal(
        {
          ...(song as unknown as Song),
          skip_feed_events: payload.kind === "playlist",
        } as unknown as Parameters<typeof syncSongToLocal>[0],
        blake3
          ? (received, total) => updateBlobTransferProgress(blake3, received, total || undefined)
          : undefined,
        source
      );
      if (result.success && result.localSongId) {
        songIds.set(song.id, result.localSongId);
        if (result.skipped) progress.skippedSongs += 1;
        else progress.syncedSongs += 1;
        if (blake3) progress.syncedBlake3s.push(blake3);
      } else {
        progress.failedSongs += 1;
        if (blake3) progress.failedBlake3s.push(blake3);
        progress.errors.unshift(`sync ${song.title} failed: ${result.error ?? "local song id missing"}`);
      }
    } catch (e) {
      progress.failedSongs += 1;
      if (blake3) progress.failedBlake3s.push(blake3);
      progress.errors.unshift(`sync ${song.title} failed: ${String(e)}`);
      logError("sendToLocalLibrary", `song sync failed: ${String(e)}`);
    } finally {
      if (blake3) completeBlobTransfer(blake3);
      emit();
    }
  });

  await runWithConcurrency(eligibleVideos, concurrency, async (video) => {
    const blake3 = video.blake3 ?? null;
    try {
      const result = await syncVideoToLocal(
        { ...video, source_type: "remote", remote_server_id: source.remote_id },
        source,
        { force: true, originalOnly: true }
      );
      if (!result.success || !result.videoId) {
        progress.failedVideos += 1;
        if (blake3) progress.failedVideoBlake3s.push(blake3);
        progress.errors.unshift(`sync ${video.title} failed: ${result.error ?? "local video id missing"}`);
      } else {
        videoIds.set(video.id, result.videoId);
        progress.syncedVideos += 1;
        if (blake3) progress.syncedVideoBlake3s.push(blake3);
      }
    } catch (e) {
      progress.failedVideos += 1;
      if (blake3) progress.failedVideoBlake3s.push(blake3);
      progress.errors.unshift(`sync ${video.title} failed: ${String(e)}`);
      logError("sendToLocalLibrary", `video sync failed: ${String(e)}`);
    } finally {
      emit();
    }
  });

  // playlist envelope: create/update the local playlist row + song refs.
  if (payload.kind === "playlist") {
    progress.phase = "syncing-playlist";
    emit();
    try {
      const db = await initMusicDB();
      // pull source images from the first song's album/song images.
      const firstWithImg = payload.songs.find(
        (s) => (s.album_images && s.album_images.length > 0) || (s.images && s.images.length > 0)
      );
      const sourceImages = firstWithImg
        ? firstWithImg.album_images && firstWithImg.album_images.length > 0
          ? [firstWithImg.album_images[0]]
          : firstWithImg.images && firstWithImg.images.length > 0
            ? [firstWithImg.images[0]]
            : undefined
        : undefined;
      const refsByHash = new Map<string, { entity_type: "song" | "video"; entity_id: string }>();
      const refs: Array<{ entity_type: "song" | "video"; entity_id: string }> = [];
      for (const song of payload.songs) {
        const id = songIds.get(song.id) ?? (await findExistingSongByContentHash(song))?.id;
        if (!id) throw new Error(`song not available locally: ${song.title}`);
        const ref = { entity_type: "song" as const, entity_id: id };
        refs.push(ref);
        if (song.blake3) refsByHash.set(`song:${song.blake3}`, ref);
      }
      for (const video of videos) {
        const id = videoIds.get(video.id) ?? (video.blake3
          ? await getVideoByBlake3(video.blake3)
          : await getLocalVideoById(video.id))?.id;
        if (!id) throw new Error(`video not available locally: ${video.title}`);
        const ref = { entity_type: "video" as const, entity_id: id };
        refs.push(ref);
        if (video.blake3) refsByHash.set(`video:${video.blake3}`, ref);
      }
      const orderedRefs = payload.memberOrder?.map((member) => refsByHash.get(`${member.kind}:${member.blake3}`));
      if (orderedRefs && (orderedRefs.length !== refs.length || orderedRefs.some((ref) => !ref))) {
        throw new Error("playlist membership could not be resolved in source order");
      }
      const localPlaylistId = `synced-${payload.playlistId}`;
      await upsertLocalPlaylistWithItems(
        db,
        {
          playlist_id: localPlaylistId,
          title: payload.title,
          description: payload.description ?? null,
          images: sourceImages,
        },
        orderedRefs ? orderedRefs.filter((ref) => ref !== undefined) : refs
      );
      debug(
        "sendToLocalLibrary",
        `local playlist '${payload.title}' upserted with ${payload.songs.length} songs`
      );
    } catch (e) {
      progress.errors.unshift(`playlist envelope failed: ${String(e)}`);
      progress.phase = "failed";
      emit();
      throw new SendToRemoteError(`playlist envelope failed: ${String(e)}`, progress);
    }
  }

  progress.phase = "done";
  emit();
  return progress;
}

// simple worker-pool helper (mirrors sendToRemote.ts).
async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let nextIndex = 0;
  const runners: Promise<void>[] = [];
  const total = items.length;
  for (let i = 0; i < Math.min(limit, total); i++) {
    runners.push(
      (async () => {
        while (true) {
          const idx = nextIndex++;
          if (idx >= total) return;
          await worker(items[idx]);
        }
      })()
    );
  }
  await Promise.all(runners);
}
