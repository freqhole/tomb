// centralized queue operations for music playback
// provides high-level queue manipulation, delegating persistence to db.ts
// and audio playback to player.ts
import { appState, setCurrentSong, setQueue, setQueueOpen } from "../../../app/services/storage/db";
import type { QueueHistoryEntry, QueueSourceContext } from "../../../app/services/storage/types";
import {
  mediaItemKey,
  mediaItemQueueEntryId,
  songsOnly,
  songStartIndexAfter,
  videosOnly,
  videoStartIndexAfter,
  songToMediaItem,
  toMediaItems,
  type MediaItem,
} from "../../../app/services/storage/mediaItem";
import { preCacheNextP2PSongs } from "../storage/blobResolver";
import { initQueueDeparturePurge } from "./purgeDepartedMedia";
import { preCacheNextVideos } from "../../../video/services/videoPreCache";
import {
  clearPendingUpNext,
  pendingUpNextSha256,
  playSong,
  playMediaItem,
  seek,
  stop,
} from "../audio/player";
import { hasPlaybackEnded } from "./queueState";
import { addHistoryEntry, updateHistoryEntrySongs, unwrapSongs } from "./queueHistory";
import { unwrapVideos } from "../../../video/services/queue/videoQueueHistory";
import {
  mirrorAppendToQueue,
  mirrorRemoveFromQueue,
  mirrorReorderQueue,
  mirrorReplaceQueue,
} from "../../../app/services/players/remoteQueueMirror";
import { isRemoteTargetActive } from "../../../app/services/players/activeTarget";
import {
  activeHistoryEntryId,
  resumeTracking,
  startTracking,
  stopTracking,
} from "./listenProgress";
import { stopVideoTracking } from "../../../video/services/queue/videoListenProgress";
import { clearAllQueueProgress, clearQueueItemProgress } from "./queueProgress";
import {
  createServerSession,
  stopServerSession,
  updateServerSessionItems,
  activeServerSessionId,
  activeSessionMatchesSource,
  reconnectServerSession,
} from "./serverSession";
import { getQueueSizeLimit, showQueueFullModal } from "./queueLimit";
import { showReplaceQueueConfirm } from "./queueReplaceConfirm";
import { syncPlaylistToLocalFromQueue } from "../sync";
import type { Song } from "../storage/types";
import { debug, error as errorLog } from "../../../utils/logger";
import { leaveRadio } from "../../../app/services/radio/radioService";
import { clearCurrentRadioStation } from "../../../app/services/storage/currentRadioStation";
import { registerStopMusic } from "../../../app/services/playbackCoordinator";

// re-export queue state so consumers can import everything from queue.ts
export {
  canGoNext,
  canGoPrevious,
  hasPlaybackEnded,
  markPlaybackEnded,
  resetPlaybackEnded,
} from "./queueState";

// immediate (queue-start/queue-modification) pre-cache trigger — mirrors
// preCacheScheduler.ts's rolling window, but fires right away instead of
// waiting for the 50%-progress tick, so the *next* item is already
// warming from time zero. `currentKey` is whatever `mediaItemKey()`
// returns for the item that's (about to be) playing — may be a song OR
// a video's key.
function triggerImmediatePreCache(
  mixedItems: MediaItem[],
  currentKey: string | null | undefined
): void {
  if (!currentKey) return;
  const songs = songsOnly(mixedItems);
  const videos = videosOnly(mixedItems);
  const currentIsVideo = mixedItems.some(
    (i) => i.kind === "video" && mediaItemKey(i) === currentKey
  );
  if (currentIsVideo) {
    // currentKey won't match anything in `songs` (song-only) - use the
    // mixed-queue-derived start index instead of preCacheNextP2PSongs's
    // own findIndex-based lookup so upcoming songs still get cached.
    void preCacheNextP2PSongs(null, songs, 30, songStartIndexAfter(mixedItems, currentKey));
  } else {
    // unchanged behavior: preCacheNextP2PSongs finds currentKey itself
    // and includes it (for immediate waveform display).
    void preCacheNextP2PSongs(currentKey, songs);
  }
  void preCacheNextVideos(videos, 30, videoStartIndexAfter(mixedItems, currentKey));
}

// re-export queue limit helper
export { getQueueSizeLimit } from "./queueLimit";

initQueueDeparturePurge();

