// listen progress tracking service
// tracks which history entry is "active" and accumulates listened time
// persists progress to IDB every ~30 seconds during playback

import { createSignal } from "solid-js";
import { appState } from "../../../app/services/storage/db";
import { queueHistory, updateHistoryProgress } from "./queueHistory";
import { recordServerProgress, markServerSongCompleted } from "./serverSession";
import type { Song } from "../storage/types";

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

const FLUSH_INTERVAL_MS = 30_000; // flush to IDB every 30 seconds

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
export function recordTimeProgress(
  delta: number,
  songIndex: number,
  songPosition: number,
  currentSong: Song | null,
): void {
  if (!activeHistoryEntryId()) return;

  accumulatedSeconds += delta;
  currentSongIndex = songIndex;
  currentSongPosition = songPosition;

  // also update server session progress (converts seconds to ms)
  // routes to the correct remote session based on the song's remote_server_id
  recordServerProgress(delta * 1000, songIndex, songPosition * 1000, currentSong);
}

// mark a song as completed (>90% listened)
export function markSongCompleted(songIndex: number, currentSong: Song | null = null): void {
  if (!activeHistoryEntryId()) return;
  completedSongs.add(songIndex);
  markServerSongCompleted(songIndex, currentSong);
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

// reconnect progress tracking after a page reload
// matches the persisted queue in appState to the most recent history entry
// and resumes in-memory tracking so timeupdate events continue to accumulate
export function reconnectProgressTracking(): void {
  // already tracking — nothing to do
  if (activeHistoryEntryId()) return;

  const state = appState();
  if (!state || !state.queue.length || !state.current_sha256) return;

  const history = queueHistory();
  if (!history.length) return;

  // find the most recent history entry whose songs match the current queue
  // compare by sha256 list since that's the unique song identifier
  const queueHashes = state.queue.map((s) => s.sha256);
  const entry = history.find((h) => {
    if (h.songs.length !== queueHashes.length) return false;
    return h.songs.every((s, i) => s.sha256 === queueHashes[i]);
  });

  if (!entry) return;

  // resume tracking with the entry's persisted progress
  resumeTracking(entry.id, {
    listened_seconds: entry.listened_seconds,
    songs_completed: entry.songs_completed,
    current_song_index: entry.current_song_index,
    current_song_position: entry.current_song_position,
  });
}
