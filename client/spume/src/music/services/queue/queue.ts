// centralized queue operations for music playback
// provides high-level queue manipulation, delegating persistence to db.ts
// and audio playback to player.ts
import {
  appState,
  setCurrentSong,
  setQueue,
  setQueueOpen,
} from "../../../app/services/storage/db";
import type { QueueHistoryEntry, QueueSourceContext } from "../../../app/services/storage/types";
import { evictCachedBlob } from "../cache/blobCache";
import { evictP2PBlob, preCacheNextP2PSongs, cancelP2PDownload } from "../storage/blobResolver";
import { clearPendingUpNext, pendingUpNextSha256, playSong, seek, stop } from "../audio/player";
import { hasPlaybackEnded } from "./queueState";
import { addHistoryEntry, updateHistoryEntrySongs, unwrapSongs } from "./queueHistory";
import { activeHistoryEntryId, resumeTracking, startTracking, stopTracking } from "./listenProgress";
import { clearAllQueueProgress, clearQueueItemProgress } from "./queueProgress";
import { createServerSession, stopServerSession, updateServerSessionSongs, activeServerSessionId, reconnectServerSession } from "./serverSession";
import { getQueueSizeLimit, showQueueFullModal } from "./queueLimit";
import { syncPlaylistToLocalFromQueue } from "../sync";
import type { Song } from "../storage/types";
import { leaveRadio } from "../../../app/services/radio/radioService";
import { clearCurrentRadioStation } from "../../../app/services/storage/currentRadioStation";

// re-export queue state so consumers can import everything from queue.ts
export {
  canGoNext,
  canGoPrevious,
  hasPlaybackEnded,
  markPlaybackEnded,
  resetPlaybackEnded,
} from "./queueState";

// re-export queue limit helper
export { getQueueSizeLimit } from "./queueLimit";

// source types whose `playQueue` calls should replace the current queue
// rather than insert after the currently-playing song. selecting an album,
// artist, genre, playlist, or shuffle (of an album/playlist) wipes whatever
// was queued before. single songs and radio stations still insert after.
const REPLACE_SOURCE_TYPES: ReadonlySet<string> = new Set([
  "album",
  "artist",
  "genre",
  "playlist",
  "shuffle",
]);

// check if songs can be structured-cloned (required for Tauri IPC and IndexedDB)
// logs a warning with diagnostic info if cloning fails after unwrapping
function assertCloneable(songs: Song[], context: string): void {
  try {
    structuredClone(songs);
  } catch (e) {
    // find which properties are causing the issue
    const problemProps: string[] = [];
    if (songs[0]) {
      for (const [key, value] of Object.entries(songs[0])) {
        try {
          structuredClone(value);
        } catch {
          problemProps.push(`${key} (${typeof value})`);
        }
      }
    }
    console.error(
      `[${context}] songs cannot be structured-cloned after unwrapping.`,
      `\nProblematic properties: ${problemProps.join(", ") || "unknown"}`,
      `\nThis will cause DataCloneError in Tauri IPC. Update unwrapSongs() to handle these properties.`,
      e,
    );
  }
}

// --- queue manipulation ---

