// listen progress tracking service
// tracks which history entry is "active" and accumulates listened time
// persists progress to IDB every ~5 seconds during playback

import { createSignal } from "solid-js";
import { updateHistoryProgress } from "./queueHistory";
import { recordServerProgress, markServerSongCompleted } from "./serverSession";

// the currently active history entry id being tracked
const [activeHistoryEntryId, setActiveHistoryEntryId] = createSignal<string | null>(null);
export { activeHistoryEntryId };

// in-memory accumulator (flushed to IDB periodically)
let accumulatedSeconds = 0;
let lastFlushTime = 0;
let currentSongIndex = 0;
let currentSongPosition = 0;
let completedSongs = new Set<number>(); // track completed song indices
let flushIntervalId: ReturnType<typeof setInterval> | null = null;

const FLUSH_INTERVAL_MS = 5000; // flush to IDB every 5 seconds

// start tracking a history entry (called when playQueue/addToQueue sets songs)
export function startTracking(historyEntryId: string): void {
  // flush any previous tracking before starting new
  if (activeHistoryEntryId()) {
    void flushProgress();
  }

  setActiveHistoryEntryId(historyEntryId);
  accumulatedSeconds = 0;
  currentSongIndex = 0;
  currentSongPosition = 0;
  completedSongs = new Set();
  lastFlushTime = Date.now();

  // start periodic flush
  if (flushIntervalId) clearInterval(flushIntervalId);
  flushIntervalId = setInterval(() => {
    void flushProgress();
  }, FLUSH_INTERVAL_MS);
}

// resume tracking an existing history entry (restore progress)
export function resumeTracking(
  historyEntryId: string,
  resumeState: {
    listened_seconds: number;
    songs_completed: number;
    current_song_index: number;
    current_song_position: number;
  },
): void {
  if (activeHistoryEntryId()) {
    void flushProgress();
  }

  setActiveHistoryEntryId(historyEntryId);
  accumulatedSeconds = resumeState.listened_seconds;
  currentSongIndex = resumeState.current_song_index;
  currentSongPosition = resumeState.current_song_position;
  completedSongs = new Set();
  // mark previously completed songs
  for (let i = 0; i < resumeState.songs_completed; i++) {
    completedSongs.add(i);
  }
  lastFlushTime = Date.now();

  if (flushIntervalId) clearInterval(flushIntervalId);
  flushIntervalId = setInterval(() => {
    void flushProgress();
  }, FLUSH_INTERVAL_MS);
}

// stop tracking (called when queue is cleared or playback stops completely)
export function stopTracking(): void {
  if (activeHistoryEntryId()) {
    void flushProgress();
  }

  setActiveHistoryEntryId(null);
  accumulatedSeconds = 0;
  currentSongIndex = 0;
  currentSongPosition = 0;
  completedSongs = new Set();

  if (flushIntervalId) {
    clearInterval(flushIntervalId);
    flushIntervalId = null;
  }
}

// called on every timeupdate from the player (~250ms intervals)
// delta is the time elapsed since last update
export function recordTimeProgress(delta: number, songIndex: number, songPosition: number): void {
  if (!activeHistoryEntryId()) return;

  accumulatedSeconds += delta;
  currentSongIndex = songIndex;
  currentSongPosition = songPosition;

  // also update server session progress (converts seconds to ms)
  recordServerProgress(delta * 1000, songIndex, songPosition * 1000);
}

// mark a song as completed (>90% listened)
export function markSongCompleted(songIndex: number): void {
  if (!activeHistoryEntryId()) return;
  completedSongs.add(songIndex);
  markServerSongCompleted(songIndex);
}

// get current accumulated progress (for UI without waiting for flush)
export function getCurrentProgress(): {
  listened_seconds: number;
  songs_completed: number;
  current_song_index: number;
  current_song_position: number;
} {
  return {
    listened_seconds: accumulatedSeconds,
    songs_completed: completedSongs.size,
    current_song_index: currentSongIndex,
    current_song_position: currentSongPosition,
  };
}

// flush accumulated progress to IDB
async function flushProgress(): Promise<void> {
  const entryId = activeHistoryEntryId();
  if (!entryId) return;

  try {
    await updateHistoryProgress(entryId, {
      listened_seconds: accumulatedSeconds,
      songs_completed: completedSongs.size,
      current_song_index: currentSongIndex,
      current_song_position: currentSongPosition,
    });
    lastFlushTime = Date.now();
  } catch (error) {
    console.error("failed to flush listen progress:", error);
  }
}
