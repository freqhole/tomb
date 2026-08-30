// auto-download manager for background song+video downloads
// when enabled, downloads remaining queue songs (beyond rolling 30min window)
// and videos (beyond the current position) with a shared max of 3
// concurrent downloads

import { createSignal } from "solid-js";
import {
  appState,
  getSyncQueueToLocal,
  getAutoDownloadEnabled,
} from "../../../app/services/storage/db";
import {
  songsOnly,
  videosOnly,
  mediaItemKey,
  type QueuedVideo,
} from "../../../app/services/storage/mediaItem";
import { syncSongToLocal, canSyncSong, type SyncableSong } from "../sync";
import { syncVideoToLocal, canSyncVideo } from "../../../video/services/sync/syncVideoToLocal";
import { isVideoSyncedLocally } from "../../../video/services/syncState";
import { videoQueryKeys } from "../../../video/queries/queryKeys";
import { isP2PRemote } from "../storage/blobResolver";
import {
  isSongSyncedLocally,
  markSongSynced,
  addToLoadingSet,
  removeFromLoadingSet,
  updateLoadingProgress,
  getActiveDownloadCount,
  isDownloadInProgress,
  registerDownload,
  isDownloadsPaused,
  pauseDownloads,
  resumeDownloads,
  hasFailedPermanently,
  markDownloadFailed,
  clearAllFailures,
  MAX_RETRY_ATTEMPTS,
} from "../download";
import { queryClient } from "../../../queryClient";
import { queryKeys } from "../../queries/queryKeys";
import { debug, warn } from "../../../utils/logger";
import type { Song } from "../storage/types";

// max concurrent downloads for auto-download mode
const MAX_CONCURRENT_DOWNLOADS = 3;

// pending queues (local to this manager)
const [pendingQueue, setPendingQueue] = createSignal<SyncableSong[]>([]);
const [pendingVideoQueue, setPendingVideoQueue] = createSignal<QueuedVideo[]>([]);

// get count of songs+videos pending download (in queue but not synced and not currently downloading)
export function getPendingDownloadCount(): number {
  return pendingQueue().length + pendingVideoQueue().length;
}

// check if auto-download is actively running
export function isAutoDownloadRunning(): boolean {
  return getActiveDownloadCount() > 0;
}

// pause auto-downloads (player downloads for playback still override)
export function pauseAutoDownload(): void {
  pauseDownloads();
  debug("autoDownload", "paused auto-downloads");
}

// resume auto-downloads (also clears failures to allow one more retry round)
export function resumeAutoDownload(): void {
  resumeDownloads();
  clearAllFailures(); // allow one more retry for all failed downloads
  debug("autoDownload", "resumed auto-downloads (retrying failed)");
  // trigger processing of pending queue
  void processQueue();
}

// called when auto-download is toggled on - clears failures to allow retries
export function onAutoDownloadEnabled(): void {
  clearAllFailures();
  debug("autoDownload", "auto-download enabled, cleared failures for retry");
}

// check if a song is P2P remote
async function isP2PRemoteSong(song: Song): Promise<boolean> {
  if (song.source_type !== "remote" || !song.remote_server_id) {
    return false;
  }
  return isP2PRemote(song.remote_server_id);
}

// check if a video is P2P remote
async function isP2PRemoteVideo(video: QueuedVideo): Promise<boolean> {
  if (video.source_type !== "remote" || !video.remote_server_id) {
    return false;
  }
  return isP2PRemote(video.remote_server_id);
}

// process the next batch of downloads (songs and videos share the same
// concurrency budget; songs fill slots first, videos take whatever's left)
async function processQueue(): Promise<void> {
  if (isDownloadsPaused()) return;
  if (!getAutoDownloadEnabled()) return;
  if (!getSyncQueueToLocal()) return;

  const currentCount = getActiveDownloadCount();
  const pending = pendingQueue();
  const pendingVideos = pendingVideoQueue();

  // calculate how many we can start
  let slotsAvailable = MAX_CONCURRENT_DOWNLOADS - currentCount;
  if (slotsAvailable <= 0) return;
  if (pending.length === 0 && pendingVideos.length === 0) return;

  // take next batch of songs
  const batch = pending.slice(0, slotsAvailable);
  setPendingQueue(pending.slice(batch.length));
  slotsAvailable -= batch.length;

  // fill any remaining slots with videos
  const videoBatch = slotsAvailable > 0 ? pendingVideos.slice(0, slotsAvailable) : [];
  setPendingVideoQueue(pendingVideos.slice(videoBatch.length));

  // start downloads for batch
  for (const song of batch) {
    void downloadSong(song);
  }
  for (const video of videoBatch) {
    void downloadVideo(video);
  }
}

