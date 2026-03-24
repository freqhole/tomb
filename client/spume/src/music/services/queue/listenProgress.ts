// listen progress tracking service
// tracks which history entry is "active" and accumulates listened time
// persists progress to IDB every ~30 seconds during playback
// server progress is song-based (via advanceServerProgress)

import { createSignal } from "solid-js";
import { appState } from "../../../app/services/storage/db";
import { queueHistory, updateHistoryProgress } from "./queueHistory";
import { advanceServerProgress, reconnectServerSession } from "./serverSession";
import { saveProgressToIDB } from "./queueProgress";
import { isPlaying, setVisualPosition } from "../audio/playerState";
import type { Song } from "../storage/types";

// the currently active history entry id being tracked
const [activeHistoryEntryId, setActiveHistoryEntryId] = createSignal<string | null>(null);
export { activeHistoryEntryId };

// in-memory accumulator (flushed to IDB periodically)
let accumulatedSeconds = 0;
let currentSongIndex = 0;
let currentSongPosition = 0;
let completedSongs = new Set<number>(); // track completed song indices
let flushIntervalId: ReturnType<typeof setInterval> | null = null;

const FLUSH_INTERVAL_MS = 5_000; // flush to IDB every 5 seconds

// start tracking a history entry (called when playQueue/addToQueue sets songs)
export function startTracking(historyEntryId: string): void {
  // flush any previous tracking before starting new
  if (activeHistoryEntryId()) {
    void flushProgress(true);
  }

  setActiveHistoryEntryId(historyEntryId);
  accumulatedSeconds = 0;
  currentSongIndex = 0;
  currentSongPosition = 0;
  completedSongs = new Set();

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
    void flushProgress(true);
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

  if (flushIntervalId) clearInterval(flushIntervalId);
  flushIntervalId = setInterval(() => {
    void flushProgress();
  }, FLUSH_INTERVAL_MS);
}

// stop tracking (called when queue is cleared or playback stops completely)
// skipQueueSave: true when clearing queue (avoids race condition with setQueue)
export function stopTracking(skipQueueSave = false): void {
  if (activeHistoryEntryId()) {
    void flushProgress(true, skipQueueSave);
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
// only tracks local IDB progress - server progress is song-based
export function recordTimeProgress(
  delta: number,
  songIndex: number,
  songPosition: number,
  _currentSong: Song | null,
): void {
  if (!activeHistoryEntryId()) return;

  accumulatedSeconds += delta;
  currentSongIndex = songIndex;
  currentSongPosition = songPosition;
}

// mark a song as completed (>90% listened) or skipped
// advances server progress (song-based, forward-only)
// also flushes to IDB immediately and restarts the interval
export function markSongCompleted(songIndex: number, currentSong: Song | null = null): void {
  if (!activeHistoryEntryId()) return;
  completedSongs.add(songIndex);
  // advance server progress to the next song
  advanceServerProgress(songIndex, currentSong);
  // flush to IDB immediately and restart interval
  void flushAndRestartInterval();
}

// flush progress to IDB and restart the periodic interval
async function flushAndRestartInterval(): Promise<void> {
  await flushProgress();
  // restart interval so we don't flush again too soon
  if (flushIntervalId) clearInterval(flushIntervalId);
  flushIntervalId = setInterval(() => {
    void flushProgress();
  }, FLUSH_INTERVAL_MS);
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
// force=true bypasses the isPlaying check (used for explicit flushes like stop/clear)
// skipQueueSave=true skips saving progress to queue songs (avoids race when clearing)
async function flushProgress(force = false, skipQueueSave = false): Promise<void> {
  const entryId = activeHistoryEntryId();
  if (!entryId) return;
  
  // skip periodic flushes if player is not playing (no new progress to save)
  if (!force && !isPlaying()) return;

  try {
    await updateHistoryProgress(entryId, {
      listened_seconds: accumulatedSeconds,
      songs_completed: completedSongs.size,
      current_song_index: currentSongIndex,
      current_song_position: currentSongPosition,
    });
    
    // save queue item progress for visual fill (skip when clearing to avoid race)
    if (!skipQueueSave) {
      await saveProgressToIDB();
    }
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

  // set the visual position in the player bar (without starting playback)
  const currentSong = state.queue.find(s => s.sha256 === state.current_sha256);
  if (currentSong && entry.current_song_position > 0) {
    setVisualPosition(entry.current_song_position, currentSong.duration_seconds ?? undefined);
  }

  // resume tracking with the entry's persisted progress
  resumeTracking(entry.id, {
    listened_seconds: entry.listened_seconds,
    songs_completed: entry.songs_completed,
    current_song_index: entry.current_song_index,
    current_song_position: entry.current_song_position,
  });

  // also reconnect server session if the entry has server session info
  if (entry.server_session_id && entry.server_remote_id) {
    void reconnectServerSession({
      id: entry.id,
      server_session_id: entry.server_session_id,
      server_remote_id: entry.server_remote_id,
      label: entry.label,
      entity_id: entry.entity_id,
      songs_completed: entry.songs_completed,
      songs: entry.songs,
    });
  }
}