// when radio takes over, wipe the music queue so a stray `ended`/`error`
// from the previously-loaded song can't auto-advance into another music
// track. this only touches queue state — radio is already orchestrating
// its own takeover, so we must NOT call leaveRadio() here (that would
// bump the in-flight tune attempt id and abort the tune that triggered
// us).
registerStopMusic(async () => {
  stopTracking(true);
  // this handler wipes the shared queue/current_sha256 below, which
  // video items ride on too (queue.ts's anti-hijack wipe predates video
  // support) — flush + clear video tracking the same way so a stale
  // `activeVideoHistoryEntryId` doesn't linger pointing at an entry the
  // now-cleared queue can no longer resolve.
  stopVideoTracking(true);
  clearAllQueueProgress();
  clearPendingUpNext();
  void stopServerSession("abandoned");
  await setCurrentSong(null);
  await setQueue([]);
});

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
    errorLog(
      "queue",
      `[${context}] songs cannot be structured-cloned; problematic props: ${problemProps.join(", ") || "unknown"} — update unwrapSongs()`,
      e
    );
  }
}

// --- queue manipulation ---

// unwrap solid-proxy-wrapped song/video objects across a mixed `MediaItem[]`
// (required for Tauri IPC/IndexedDB structured-clone) — dispatches to the
// existing per-kind unwrap helpers (`unwrapSongs`/`unwrapVideos`) while
// preserving order.
function unwrapMediaItems(items: MediaItem[]): MediaItem[] {
  const unwrappedSongs = unwrapSongs(items.filter((i) => i.kind === "song").map((i) => i.song));
  const unwrappedVideos = unwrapVideos(items.filter((i) => i.kind === "video").map((i) => i.video));
  let songIdx = 0;
  let videoIdx = 0;
  return items.map((item) =>
    item.kind === "song"
      ? { kind: "song", song: unwrappedSongs[songIdx++] }
      : { kind: "video", video: unwrappedVideos[videoIdx++] }
  );
}

// normalize + unwrap a queue-input array (legacy `Song[]` callers or newer
// mixed `MediaItem[]` callers) into a ready-to-queue `MediaItem[]`
function prepareMediaItems(items: Array<Song | MediaItem>): MediaItem[] {
  return unwrapMediaItems(toMediaItems(items));
}

