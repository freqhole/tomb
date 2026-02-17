// centralized queue operations for music playback
// provides high-level queue manipulation, delegating persistence to db.ts
// and audio playback to player.ts
import {
  appState,
  setCurrentSong,
  setQueue,
  setQueueOpen,
} from "../../../app/services/storage/db";
import type { QueueSourceContext } from "../../../app/services/storage/types";
import { evictCachedBlob } from "../cache/blobCache";
import { playSong, stop } from "../audio/player";
import { hasPlaybackEnded } from "./queueState";
import { addHistoryEntry, updateHistoryEntrySongs } from "./queueHistory";
import { activeHistoryEntryId, startTracking, stopTracking } from "./listenProgress";
import { createServerSession, stopServerSession, updateServerSessionSongs, activeServerSessionId } from "./serverSession";
import type { Song } from "../storage/types";

// re-export queue state so consumers can import everything from queue.ts
export {
  canGoNext,
  canGoPrevious,
  hasPlaybackEnded,
  markPlaybackEnded,
  resetPlaybackEnded,
} from "./queueState";

// --- queue manipulation ---

// replace queue and play a song from it
// used for "play all", "shuffle all", "play from here", etc.
// plays songs[startIndex] (default 0) after setting the queue
export async function playQueue(
  songs: Song[],
  options?: {
    startIndex?: number;
    source?: QueueSourceContext;
    skipServerSession?: boolean;
    resumeProgress?: {
      listened_seconds: number;
      songs_completed: number;
      current_song_index: number;
      current_song_position: number;
    };
  },
): Promise<void> {
  if (songs.length === 0) return;

  const startIndex = options?.startIndex ?? 0;
  await setQueue(songs);
  await playSong(songs[startIndex]);

  // record history and start progress tracking
  if (options?.source) {
    const entryId = await addHistoryEntry(songs, options.source, options.resumeProgress);
    if (entryId) {
      if (options.resumeProgress) {
        // resume tracking with existing progress state
        const { resumeTracking } = await import("./listenProgress");
        resumeTracking(entryId, options.resumeProgress);
      } else {
        startTracking(entryId);
      }
    }
    // create server-side listen session (fire and forget)
    // skip when caller will handle session tracking (e.g. resuming an existing session)
    if (!options?.skipServerSession) {
      void createServerSession(songs, options.source);
    }
  }
}

// add songs to queue with flexible options
// handles both "add to end" and "play next" (insert after current) scenarios
export async function addToQueue(
  songs: Song[],
  options?: {
    startPlaying?: boolean;
    position?: "end" | "next";
    source?: QueueSourceContext;
  },
): Promise<void> {
  if (songs.length === 0) return;

  const startPlaying = options?.startPlaying ?? false;
  const position = options?.position ?? "end";

  const { queue, current_sha256 } = appState();
  const currentQueue = queue || [];
  const currentId = current_sha256;

  let newQueue: Song[];

  if (position === "next") {
    // insert after currently playing song
    if (!currentId || currentQueue.length === 0) {
      newQueue = [...songs, ...currentQueue];
    } else {
      const currentIdx = currentQueue.findIndex((s) => s.sha256 === currentId);
      if (currentIdx === -1) {
        newQueue = [...currentQueue, ...songs];
      } else {
        newQueue = [
          ...currentQueue.slice(0, currentIdx + 1),
          ...songs,
          ...currentQueue.slice(currentIdx + 1),
        ];
      }
    }
  } else {
    newQueue = [...currentQueue, ...songs];
  }

  await setQueue(newQueue);

  // autoplay if: explicitly requested, nothing is currently playing, or playback ended
  if (startPlaying || !current_sha256 || hasPlaybackEnded()) {
    await playSong(songs[0]);
  }

  // sync history + server session with the full queue
  if (options?.source) {
    const existingEntryId = activeHistoryEntryId();
    if (existingEntryId) {
      // update the active history entry with the full queue
      void updateHistoryEntrySongs(existingEntryId, newQueue);
    } else {
      // no active entry — create a new one and start tracking
      const entryId = await addHistoryEntry(newQueue, options.source);
      if (entryId) {
        startTracking(entryId);
      }
    }
    // sync server session: update active session with full queue, or create new
    if (activeServerSessionId()) {
      void updateServerSessionSongs(newQueue);
    } else {
      void createServerSession(newQueue, options.source);
    }
  }
}

