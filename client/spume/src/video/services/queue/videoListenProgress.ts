// local video watch-progress tracking service
// tracks which video history entry is "active" and accumulates watched time,
// mirroring music/services/queue/listenProgress.ts's accumulate-then-flush
// pattern. IDB-only: remote/server progress sync (e.g. via
// client.video.upsertPlaybackProgress) is a separate, much-less-frequent
// mechanism (periodic ~60s + beforeunload) — not implemented in this file.

import { createSignal } from "solid-js";
import { error as errorLog } from "../../../utils/logger";
import { appState } from "../../../app/services/storage/db";
import { videosOnly, type QueuedVideo } from "../../../app/services/storage/mediaItem";
import { videoQueueHistory, updateVideoHistoryProgress } from "./videoQueueHistory";
import { isPlaying, setVisualPosition } from "../../../music/services/audio/playerState";

// the currently active video history entry id being tracked
const [activeVideoHistoryEntryId, setActiveVideoHistoryEntryId] = createSignal<string | null>(null);
export { activeVideoHistoryEntryId };

// in-memory accumulator (flushed to IDB periodically)
let accumulatedSeconds = 0;
let currentVideoIndex = 0;
let currentVideoPosition = 0;
let completedVideos = new Set<number>(); // track completed video indices
let flushIntervalId: ReturnType<typeof setInterval> | null = null;

const FLUSH_INTERVAL_MS = 5_000; // flush to IDB every 5 seconds

// start tracking a history entry (called when playVideoQueue sets videos)
export function startVideoTracking(historyEntryId: string): void {
  if (activeVideoHistoryEntryId()) {
    void flushVideoProgress(true);
  }

  setActiveVideoHistoryEntryId(historyEntryId);
  accumulatedSeconds = 0;
  currentVideoIndex = 0;
  currentVideoPosition = 0;
  completedVideos = new Set();

  if (flushIntervalId) clearInterval(flushIntervalId);
  flushIntervalId = setInterval(() => {
    void flushVideoProgress();
  }, FLUSH_INTERVAL_MS);
}

// resume tracking an existing history entry (restore progress)
export function resumeVideoTracking(
  historyEntryId: string,
  resumeState: {
    watched_seconds: number;
    videos_completed: number;
    current_video_index: number;
    current_video_position: number;
  }
): void {
  if (activeVideoHistoryEntryId()) {
    void flushVideoProgress(true);
  }

  setActiveVideoHistoryEntryId(historyEntryId);
  accumulatedSeconds = resumeState.watched_seconds;
  currentVideoIndex = resumeState.current_video_index;
  currentVideoPosition = resumeState.current_video_position;
  completedVideos = new Set();
  for (let i = 0; i < resumeState.videos_completed; i++) {
    completedVideos.add(i);
  }

  if (flushIntervalId) clearInterval(flushIntervalId);
  flushIntervalId = setInterval(() => {
    void flushVideoProgress();
  }, FLUSH_INTERVAL_MS);
}

// stop tracking (called when queue is cleared or playback stops completely)
export function stopVideoTracking(skipQueueSave = false): void {
  if (activeVideoHistoryEntryId()) {
    void flushVideoProgress(true, skipQueueSave);
  }

  setActiveVideoHistoryEntryId(null);
  accumulatedSeconds = 0;
  currentVideoIndex = 0;
  currentVideoPosition = 0;
  completedVideos = new Set();

  if (flushIntervalId) {
    clearInterval(flushIntervalId);
    flushIntervalId = null;
  }
}

// called on every timeupdate from the player (~250ms intervals)
// delta is the time elapsed since last update
export function recordVideoTimeProgress(
  delta: number,
  videoIndex: number,
  videoPosition: number,
  _currentVideo: QueuedVideo | null
): void {
  if (!activeVideoHistoryEntryId()) return;

  accumulatedSeconds += delta;
  currentVideoIndex = videoIndex;
  currentVideoPosition = videoPosition;
}

// mark a video as completed (>90% watched) or skipped.
// flushes to IDB immediately and restarts the interval. unlike the song
// version's markSongCompleted, this does not advance any server session —
// remote video progress sync is a separate mechanism (see file header).
export function markVideoCompleted(
  videoIndex: number,
  _currentVideo: QueuedVideo | null = null
): void {
  if (!activeVideoHistoryEntryId()) return;
  completedVideos.add(videoIndex);
  void flushAndRestartInterval();
}

async function flushAndRestartInterval(): Promise<void> {
  await flushVideoProgress();
  if (flushIntervalId) clearInterval(flushIntervalId);
  flushIntervalId = setInterval(() => {
    void flushVideoProgress();
  }, FLUSH_INTERVAL_MS);
}

// flush accumulated progress to IDB.
// force=true bypasses the isPlaying check (used for explicit flushes like stop/clear).
// skipQueueSave is accepted for signature-parity with the song version's
// flushProgress but is currently a no-op: there is no video-queue
// visual-progress-fill mechanism yet (queueProgress.ts's saveProgressToIDB
// only handles song items).
export async function flushVideoProgress(force = false, skipQueueSave = false): Promise<void> {
  void skipQueueSave;
  const entryId = activeVideoHistoryEntryId();
  if (!entryId) return;

  // skip periodic flushes if player is not playing (no new progress to save)
  if (!force && !isPlaying()) return;

  try {
    await updateVideoHistoryProgress(entryId, {
      watched_seconds: accumulatedSeconds,
      videos_completed: completedVideos.size,
      current_video_index: currentVideoIndex,
      current_video_position: currentVideoPosition,
    });
  } catch (error) {
    errorLog("video/listenProgress", "failed to flush watch progress:", error);
  }
}

// reconnect progress tracking after a page reload
// matches the persisted queue in appState to the most recent video history
// entry (by video id, since videos have no sha256) and resumes in-memory
// tracking so timeupdate events continue to accumulate.
export function reconnectVideoProgressTracking(): void {
  if (activeVideoHistoryEntryId()) return;

  const state = appState();
  if (!state || !state.queue.length || !state.current_sha256) return;

  const history = videoQueueHistory();
  if (!history.length) return;

  const queueVideos = videosOnly(state.queue);
  const queueIds = queueVideos.map((v) => v.id);
  const entry = history.find((h) => {
    if (h.videos.length !== queueIds.length) return false;
    return h.videos.every((v, i) => v.id === queueIds[i]);
  });

  if (!entry) return;

  // set the visual position in the player bar (without affecting playback)
  const currentVideo = queueVideos.find((v) => v.id === state.current_sha256);
  if (currentVideo && entry.current_video_position > 0) {
    setVisualPosition(entry.current_video_position, currentVideo.duration_seconds ?? undefined);
  }

  resumeVideoTracking(entry.id, {
    watched_seconds: entry.watched_seconds,
    videos_completed: entry.videos_completed,
    current_video_index: entry.current_video_index,
    current_video_position: entry.current_video_position,
  });
}
