// auto-download manager for background song downloads
// when enabled, downloads remaining queue songs (beyond rolling 30min window)
// with a max of 3 concurrent downloads

import { createSignal } from "solid-js";
import { appState, getSyncQueueToLocal, getAutoDownloadEnabled } from "../../../app/services/storage/db";
import { syncSongToLocal, canSyncSong, type SyncableSong } from "../sync";
import {
  isSongSyncedLocally,
  markSongSynced,
  addToLoadingSet,
  removeFromLoadingSet,
  updateLoadingProgress,
  getActiveDownloadCount,
  isDownloadInProgress,
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

// pending queue (local to this manager)
const [pendingQueue, setPendingQueue] = createSignal<SyncableSong[]>([]);

// get count of songs pending download (in queue but not synced and not currently downloading)
export function getPendingDownloadCount(): number {
  return pendingQueue().length;
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
  // dynamically import to avoid circular dependency
  const { isP2PRemote } = await import("../storage/blobResolver");
  return isP2PRemote(song.remote_server_id);
}

// process the next batch of downloads
async function processQueue(): Promise<void> {
  if (isDownloadsPaused()) return;
  if (!getAutoDownloadEnabled()) return;
  if (!getSyncQueueToLocal()) return;
  
  const currentCount = getActiveDownloadCount();
  const pending = pendingQueue();
  
  // calculate how many we can start
  const slotsAvailable = MAX_CONCURRENT_DOWNLOADS - currentCount;
  if (slotsAvailable <= 0) return;
  if (pending.length === 0) return;
  
  // take next batch of songs
  const batch = pending.slice(0, slotsAvailable);
  const remaining = pending.slice(slotsAvailable);
  setPendingQueue(remaining);
  
  // start downloads for batch
  for (const song of batch) {
    void downloadSong(song);
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
      debug("autoDownload", `completed: ${song.title}${result.skipped ? " (already existed)" : ""}`);
      
      // invalidate queries so local views show the new song
      if (!result.skipped) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.songs.all() });
        void queryClient.invalidateQueries({ queryKey: queryKeys.albums.all() });
      }
    } else {
      const attempts = markDownloadFailed(sha256);
      warn("autoDownload", `failed: ${song.title} - ${result.error} (attempt ${attempts}/${MAX_RETRY_ATTEMPTS})`);
    }
  } catch (error) {
    const attempts = markDownloadFailed(sha256);
    warn("autoDownload", `error downloading ${song.title} (attempt ${attempts}/${MAX_RETRY_ATTEMPTS}):`, error);
  } finally {
    // remove from UI loading set
    removeFromLoadingSet(sha256);
    
    // process more from queue
    void processQueue();
  }
}

/**
 * update the auto-download queue based on current player queue
 * this should be called whenever:
 * - queue changes (add/remove/reorder)
 * - auto-download mode is toggled on
 * - current song changes (to exclude already-played songs)
 * 
 * @param currentSongIndex - index of currently playing song
 * @param upcomingMinutes - minutes of songs already being pre-cached (rolling window)
 */
export async function updateAutoDownloadQueue(
  currentSongIndex: number,
  upcomingMinutes: number = 30,
): Promise<void> {
  if (!getAutoDownloadEnabled()) {
    // clear pending queue if auto-download is disabled
    setPendingQueue([]);
    return;
  }
  
  if (!getSyncQueueToLocal()) {
    // sync mode must be enabled
    setPendingQueue([]);
    return;
  }
  
  const state = appState();
  if (!state?.queue || state.queue.length === 0) {
    setPendingQueue([]);
    return;
  }
  
  const queue = state.queue;
  
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
  
  const activeCount = getActiveDownloadCount();
  debug("autoDownload", `updated queue: ${songsToDownload.length} songs pending (${activeCount} active)`);
  setPendingQueue(songsToDownload);
  
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
  
  // find current song index from sha256
  const currentSha256 = state.current_sha256;
  const currentIndex = currentSha256 
    ? state.queue.findIndex(s => s.sha256 === currentSha256)
    : 0;
  
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
  
  // find current index from sha256
  const currentSha256 = state.current_sha256;
  const currentIndex = currentSha256 
    ? Math.max(0, state.queue.findIndex(s => s.sha256 === currentSha256))
    : 0;
  const queue = state.queue;
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
  
  // make sure we're not paused
  resumeDownloads();
  
  // start processing
  void processQueue();
}