// add songs to queue and play from a specific index
// used for "play all", "shuffle all", "play from here", etc.
// inserts songs after current position (preserves existing queue)
// plays songs[startIndex] (default 0) after adding to queue
// if songs exceed limit, truncates to fit (preserving startIndex)
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

  // unwrap SolidJS proxy objects before any IPC calls (Tauri structured clone)
  const unwrappedSongs = unwrapSongs(songs);
  assertCloneable(unwrappedSongs, "playQueue");

  let startIndex = options?.startIndex ?? 0;
  let finalSongs = unwrappedSongs;

  // truncate incoming songs if they exceed the limit (before any queue logic)
  const queueSizeLimit = getQueueSizeLimit();
  if (unwrappedSongs.length > queueSizeLimit) {
    if (startIndex < queueSizeLimit) {
      // startIndex is within limit - take first N songs
      finalSongs = unwrappedSongs.slice(0, queueSizeLimit);
    } else {
      // startIndex is beyond limit - center window around it
      const start = startIndex - Math.floor(queueSizeLimit / 2);
      const adjustedStart = Math.max(0, Math.min(start, unwrappedSongs.length - queueSizeLimit));
      finalSongs = unwrappedSongs.slice(adjustedStart, adjustedStart + queueSizeLimit);
      startIndex = startIndex - adjustedStart;
    }
    console.log(`[playQueue] truncated ${unwrappedSongs.length} songs to ${finalSongs.length} (limit: ${queueSizeLimit})`);
  }

  // mark songs from playlist source to skip album feed events when syncing
  if (options?.source?.type === "playlist") {
    finalSongs = finalSongs.map((s) => ({ ...s, skip_feed_events: true }));
  }

  const state = appState();
  const currentQueue: Song[] = state?.queue || [];
  const currentId = state?.current_sha256;

  // sync playlist to local storage (fires in background, non-blocking)
  if (options?.source) {
    void syncPlaylistToLocalFromQueue(finalSongs, options.source);
  }

  // if queue is empty, just set and play
  if (currentQueue.length === 0) {
    await setQueue(finalSongs);
    await playSong(finalSongs[startIndex], { userInitiated: true });
    void preCacheNextP2PSongs(finalSongs[startIndex].sha256, finalSongs);

    if (options?.source) {
      const entryId = await addHistoryEntry(finalSongs, options.source, options.resumeProgress);
      if (entryId) {
        if (options.resumeProgress) {
          resumeTracking(entryId, options.resumeProgress);
        } else {
          startTracking(entryId);
        }
      }
      if (!options?.skipServerSession) {
        void createServerSession(finalSongs, options.source, entryId ?? undefined);
      }
    }
    return;
  }

  // explicit replace: when the source is an album/artist/genre/playlist/shuffle
  // we wipe the current queue and start fresh (same shape as the empty-queue
  // branch above, but with cleanup of any prior tracking/server session).
  const shouldReplace =
    options?.source && REPLACE_SOURCE_TYPES.has(options.source.type);
  if (shouldReplace) {
    // tear down prior tracking + server session before swapping queues so
    // we don't end up with two listen sessions racing on the same songs.
    stopTracking(true);
    void stopServerSession("abandoned");
    clearAllQueueProgress();
    clearPendingUpNext();

    await setQueue(finalSongs);
    await playSong(finalSongs[startIndex], { userInitiated: true });
    void preCacheNextP2PSongs(finalSongs[startIndex].sha256, finalSongs);

    if (options?.source) {
      const entryId = await addHistoryEntry(
        finalSongs,
        options.source,
        options.resumeProgress,
      );
      if (entryId) {
        if (options.resumeProgress) {
          resumeTracking(entryId, options.resumeProgress);
        } else {
          startTracking(entryId);
        }
      }
      if (!options?.skipServerSession) {
        void createServerSession(finalSongs, options.source, entryId ?? undefined);
      }
    }
    return;
  }

  // queue has songs - insert after current position (don't replace)
  // check if adding would exceed limit
  const queueSizeLimitForPlay = getQueueSizeLimit();
  if (currentQueue.length + finalSongs.length > queueSizeLimitForPlay) {
    const choice = await showQueueFullModal(finalSongs, currentQueue.length);

    if (choice === "cancel") {
      return;
    }

    if (choice === "clear-all") {
      // user explicitly cleared - replace queue entirely
      await setQueue(finalSongs);
      await playSong(finalSongs[startIndex], { userInitiated: true });
      void preCacheNextP2PSongs(finalSongs[startIndex].sha256, finalSongs);
      if (options?.source) {
        const entryId = await addHistoryEntry(finalSongs, options.source);
        if (entryId) startTracking(entryId);
        if (!options?.skipServerSession) {
          void createServerSession(finalSongs, options.source, entryId ?? undefined);
        }
      }
      return;
    }

    // choice === "remove-from-start"
    const removeCount = currentQueue.length + finalSongs.length - queueSizeLimitForPlay;
    const currentIdx = currentId ? currentQueue.findIndex((s) => s.sha256 === currentId) : -1;
    const removableSongCount = currentIdx > 0 ? currentIdx : currentQueue.length;

    if (removeCount > removableSongCount) {
      // can't remove enough - fall back to clear behavior
      await setQueue(finalSongs);
      await playSong(finalSongs[startIndex], { userInitiated: true });
      void preCacheNextP2PSongs(finalSongs[startIndex].sha256, finalSongs);
      if (options?.source) {
        const entryId = await addHistoryEntry(finalSongs, options.source);
        if (entryId) startTracking(entryId);
        if (!options?.skipServerSession) {
          void createServerSession(finalSongs, options.source, entryId ?? undefined);
        }
      }
      return;
    }

    // trim songs from start of queue and continue
    const trimmedQueue = currentQueue.slice(removeCount);
    return playQueueInternal(finalSongs, trimmedQueue, currentId, startIndex, options);
  }

  return playQueueInternal(finalSongs, currentQueue, currentId, startIndex, options);
}