// download a single song
async function downloadSong(song: SyncableSong): Promise<void> {
  const sha256 = song.sha256;

  // add to UI loading set so queue shows loading indicator
  addToLoadingSet(sha256);

  try {
    debug("autoDownload", `starting download: ${song.title} (${sha256.slice(0, 8)}...)`);

    const result = await syncSongToLocal(song, (received, total) => {
      // update progress for UI
      if (total > 0) {
        const pct = Math.round((received / total) * 100);
        updateLoadingProgress(sha256, pct);
        debug("autoDownload", `progress: ${sha256.slice(0, 8)}... ${pct}%`);
      }
    });

    if (result.success) {
      markSongSynced(sha256);
      debug(
        "autoDownload",
        `completed: ${song.title}${result.skipped ? " (already existed)" : ""}`
      );

      // invalidate queries so local views show the new song
      if (!result.skipped) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.songs.all() });
        void queryClient.invalidateQueries({ queryKey: queryKeys.albums.all() });
      }
    } else {
      const attempts = markDownloadFailed(sha256);
      warn(
        "autoDownload",
        `failed: ${song.title} - ${result.error} (attempt ${attempts}/${MAX_RETRY_ATTEMPTS})`
      );
    }
  } catch (error) {
    const attempts = markDownloadFailed(sha256);
    warn(
      "autoDownload",
      `error downloading ${song.title} (attempt ${attempts}/${MAX_RETRY_ATTEMPTS}):`,
      error
    );
  } finally {
    // remove from UI loading set
    removeFromLoadingSet(sha256);

    // process more from queue
    void processQueue();
  }
}

// download a single video. syncVideoToLocal() is void/best-effort (never
// throws, logs and returns on failure) rather than returning a result like
// syncSongToLocal() - success is detected afterward via isVideoSyncedLocally().
async function downloadVideo(video: QueuedVideo): Promise<void> {
  const id = video.id;

  // add to UI loading set so queue shows loading indicator (syncVideoToLocal
  // also drives this internally via preCacheBlob/preCacheP2PBlob, but doing
  // it here too covers the OPFS-write tail end of the sync as "loading")
  addToLoadingSet(id);

  const syncPromise = syncVideoToLocal(video);
  registerDownload(id, syncPromise);

  try {
    debug("autoDownload", `starting video download: ${video.title} (${id})`);
    await syncPromise;

    if (isVideoSyncedLocally(id)) {
      debug("autoDownload", `completed video: ${video.title}`);
      void queryClient.invalidateQueries({ queryKey: videoQueryKeys.videos.all() });
    } else {
      const attempts = markDownloadFailed(id);
      warn(
        "autoDownload",
        `failed video: ${video.title} (attempt ${attempts}/${MAX_RETRY_ATTEMPTS})`
      );
    }
  } catch (error) {
    const attempts = markDownloadFailed(id);
    warn(
      "autoDownload",
      `error downloading video ${video.title} (attempt ${attempts}/${MAX_RETRY_ATTEMPTS}):`,
      error
    );
  } finally {
    removeFromLoadingSet(id);
    void processQueue();
  }
}

/**
 * update the auto-download queue based on current player queue
 * this should be called whenever:
 * - queue changes (add/remove/reorder)
 * - auto-download mode is toggled on
 * - current song changes (to exclude already-played songs/videos)
 *
 * @param currentSongIndex - index of currently playing song (song-only subset)
 * @param upcomingMinutes - minutes of songs already being pre-cached (rolling window).
 *   videos have no equivalent time-based window (queued videos are typically
 *   few and long, and the near-term pre-cache system already covers the
 *   imminent-playback case) - all not-yet-synced videos from the current
 *   queue position onward are downloaded.
 */
