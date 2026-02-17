// server-side listen session sync
// creates and updates listen sessions on the server alongside local IDB history.
// progress is synced periodically (every ~10 seconds) to avoid spamming the server.

import { createSignal } from "solid-js";
import * as apiClient from "freqhole-api-client";
import { getCurrentRemote } from "../../data";
import type { QueueSourceContext } from "../../../app/services/storage/types";
import type { Song } from "../storage/types";

// the currently active server session id
const [activeServerSessionId, setActiveServerSessionId] = createSignal<string | null>(null);
export { activeServerSessionId };

// flush interval for server progress updates
let serverFlushIntervalId: ReturnType<typeof setInterval> | null = null;
const SERVER_FLUSH_INTERVAL_MS = 10_000;

// accumulated state (updated by recordServerProgress)
let serverAccumulatedMs = 0;
let serverSongIndex = 0;
let serverSongPositionMs = 0;
let serverCompletedSongs = new Set<number>();

// create a server-side listen session when playQueue/addToQueue is called
export async function createServerSession(
  songs: Song[],
  source: QueueSourceContext,
): Promise<string | null> {
  const remote = getCurrentRemote();
  if (!remote) return null;

  // stop any previous session before creating a new one
  if (activeServerSessionId()) {
    await stopServerSession("paused");
  }

  try {
    const totalDurationMs = songs.reduce(
      (sum, s) => sum + (s.duration_seconds || 0) * 1000,
      0,
    );

    const result = await apiClient.music.createListenSession(remote.base_url, {
      session_type: source.type,
      entity_id: source.entity_id ?? null,
      label: source.label,
      song_ids: songs.map((s) => s.id || s.sha256),
      total_songs: songs.length,
      total_duration_ms: totalDurationMs,
    });

    if (result.success) {
      setActiveServerSessionId(result.data.id);
      serverAccumulatedMs = 0;
      serverSongIndex = 0;
      serverSongPositionMs = 0;
      serverCompletedSongs = new Set();

      // start periodic server flush
      if (serverFlushIntervalId) clearInterval(serverFlushIntervalId);
      serverFlushIntervalId = setInterval(() => {
        void flushServerProgress();
      }, SERVER_FLUSH_INTERVAL_MS);

      return result.data.id;
    } else {
      console.error("failed to create server session:", (result as any).error);
      return null;
    }
  } catch (error) {
    console.error("failed to create server session:", error);
    return null;
  }
}

// update server progress (called from listenProgress on each timeupdate)
export function recordServerProgress(
  deltaMs: number,
  songIndex: number,
  songPositionMs: number,
): void {
  if (!activeServerSessionId()) return;
  serverAccumulatedMs += deltaMs;
  serverSongIndex = songIndex;
  serverSongPositionMs = songPositionMs;
}

// mark a song as completed on server session
export function markServerSongCompleted(songIndex: number): void {
  if (!activeServerSessionId()) return;
  serverCompletedSongs.add(songIndex);
}

// flush progress to server
async function flushServerProgress(): Promise<void> {
  const sessionId = activeServerSessionId();
  if (!sessionId) return;

  const remote = getCurrentRemote();
  if (!remote) return;

  try {
    await apiClient.music.updateListenSessionProgress(
      remote.base_url,
      sessionId,
      {
        songs_completed: serverCompletedSongs.size,
        listened_duration_ms: Math.round(serverAccumulatedMs),
        current_song_index: serverSongIndex,
        current_song_position_ms: Math.round(serverSongPositionMs),
      },
    );
  } catch (error) {
    console.error("failed to flush server session progress:", error);
  }
}

// stop tracking and update server session status
export async function stopServerSession(
  status: "completed" | "paused" | "abandoned" = "paused",
): Promise<void> {
  const sessionId = activeServerSessionId();
  if (!sessionId) return;

  // final flush before status change
  await flushServerProgress();

  const remote = getCurrentRemote();
  if (remote) {
    try {
      await apiClient.music.updateListenSessionStatus(
        remote.base_url,
        sessionId,
        status,
      );
    } catch (error) {
      console.error("failed to update server session status:", error);
    }
  }

  setActiveServerSessionId(null);
  serverAccumulatedMs = 0;
  serverSongIndex = 0;
  serverSongPositionMs = 0;
  serverCompletedSongs = new Set();

  if (serverFlushIntervalId) {
    clearInterval(serverFlushIntervalId);
    serverFlushIntervalId = null;
  }
}

// resume an existing server session (from feed UI)
export async function resumeServerSession(
  sessionId: string,
  resumeState: {
    listened_duration_ms: number;
    songs_completed: number;
    current_song_index: number;
    current_song_position_ms: number;
  },
): Promise<void> {
  // stop any active session first
  if (activeServerSessionId()) {
    await stopServerSession("paused");
  }

  setActiveServerSessionId(sessionId);
  serverAccumulatedMs = resumeState.listened_duration_ms;
  serverSongIndex = resumeState.current_song_index;
  serverSongPositionMs = resumeState.current_song_position_ms;
  serverCompletedSongs = new Set();
  for (let i = 0; i < resumeState.songs_completed; i++) {
    serverCompletedSongs.add(i);
  }

  // update status to active
  const remote = getCurrentRemote();
  if (remote) {
    try {
      await apiClient.music.updateListenSessionStatus(
        remote.base_url,
        sessionId,
        "active",
      );
    } catch (error) {
      console.error("failed to resume server session:", error);
    }
  }

  // start periodic flush
  if (serverFlushIntervalId) clearInterval(serverFlushIntervalId);
  serverFlushIntervalId = setInterval(() => {
    void flushServerProgress();
  }, SERVER_FLUSH_INTERVAL_MS);
}