// add songs to queue and play from a specific index
// used for "play all", "shuffle all", "play from here", etc.
// inserts songs after current position (preserves existing queue)
// plays songs[startIndex] (default 0) after adding to queue
// if songs exceed limit, truncates to fit (preserving startIndex)
export async function playQueue(
  songs: Array<Song | MediaItem>,
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
  }
): Promise<void> {
  if (songs.length === 0) return;

  // unwrap SolidJS proxy objects before any IPC calls (Tauri structured clone)
  const unwrappedItems = prepareMediaItems(songs);
  assertCloneable(songsOnly(unwrappedItems), "playQueue");

  let startIndex = options?.startIndex ?? 0;
  let finalItems = unwrappedItems;

  // truncate incoming items if they exceed the limit (before any queue logic)
  const queueSizeLimit = getQueueSizeLimit();
  if (unwrappedItems.length > queueSizeLimit) {
    if (startIndex < queueSizeLimit) {
      // startIndex is within limit - take first N items
      finalItems = unwrappedItems.slice(0, queueSizeLimit);
    } else {
      // startIndex is beyond limit - center window around it
      const start = startIndex - Math.floor(queueSizeLimit / 2);
      const adjustedStart = Math.max(0, Math.min(start, unwrappedItems.length - queueSizeLimit));
      finalItems = unwrappedItems.slice(adjustedStart, adjustedStart + queueSizeLimit);
      startIndex = startIndex - adjustedStart;
    }
    debug(
      "queue",
      `playQueue: truncated to ${finalItems.length}/${unwrappedItems.length} (limit=${queueSizeLimit})`
    );
  }

  // mark songs from playlist source to skip album feed events when syncing
  // (video items have no equivalent flag yet - feed events are song-only)
  if (options?.source?.type === "playlist") {
    finalItems = finalItems.map((item) =>
      item.kind === "song" ? { kind: "song", song: { ...item.song, skip_feed_events: true } } : item
    );
  }

  const state = appState();
  const currentQueue: MediaItem[] = state?.queue || [];
  const currentId = state?.current_sha256;

  // song-only side systems (history, server sessions, pre-cache, local
  // sync) still operate on the song subset only - video items ride along
  // in the queue itself but aren't tracked by these yet (see phase 5 of
  // docs/playlist-unification-plan.md for full parity plans).
  const finalSongs = songsOnly(finalItems);

  // sync playlist to local storage (fires in background, non-blocking)
  if (options?.source) {
    void syncPlaylistToLocalFromQueue(finalSongs, options.source);
  }

  // if queue is empty, just set and play
  if (currentQueue.length === 0) {
    await setQueue(finalItems);
    mirrorReplaceQueue(finalSongs);
    const startItem = finalItems[startIndex];
    await playMediaItem(startItem, { userInitiated: true });
    triggerImmediatePreCache(finalItems, mediaItemKey(startItem));

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
        void createServerSession(finalItems, options.source, entryId ?? undefined);
      }
    }
    return;
  }

  // explicit replace: when the source is an album/artist/genre/playlist/shuffle
  // we wipe the current queue and start fresh (same shape as the empty-queue
  // branch above, but with cleanup of any prior tracking/server session).
  const shouldReplace = options?.source && REPLACE_SOURCE_TYPES.has(options.source.type);
  if (shouldReplace) {
    // a remote target shares this queue with every other connected client -
    // confirm before wiping it out from under them (local-only playback
    // keeps replacing instantly, as before).
    if (isRemoteTargetActive() && currentQueue.length > 0) {
      const choice = await showReplaceQueueConfirm(finalItems);
      if (choice === "cancel") return;
      if (choice === "append") {
        return addToQueue(finalItems, { position: "end", source: options?.source });
      }
    }

    // reuse the existing session (same entity + type already playing, e.g.
    // skipping to another song within the same album/playlist/shuffle) so
    // we don't mint a duplicate listen session + feed event.
    const reuseSession = !!options?.source && activeSessionMatchesSource(options.source);

    // tear down prior tracking before swapping queues; only tear down the
    // server session when it's for a different entity than what's reused.
    stopTracking(true);
    if (!reuseSession) {
      void stopServerSession("abandoned");
    }
    clearAllQueueProgress();
    clearPendingUpNext();

    await setQueue(finalItems);
    mirrorReplaceQueue(finalSongs);
    const startItem = finalItems[startIndex];
    await playMediaItem(startItem, { userInitiated: true });
    triggerImmediatePreCache(finalItems, mediaItemKey(startItem));

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
        if (reuseSession) {
          void updateServerSessionItems(finalItems, entryId ?? undefined);
        } else {
          void createServerSession(finalItems, options.source, entryId ?? undefined);
        }
      }
    }
    return;
  }

  // queue has items - insert after current position (don't replace)
  // check if adding would exceed limit
  const queueSizeLimitForPlay = getQueueSizeLimit();
  if (currentQueue.length + finalItems.length > queueSizeLimitForPlay) {
    const choice = await showQueueFullModal(finalItems, currentQueue.length);

    if (choice === "cancel") {
      return;
    }

    if (choice === "clear-all") {
      // user explicitly cleared - replace queue entirely
      await setQueue(finalItems);
      const startItem = finalItems[startIndex];
      await playMediaItem(startItem, { userInitiated: true });
      triggerImmediatePreCache(finalItems, mediaItemKey(startItem));
      if (options?.source) {
        const entryId = await addHistoryEntry(finalSongs, options.source);
        if (entryId) startTracking(entryId);
        if (!options?.skipServerSession) {
          void createServerSession(finalItems, options.source, entryId ?? undefined);
        }
      }
      return;
    }

    // choice === "remove-from-start"
    const removeCount = currentQueue.length + finalItems.length - queueSizeLimitForPlay;
    const currentIdx = currentId
      ? currentQueue.findIndex((i) => mediaItemKey(i) === currentId)
      : -1;
    const removableSongCount = currentIdx > 0 ? currentIdx : currentQueue.length;

    if (removeCount > removableSongCount) {
      // can't remove enough - fall back to clear behavior
      await setQueue(finalItems);
      const startItem = finalItems[startIndex];
      await playMediaItem(startItem, { userInitiated: true });
      triggerImmediatePreCache(finalItems, mediaItemKey(startItem));
      if (options?.source) {
        const entryId = await addHistoryEntry(finalSongs, options.source);
        if (entryId) startTracking(entryId);
        if (!options?.skipServerSession) {
          void createServerSession(finalItems, options.source, entryId ?? undefined);
        }
      }
      return;
    }

    // trim items from start of queue and continue
    const trimmedQueue = currentQueue.slice(removeCount);
    return playQueueInternal(finalItems, trimmedQueue, currentId, startIndex, options);
  }

  return playQueueInternal(finalItems, currentQueue, currentId, startIndex, options);
}