// remove a song from the queue by index
// stops playback if the removed song is currently playing
// evicts cached audio if the song is no longer in the queue
export async function removeFromQueue(index: number): Promise<void> {
  const state = appState();
  if (!state?.queue) return;

  const removedSong = state.queue[index];
  const newQueue = state.queue.filter((_, i) => i !== index);
  await setQueue(newQueue);

  // if we removed the currently playing song, stop playback and clear it
  if (removedSong?.sha256 === state.current_sha256) {
    stop();
    await setCurrentSong(null);
  }

  // evict from cache if remote song is no longer anywhere in the queue
  if (removedSong?.source_url && removedSong.source_type === "remote") {
    const stillInQueue = newQueue.some((s) => s.sha256 === removedSong.sha256);
    if (!stillInQueue) {
      void evictCachedBlob(removedSong.source_url);
    }
  }

  // sync history + server session with updated queue
  if (newQueue.length > 0) {
    const entryId = activeHistoryEntryId();
    if (entryId) {
      void updateHistoryEntrySongs(entryId, newQueue);
    }
    void updateServerSessionSongs(newQueue);
  } else {
    stopTracking();
    void stopServerSession("abandoned");
  }
}

// reorder a song within the queue (drag-and-drop)
export async function reorderQueue(
  fromIndex: number,
  toIndex: number,
): Promise<void> {
  const state = appState();
  if (!state?.queue) return;

  const newQueue = [...state.queue];
  const [movedSong] = newQueue.splice(fromIndex, 1);
  newQueue.splice(toIndex, 0, movedSong);
  await setQueue(newQueue);

  // sync history + server session with reordered queue
  const entryId = activeHistoryEntryId();
  if (entryId) {
    void updateHistoryEntrySongs(entryId, newQueue);
  }
  void updateServerSessionSongs(newQueue);
}

// clear the entire queue and stop playback
// evicts all cached remote songs from the queue
export async function clearQueue(): Promise<void> {
  const state = appState();

  stop();
  stopTracking();
  void stopServerSession("abandoned");
  await setCurrentSong(null);

  // evict cached audio for all remote songs in the queue
  if (state?.queue) {
    for (const song of state.queue) {
      if (song.source_url && song.source_type === "remote") {
        void evictCachedBlob(song.source_url);
      }
    }
  }

  await setQueue([]);
}

// re-export db helpers that consumers commonly need alongside queue ops
export { setQueueOpen };

// resume a history entry from where it left off
export async function resumeHistoryEntry(
  entry: import("../../../app/services/storage/types").QueueHistoryEntry,
): Promise<void> {
  if (entry.songs.length === 0) return;

  const resumeIndex = Math.min(
    entry.current_song_index || 0,
    entry.songs.length - 1,
  );

  await setQueue(entry.songs);

  // play the song at the resume index
  const song = entry.songs[resumeIndex];
  await playSong(song);

  // seek to saved position after a brief delay (audio needs to load)
  if (entry.current_song_position > 0) {
    const { seek } = await import("../audio/player");
    // wait for audio to be ready before seeking
    setTimeout(() => {
      seek(entry.current_song_position);
    }, 200);
  }

  // resume progress tracking with existing state
  const { resumeTracking } = await import("./listenProgress");
  resumeTracking(entry.id, {
    listened_seconds: entry.listened_seconds || 0,
    songs_completed: entry.songs_completed || 0,
    current_song_index: resumeIndex,
    current_song_position: entry.current_song_position || 0,
  });
}