export async function updateAutoDownloadQueue(
  currentSongIndex: number,
  upcomingMinutes: number = 30
): Promise<void> {
  if (!getAutoDownloadEnabled()) {
    // clear pending queues if auto-download is disabled
    setPendingQueue([]);
    setPendingVideoQueue([]);
    return;
  }

  if (!getSyncQueueToLocal()) {
    // sync mode must be enabled
    setPendingQueue([]);
    setPendingVideoQueue([]);
    return;
  }

  const state = appState();
  if (!state?.queue || state.queue.length === 0) {
    setPendingQueue([]);
    setPendingVideoQueue([]);
    return;
  }

  const queue = songsOnly(state.queue);

  // calculate which songs are outside the rolling window
  // skip songs that:
  // 1. are before current index (already played)
  // 2. are within the rolling window (already being pre-cached)
  // 3. are already synced locally
  // 4. are not P2P remote songs
  // 5. are currently being downloaded
  // 6. have permanently failed (exhausted retries)

  let accumulatedSeconds = 0;
  const targetSeconds = upcomingMinutes * 60;
  const songsToDownload: SyncableSong[] = [];

  for (let i = currentSongIndex; i < queue.length; i++) {
    const song = queue[i];
    const duration = song.duration_seconds || 0;

    // skip if within rolling window
    if (accumulatedSeconds < targetSeconds) {
      accumulatedSeconds += duration;
      continue;
    }

    // skip if already synced
    if (isSongSyncedLocally(song.sha256)) {
      continue;
    }

    // skip if permanently failed (exhausted retries)
    if (hasFailedPermanently(song.sha256)) {
      continue;
    }

    // skip if already downloading
    if (isDownloadInProgress(song.sha256)) {
      continue;
    }

    // skip if not syncable
    if (!canSyncSong(song)) {
      continue;
    }

    // skip if not P2P remote
    const isP2P = await isP2PRemoteSong(song);
    if (!isP2P) {
      continue;
    }

    songsToDownload.push(song);
  }

  // videos: find the current position in the *unified* queue (current_sha256
  // doubles as the video's own id when a video is playing) and consider every
  // not-yet-synced, syncable, P2P remote video from there onward.
  const unifiedCurrentIndex = state.current_sha256
    ? Math.max(
        0,
        state.queue.findIndex((item) => mediaItemKey(item) === state.current_sha256)
      )
    : 0;
  const upcomingVideos = videosOnly(state.queue.slice(unifiedCurrentIndex));
  const videosToDownload: QueuedVideo[] = [];

  for (const video of upcomingVideos) {
    if (isVideoSyncedLocally(video.id)) continue;
    if (hasFailedPermanently(video.id)) continue;
    if (isDownloadInProgress(video.id)) continue;
    if (!canSyncVideo(video)) continue;

    const isP2P = await isP2PRemoteVideo(video);
    if (!isP2P) continue;

    videosToDownload.push(video);
  }

  const activeCount = getActiveDownloadCount();
  debug(
    "autoDownload",
    `updated queue: ${songsToDownload.length} songs, ${videosToDownload.length} videos pending (${activeCount} active)`
  );
  setPendingQueue(songsToDownload);
  setPendingVideoQueue(videosToDownload);

  // start processing if we have slots available
  void processQueue();
}

/**
 * resume downloads after page refresh
 * call this on app init if auto-download is enabled
 */
export async function resumeAutoDownloadsOnInit(): Promise<void> {
  if (!getAutoDownloadEnabled()) return;

  const state = appState();
  if (!state?.queue || state.queue.length === 0) return;

  // find current song index from sha256 (song-only subset - the video
  // half of the queue is handled separately inside updateAutoDownloadQueue,
  // keyed off the unified current_sha256/mediaItemKey instead)
  const currentSha256 = state.current_sha256;
  const queueSongs = songsOnly(state.queue);
  const currentIndex = currentSha256 ? queueSongs.findIndex((s) => s.sha256 === currentSha256) : 0;

  debug("autoDownload", "checking for pending downloads on init...");
  await updateAutoDownloadQueue(Math.max(0, currentIndex));
}

/**
 * force download all remaining queue songs now
 * bypasses rolling window, downloads everything not yet synced
 * clears failed download history to allow retries
 */
export async function downloadAllNow(): Promise<void> {
  const state = appState();
  if (!state?.queue || state.queue.length === 0) return;

  if (!getSyncQueueToLocal()) {
    warn("autoDownload", "sync mode must be enabled to download all");
    return;
  }

  // clear failed download history to allow retries
  clearAllFailures();

  // find current index from sha256 (song-only subset)
  const currentSha256 = state.current_sha256;
  const queue = songsOnly(state.queue);
  const currentIndex = currentSha256
    ? Math.max(
        0,
        queue.findIndex((s) => s.sha256 === currentSha256)
      )
    : 0;
  const songsToDownload: SyncableSong[] = [];

  // collect all unsynced P2P songs from current onwards
  for (let i = currentIndex; i < queue.length; i++) {
    const song = queue[i];

    if (isSongSyncedLocally(song.sha256)) continue;
    if (isDownloadInProgress(song.sha256)) continue;
    if (!canSyncSong(song)) continue;

    const isP2P = await isP2PRemoteSong(song);
    if (!isP2P) continue;

    songsToDownload.push(song);
  }

  debug("autoDownload", `downloading all: ${songsToDownload.length} songs`);
  setPendingQueue(songsToDownload);

  // videos: same unified-queue current-position lookup as updateAutoDownloadQueue,
  // downloading every remaining unsynced, syncable, P2P remote video
  const unifiedCurrentIndex = currentSha256
    ? Math.max(
        0,
        state.queue.findIndex((item) => mediaItemKey(item) === currentSha256)
      )
    : 0;
  const upcomingVideos = videosOnly(state.queue.slice(unifiedCurrentIndex));
  const videosToDownload: QueuedVideo[] = [];

  for (const video of upcomingVideos) {
    if (isVideoSyncedLocally(video.id)) continue;
    if (isDownloadInProgress(video.id)) continue;
    if (!canSyncVideo(video)) continue;

    const isP2P = await isP2PRemoteVideo(video);
    if (!isP2P) continue;

    videosToDownload.push(video);
  }

  debug("autoDownload", `downloading all: ${videosToDownload.length} videos`);
  setPendingVideoQueue(videosToDownload);

  // make sure we're not paused
  resumeDownloads();

  // start processing
  void processQueue();
}