// internal: insert songs after current and play from startIndex
async function playQueueInternal(
  items: MediaItem[],
  currentQueue: MediaItem[],
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
  }
): Promise<void> {
  // insert after currently playing song
  let newQueue: MediaItem[];
  if (!currentId) {
    newQueue = [...items, ...currentQueue];
  } else {
    const currentIdx = currentQueue.findIndex((i) => mediaItemKey(i) === currentId);
    if (currentIdx === -1) {
      newQueue = [...currentQueue, ...items];
    } else {
      newQueue = [
        ...currentQueue.slice(0, currentIdx + 1),
        ...items,
        ...currentQueue.slice(currentIdx + 1),
      ];
    }
  }

  await setQueue(newQueue);
  await playMediaItem(items[startIndex], { userInitiated: true });
  const newQueueSongs = songsOnly(newQueue);
  const startItem = items[startIndex];
  triggerImmediatePreCache(newQueue, mediaItemKey(startItem));

  if (options?.source) {
    const existingEntryId = activeHistoryEntryId();
    if (existingEntryId) {
      void updateHistoryEntrySongs(existingEntryId, newQueueSongs);
      if (activeServerSessionId()) {
        void updateServerSessionItems(newQueue);
      } else if (!options?.skipServerSession) {
        void createServerSession(newQueue, options.source, existingEntryId);
      }
    } else {
      const entryId = await addHistoryEntry(newQueueSongs, options.source, options.resumeProgress);
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
  songs: Array<Song | MediaItem>,
  options?: {
    startPlaying?: boolean;
    position?: "end" | "next";
    source?: QueueSourceContext;
  }
): Promise<void> {
  if (songs.length === 0) return;

  // unwrap SolidJS proxy objects before any IPC calls (Tauri structured clone)
  const unwrappedItems = prepareMediaItems(songs);
  assertCloneable(songsOnly(unwrappedItems), "addToQueue");

  // truncate incoming items if they exceed the limit
  let finalItems = unwrappedItems;
  const queueSizeLimitForAdd = getQueueSizeLimit();
  if (unwrappedItems.length > queueSizeLimitForAdd) {
    finalItems = unwrappedItems.slice(0, queueSizeLimitForAdd);
    debug(
      "queue",
      `addToQueue: truncated to ${finalItems.length}/${unwrappedItems.length} (limit=${queueSizeLimitForAdd})`
    );
  }

  // mark songs from playlist source to skip album feed events when syncing
  // (video items have no equivalent flag yet - feed events are song-only)
  if (options?.source?.type === "playlist") {
    finalItems = finalItems.map((item) =>
      item.kind === "song" ? { kind: "song", song: { ...item.song, skip_feed_events: true } } : item
    );
  }

  const startPlaying = options?.startPlaying ?? false;
  const position = options?.position ?? "end";

  const state = appState();
  const currentQueue: MediaItem[] = state?.queue || [];
  const currentId = state?.current_sha256;

  // song-only side systems (history, server sessions, local sync) still
  // operate on the song subset only - see phase 5 of
  // docs/playlist-unification-plan.md for full video parity plans.
  const finalSongs = songsOnly(finalItems);

  // sync playlist to local storage (fires in background, non-blocking)
  if (options?.source) {
    void syncPlaylistToLocalFromQueue(finalSongs, options.source);
  }

  // check if adding would exceed limit
  if (currentQueue.length + finalItems.length > queueSizeLimitForAdd) {
    const choice = await showQueueFullModal(finalItems, currentQueue.length);

    if (choice === "cancel") {
      return; // user cancelled, don't add anything
    }

    if (choice === "clear-all") {
      // clear queue and add new items via playQueue (will handle empty queue path)
      await setQueue(finalItems);
      if (startPlaying || !currentId || hasPlaybackEnded()) {
        await playMediaItem(finalItems[0], { userInitiated: true });
      }
      if (options?.source) {
        const entryId = await addHistoryEntry(finalSongs, options.source);
        if (entryId) startTracking(entryId);
        void createServerSession(finalItems, options.source, entryId ?? undefined);
      }
      return;
    }

    // choice === "remove-from-start": remove oldest items to make room
    const removeCount = currentQueue.length + finalItems.length - queueSizeLimitForAdd;
    const currentIdx = currentId
      ? currentQueue.findIndex((i) => mediaItemKey(i) === currentId)
      : -1;
    const removableSongCount = currentIdx > 0 ? currentIdx : currentQueue.length;

    if (removeCount > removableSongCount) {
      // can't remove enough items without affecting currently playing
      // fall back to clear-all behavior
      await setQueue(finalItems);
      if (startPlaying || !currentId || hasPlaybackEnded()) {
        await playMediaItem(finalItems[0], { userInitiated: true });
      }
      if (options?.source) {
        const entryId = await addHistoryEntry(finalSongs, options.source);
        if (entryId) startTracking(entryId);
        void createServerSession(finalItems, options.source, entryId ?? undefined);
      }
      return;
    }

    // remove items from start (before currently playing)
    const trimmedQueue = currentQueue.slice(removeCount);
    return addToQueueInternal(
      finalItems,
      trimmedQueue,
      currentId,
      startPlaying,
      position,
      options?.source
    );
  }

  return addToQueueInternal(
    finalItems,
    currentQueue,
    currentId,
    startPlaying,
    position,
    options?.source
  );
}

// internal implementation of addToQueue (after limit check)
async function addToQueueInternal(
  items: MediaItem[],
  currentQueue: MediaItem[],
  currentId: string | null | undefined,
  startPlaying: boolean,
  position: "end" | "next",
  source?: QueueSourceContext
): Promise<void> {
  let newQueue: MediaItem[];

  if (position === "next") {
    // insert after currently playing song
    if (!currentId || currentQueue.length === 0) {
      newQueue = [...items, ...currentQueue];
    } else {
      const currentIdx = currentQueue.findIndex((i) => mediaItemKey(i) === currentId);
      if (currentIdx === -1) {
        newQueue = [...currentQueue, ...items];
      } else {
        newQueue = [
          ...currentQueue.slice(0, currentIdx + 1),
          ...items,
          ...currentQueue.slice(currentIdx + 1),
        ];
      }
    }
  } else {
    newQueue = [...currentQueue, ...items];
  }

  await setQueue(newQueue);

  // an already-active remote target keeps playing what it has - newly
  // added songs just extend its queue, they don't take over playback (a
  // fresh replaceQueue only happens via the "play on" handoff itself).
  mirrorAppendToQueue(songsOnly(items));

  // autoplay if: explicitly requested, nothing is currently playing, or playback ended
  const willAutoPlay = startPlaying || !currentId || hasPlaybackEnded();
  if (willAutoPlay) {
    await playMediaItem(items[0], { userInitiated: true });
  }

  // pre-cache P2P songs/videos (~30 min ahead from current position)
  // only trigger pre-cache when:
  // 1. starting playback (need immediate cache for smooth playback)
  // 2. adding as "next" (the item is within the 30-min rolling window)
  // skip pre-cache when adding to "end" and not starting playback
  // (the rolling 50% progress check will pick it up later if needed)
  const newQueueSongs = songsOnly(newQueue);
  const shouldPreCache = willAutoPlay || position === "next";
  const currentKey = currentId ?? mediaItemKey(items[0]);
  if (shouldPreCache && currentKey) {
    triggerImmediatePreCache(newQueue, currentKey);
  }

  // sync history + server session with the full queue
  if (source) {
    const existingEntryId = activeHistoryEntryId();
    if (existingEntryId) {
      // update the active history entry with the full queue
      void updateHistoryEntrySongs(existingEntryId, newQueueSongs);
      // sync server session: update active session with full queue
      if (activeServerSessionId()) {
        void updateServerSessionItems(newQueue);
      } else {
        // no active server session — create new and link to existing history entry
        void createServerSession(newQueue, source, existingEntryId);
      }
    } else {
      // no active entry — create a new one and start tracking
      const entryId = await addHistoryEntry(newQueueSongs, source);
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

  const currentIdx = state.queue.findIndex((i) => mediaItemKey(i) === state.current_sha256);
  mirrorRemoveFromQueue(index, currentIdx);

  const removedItem = state.queue[index];
  const newQueue = state.queue.filter((_, i) => i !== index);
  await setQueue(newQueue);

  // clear progress for the removed item
  const removedEntryId = removedItem ? mediaItemQueueEntryId(removedItem) : undefined;
  if (removedEntryId) {
    clearQueueItemProgress(removedEntryId);
  }

  const removedKey = removedItem ? mediaItemKey(removedItem) : undefined;

  // if we removed the currently playing item, stop playback and clear it
  if (removedKey && removedKey === state.current_sha256) {
    stop();
    await setCurrentSong(null);
  }

  // if we removed the pending up-next item, clear the pending state
  if (removedKey && removedKey === pendingUpNextSha256()) {
    clearPendingUpNext();
  }

  // sync history + server session with updated queue
  const newQueueSongs = songsOnly(newQueue);
  if (newQueue.length > 0) {
    const entryId = activeHistoryEntryId();
    if (entryId) {
      void updateHistoryEntrySongs(entryId, newQueueSongs);
    }
    void updateServerSessionItems(newQueue);
  } else {
    stopTracking();
    void stopServerSession("abandoned");
  }
}

// clear all songs above the specified index (keep index and below)
export async function clearSongsAbove(index: number): Promise<void> {
  const state = appState();
  if (!state?.queue || index <= 0) return;

  const removedItems = state.queue.slice(0, index);
  const newQueue = state.queue.slice(index);
  await setQueue(newQueue);

  // clear progress for removed items
  for (const item of removedItems) {
    const entryId = mediaItemQueueEntryId(item);
    if (entryId) {
      clearQueueItemProgress(entryId);
    }
  }

  // sync history + server session
  const newQueueSongs = songsOnly(newQueue);
  if (newQueue.length > 0) {
    const entryId = activeHistoryEntryId();
    if (entryId) {
      void updateHistoryEntrySongs(entryId, newQueueSongs);
    }
    void updateServerSessionItems(newQueue);
  } else {
    stopTracking();
    void stopServerSession("abandoned");
  }
}

// clear all songs below the specified index (keep index and above)
export async function clearSongsBelow(index: number): Promise<void> {
  const state = appState();
  if (!state?.queue || index >= state.queue.length - 1) return;

  const removedItems = state.queue.slice(index + 1);
  const newQueue = state.queue.slice(0, index + 1);
  await setQueue(newQueue);

  // clear pending up-next if it was below this song
  const pendingSha = pendingUpNextSha256();
  if (pendingSha && removedItems.some((i) => mediaItemKey(i) === pendingSha)) {
    clearPendingUpNext();
  }

  // clear progress for removed items
  for (const item of removedItems) {
    const entryId = mediaItemQueueEntryId(item);
    if (entryId) {
      clearQueueItemProgress(entryId);
    }
  }

  // sync history + server session
  const newQueueSongs = songsOnly(newQueue);
  if (newQueue.length > 0) {
    const entryId = activeHistoryEntryId();
    if (entryId) {
      void updateHistoryEntrySongs(entryId, newQueueSongs);
    }
    void updateServerSessionItems(newQueue);
  }
}

// reorder a song within the queue (drag-and-drop)
export async function reorderQueue(fromIndex: number, toIndex: number): Promise<void> {
  const state = appState();
  if (!state?.queue) return;

  const currentIdx = state.queue.findIndex((i) => mediaItemKey(i) === state.current_sha256);
  mirrorReorderQueue(fromIndex, toIndex, currentIdx);

  const newQueue = [...state.queue];
  const [movedItem] = newQueue.splice(fromIndex, 1);
  newQueue.splice(toIndex, 0, movedItem);
  await setQueue(newQueue);

  // sync history + server session with reordered queue
  const newQueueSongs = songsOnly(newQueue);
  const entryId = activeHistoryEntryId();
  if (entryId) {
    void updateHistoryEntrySongs(entryId, newQueueSongs);
  }
  void updateServerSessionItems(newQueue);
}

// clear the entire queue and stop playback
// evicts all cached remote songs from the queue
// clears any pending up-next song
export async function clearQueue(): Promise<void> {
  const state = appState();
  debug(
    "queue",
    `clearQueue: len=${state?.queue?.length ?? 0} current=${state?.current_sha256?.slice(0, 8) ?? null}`
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

  await setQueue([]);
  debug("queue", "clearQueue complete");
}

// re-export db helpers that consumers commonly need alongside queue ops
export { setQueueOpen };

// resume a history entry from where it left off
export async function resumeHistoryEntry(entry: QueueHistoryEntry): Promise<void> {
  if (entry.songs.length === 0) return;

  const resumeIndex = Math.min(entry.current_song_index || 0, entry.songs.length - 1);

  await setQueue(entry.songs.map(songToMediaItem));

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
      type: entry.type,
      entity_id: entry.entity_id,
      songs_completed: entry.songs_completed || 0,
      songs: entry.songs,
    });
  }
}