// internal: insert songs after current and play from startIndex
async function playQueueInternal(
  songs: Song[],
  currentQueue: Song[],
  currentId: string | null | undefined,
  startIndex: number,
  options?: {
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
  // insert after currently playing song
  let newQueue: Song[];
  if (!currentId) {
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

  await setQueue(newQueue);
  await playSong(songs[startIndex], { userInitiated: true });
  void preCacheNextP2PSongs(songs[startIndex].sha256, newQueue);

  if (options?.source) {
    const existingEntryId = activeHistoryEntryId();
    if (existingEntryId) {
      void updateHistoryEntrySongs(existingEntryId, newQueue);
      if (activeServerSessionId()) {
        void updateServerSessionSongs(newQueue);
      } else if (!options?.skipServerSession) {
        void createServerSession(newQueue, options.source, existingEntryId);
      }
    } else {
      const entryId = await addHistoryEntry(newQueue, options.source, options.resumeProgress);
      if (entryId) {
        if (options.resumeProgress) {
          resumeTracking(entryId, options.resumeProgress);
        } else {
          startTracking(entryId);
        }
      }
      if (!options?.skipServerSession) {
        void createServerSession(newQueue, options.source, entryId ?? undefined);
      }
    }
  }
}

// add songs to queue with flexible options
// handles both "add to end" and "play next" (insert after current) scenarios
// if songs exceed limit, truncates to first 150
// shows modal if adding would exceed queue limit
export async function addToQueue(
  songs: Song[],
  options?: {
    startPlaying?: boolean;
    position?: "end" | "next";
    source?: QueueSourceContext;
  },
): Promise<void> {
  if (songs.length === 0) return;

  // unwrap SolidJS proxy objects before any IPC calls (Tauri structured clone)
  const unwrappedSongs = unwrapSongs(songs);
  assertCloneable(unwrappedSongs, "addToQueue");

  // truncate incoming songs if they exceed the limit
  let finalSongs = unwrappedSongs;
  const queueSizeLimitForAdd = getQueueSizeLimit();
  if (unwrappedSongs.length > queueSizeLimitForAdd) {
    finalSongs = unwrappedSongs.slice(0, queueSizeLimitForAdd);
    console.log(`[addToQueue] truncated ${unwrappedSongs.length} songs to ${finalSongs.length} (limit: ${queueSizeLimitForAdd})`);
  }

  // mark songs from playlist source to skip album feed events when syncing
  if (options?.source?.type === "playlist") {
    finalSongs = finalSongs.map((s) => ({ ...s, skip_feed_events: true }));
  }

  const startPlaying = options?.startPlaying ?? false;
  const position = options?.position ?? "end";

  const state = appState();
  const currentQueue: Song[] = state?.queue || [];
  const currentId = state?.current_sha256;

  // sync playlist to local storage (fires in background, non-blocking)
  if (options?.source) {
    void syncPlaylistToLocalFromQueue(finalSongs, options.source);
  }

  // check if adding would exceed limit
  if (currentQueue.length + finalSongs.length > queueSizeLimitForAdd) {
    const choice = await showQueueFullModal(finalSongs, currentQueue.length);

    if (choice === "cancel") {
      return; // user cancelled, don't add anything
    }

    if (choice === "clear-all") {
      // clear queue and add new songs via playQueue (will handle empty queue path)
      await setQueue(finalSongs);
      if (startPlaying || !currentId) {
        await playSong(finalSongs[0], { userInitiated: true });
      }
      if (options?.source) {
        const entryId = await addHistoryEntry(finalSongs, options.source);
        if (entryId) startTracking(entryId);
        void createServerSession(finalSongs, options.source, entryId ?? undefined);
      }
      return;
    }

    // choice === "remove-from-start": remove oldest songs to make room
    const removeCount = currentQueue.length + finalSongs.length - queueSizeLimitForAdd;
    const currentIdx = currentId ? currentQueue.findIndex((s) => s.sha256 === currentId) : -1;
    const removableSongCount = currentIdx > 0 ? currentIdx : currentQueue.length;

    if (removeCount > removableSongCount) {
      // can't remove enough songs without affecting currently playing
      // fall back to clear-all behavior
      await setQueue(finalSongs);
      if (startPlaying || !currentId) {
        await playSong(finalSongs[0], { userInitiated: true });
      }
      if (options?.source) {
        const entryId = await addHistoryEntry(finalSongs, options.source);
        if (entryId) startTracking(entryId);
        void createServerSession(finalSongs, options.source, entryId ?? undefined);
      }
      return;
    }

    // remove songs from start (before currently playing)
    const trimmedQueue = currentQueue.slice(removeCount);
    return addToQueueInternal(finalSongs, trimmedQueue, currentId, startPlaying, position, options?.source);
  }

  return addToQueueInternal(finalSongs, currentQueue, currentId, startPlaying, position, options?.source);
}

// internal implementation of addToQueue (after limit check)
async function addToQueueInternal(
  songs: Song[],
  currentQueue: Song[],
  currentId: string | null | undefined,
  startPlaying: boolean,
  position: "end" | "next",
  source?: QueueSourceContext,
): Promise<void> {
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
  const willAutoPlay = startPlaying || !currentId || hasPlaybackEnded();
  if (willAutoPlay) {
    await playSong(songs[0], { userInitiated: true });
  }

  // pre-cache P2P songs (~30 min ahead from current position)
  // only trigger pre-cache when:
  // 1. starting playback (need immediate cache for smooth playback)
  // 2. adding as "next" (the song is within the 30-min rolling window)
  // skip pre-cache when adding to "end" and not starting playback
  // (the rolling 50% progress check will pick it up later if needed)
  const shouldPreCache = willAutoPlay || position === "next";
  const currentSha256 = currentId ?? songs[0]?.sha256;
  if (shouldPreCache && currentSha256) {
    void preCacheNextP2PSongs(currentSha256, newQueue);
  }

  // sync history + server session with the full queue
  if (source) {
    const existingEntryId = activeHistoryEntryId();
    if (existingEntryId) {
      // update the active history entry with the full queue
      void updateHistoryEntrySongs(existingEntryId, newQueue);
      // sync server session: update active session with full queue
      if (activeServerSessionId()) {
        void updateServerSessionSongs(newQueue);
      } else {
        // no active server session — create new and link to existing history entry
        void createServerSession(newQueue, source, existingEntryId);
      }
    } else {
      // no active entry — create a new one and start tracking
      const entryId = await addHistoryEntry(newQueue, source);
      if (entryId) {
        startTracking(entryId);
      }
      // create new server session linked to the new history entry
      void createServerSession(newQueue, source, entryId ?? undefined);
    }
  }
}

// remove a song from the queue by index
// stops playback if the removed song is currently playing
// clears pending up-next if the removed song was pending
// evicts cached audio if the song is no longer in the queue
export async function removeFromQueue(index: number): Promise<void> {
  const state = appState();
  if (!state?.queue) return;

  const removedSong = state.queue[index];
  const newQueue = state.queue.filter((_, i) => i !== index);
  await setQueue(newQueue);

  // clear progress for the removed song
  if (removedSong?.queue_entry_id) {
    clearQueueItemProgress(removedSong.queue_entry_id);
  }

  // if we removed the currently playing song, stop playback and clear it
  if (removedSong?.sha256 === state.current_sha256) {
    stop();
    await setCurrentSong(null);
  }

  // if we removed the pending up-next song, clear the pending state
  if (removedSong?.sha256 === pendingUpNextSha256()) {
    clearPendingUpNext();
  }

  // evict from cache if remote song is no longer anywhere in the queue
  if (removedSong?.source_type === "remote") {
    const stillInQueue = newQueue.some((s) => s.sha256 === removedSong.sha256);
    if (!stillInQueue) {
      // evict HTTP cache (keyed by remoteId + sha256)
      if (removedSong.remote_server_id) {
        void evictCachedBlob(removedSong.remote_server_id, removedSong.sha256);
      }
      // cancel in-progress P2P download and evict P2P cache (if applicable)
      if (removedSong.remote_server_id) {
        cancelP2PDownload(removedSong.sha256, removedSong.remote_server_id);
        void evictP2PBlob(removedSong.sha256, removedSong.remote_server_id);
      }
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

// clear all songs above the specified index (keep index and below)
export async function clearSongsAbove(index: number): Promise<void> {
  const state = appState();
  if (!state?.queue || index <= 0) return;

  const removedSongs = state.queue.slice(0, index);
  const newQueue = state.queue.slice(index);
  await setQueue(newQueue);

  // clear progress for removed songs
  for (const song of removedSongs) {
    if (song.queue_entry_id) {
      clearQueueItemProgress(song.queue_entry_id);
    }
  }

  // evict cached remote songs that are no longer in queue
  for (const song of removedSongs) {
    if (song.source_type === "remote" && song.remote_server_id) {
      const stillInQueue = newQueue.some((s) => s.sha256 === song.sha256);
      if (!stillInQueue) {
        void evictCachedBlob(song.remote_server_id, song.sha256);
        cancelP2PDownload(song.sha256, song.remote_server_id);
        void evictP2PBlob(song.sha256, song.remote_server_id);
      }
    }
  }

  // sync history + server session
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

// clear all songs below the specified index (keep index and above)
export async function clearSongsBelow(index: number): Promise<void> {
  const state = appState();
  if (!state?.queue || index >= state.queue.length - 1) return;

  const removedSongs = state.queue.slice(index + 1);
  const newQueue = state.queue.slice(0, index + 1);
  await setQueue(newQueue);

  // clear pending up-next if it was below this song
  const pendingSha = pendingUpNextSha256();
  if (pendingSha && removedSongs.some((s) => s.sha256 === pendingSha)) {
    clearPendingUpNext();
  }

  // clear progress for removed songs
  for (const song of removedSongs) {
    if (song.queue_entry_id) {
      clearQueueItemProgress(song.queue_entry_id);
    }
  }

  // evict cached remote songs that are no longer in queue
  for (const song of removedSongs) {
    if (song.source_type === "remote" && song.remote_server_id) {
      const stillInQueue = newQueue.some((s) => s.sha256 === song.sha256);
      if (!stillInQueue) {
        void evictCachedBlob(song.remote_server_id, song.sha256);
        cancelP2PDownload(song.sha256, song.remote_server_id);
        void evictP2PBlob(song.sha256, song.remote_server_id);
      }
    }
  }

  // sync history + server session
  if (newQueue.length > 0) {
    const entryId = activeHistoryEntryId();
    if (entryId) {
      void updateHistoryEntrySongs(entryId, newQueue);
    }
    void updateServerSessionSongs(newQueue);
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
// clears any pending up-next song
export async function clearQueue(): Promise<void> {
  const state = appState();
  console.info(
    `[clearQueue] START len=${state?.queue?.length ?? 0} current=${state?.current_sha256?.slice(0, 8) ?? "null"}`,
  );

  stop();
  stopTracking(true); // skipQueueSave - avoids race with setQueue([])
  clearAllQueueProgress();
  clearPendingUpNext();
  void stopServerSession("abandoned");
  await setCurrentSong(null);

  // stop radio if currently tuned. must be awaited before setQueue([])
  // below — clearCurrentRadioStation reads STORE_APP_STATE directly,
  // mutates one field, and writes back, so a fire-and-forget call
  // would race with setQueue([]) and resurrect the queue.
  leaveRadio();
  await clearCurrentRadioStation();

  // evict cached audio for all remote songs in the queue
  if (state?.queue) {
    for (const song of state.queue) {
      if (song.source_type === "remote") {
        // evict HTTP cache (keyed by remoteId + sha256)
        if (song.remote_server_id) {
          void evictCachedBlob(song.remote_server_id, song.sha256);
        }
        // cancel in-progress P2P download and evict P2P cache (if applicable)
        if (song.remote_server_id) {
          cancelP2PDownload(song.sha256, song.remote_server_id);
          void evictP2PBlob(song.sha256, song.remote_server_id);
        }
      }
    }
  }

  await setQueue([]);
  console.info(`[clearQueue] DONE — setQueue([]) persisted`);
}

// re-export db helpers that consumers commonly need alongside queue ops
export { setQueueOpen };

// resume a history entry from where it left off
export async function resumeHistoryEntry(
  entry: QueueHistoryEntry,
): Promise<void> {
  if (entry.songs.length === 0) return;

  const resumeIndex = Math.min(
    entry.current_song_index || 0,
    entry.songs.length - 1,
  );

  await setQueue(entry.songs);

  // play the song at the resume index
  const song = entry.songs[resumeIndex];
  await playSong(song, { userInitiated: true });

  // seek to saved position after a brief delay (audio needs to load)
  if (entry.current_song_position > 0) {
    // wait for audio to be ready before seeking
    setTimeout(() => {
      seek(entry.current_song_position);
    }, 200);
  }

  // resume progress tracking with existing state
  resumeTracking(entry.id, {
    listened_seconds: entry.listened_seconds || 0,
    songs_completed: entry.songs_completed || 0,
    current_song_index: resumeIndex,
    current_song_position: entry.current_song_position || 0,
  });

  // reconnect server session if the entry has server session info
  if (entry.server_session_id && entry.server_remote_id) {
    void reconnectServerSession({
      id: entry.id,
      server_session_id: entry.server_session_id,
      server_remote_id: entry.server_remote_id,
      label: entry.label,
      entity_id: entry.entity_id,
      songs_completed: entry.songs_completed || 0,
      songs: entry.songs,
    });
  }
}
