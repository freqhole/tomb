// queue history service — tracks what was added to the queue
// stores entries in freqhole_app indexed db with a 1,000 item cap
import { createSignal } from "solid-js";
import { initAppDB } from "../../../app/services/storage/db";
import {
  STORE_QUEUE_HISTORY,
  type QueueHistoryEntry,
  type QueueSourceContext,
} from "../../../app/services/storage/types";
import type { Song } from "../storage/types";
import { computeSmartLabel } from "./smartLabel";

const MAX_HISTORY_ENTRIES = 1000;

// reactive signal for history entries (sorted newest first)
const [queueHistory, setQueueHistory] = createSignal<QueueHistoryEntry[]>([]);
export { queueHistory };

// generate a simple uuid
function generateId(): string {
  return crypto.randomUUID();
}

// unwrap proxy arrays before storing songs in IndexedDB
function unwrapSongs(songs: Song[]): Song[] {
  return songs.map((song) => {
    const plain: Song = { ...song };
    if (song.album_tags) plain.album_tags = [...song.album_tags];
    if (song.album_genres)
      plain.album_genres = song.album_genres.map((g) => ({ ...g }));
    if (song.album_images)
      plain.album_images = song.album_images.map((img) => ({ ...img }));
    if (song.images) plain.images = song.images.map((img) => ({ ...img }));
    if (song.urls) plain.urls = song.urls.map((url) => ({ ...url }));
    return plain;
  });
}

// load history from idb into reactive signal
export async function loadQueueHistory(): Promise<void> {
  try {
    const db = await initAppDB();
    const all = await db.getAll(STORE_QUEUE_HISTORY);
    // sort newest first
    all.sort((a, b) => b.queued_at - a.queued_at);
    setQueueHistory(all);
  } catch (error) {
    console.error("failed to load queue history:", error);
  }
}

// add a history entry — returns the entry id
// when resumeProgress is provided, the entry is created with existing progress
// (used when resuming a server session that has no matching IDB entry)
export async function addHistoryEntry(
  songs: Song[],
  source: QueueSourceContext,
  resumeProgress?: {
    listened_seconds: number;
    songs_completed: number;
    current_song_index: number;
    current_song_position: number;
  },
): Promise<string | null> {
  if (songs.length === 0) return null;

  try {
    const db = await initAppDB();

    // pick the first available image from the songs for the thumbnail
    const firstImage =
      source.image ??
      songs[0]?.images?.[0] ??
      songs[0]?.album_images?.[0] ??
      undefined;

    const entry: QueueHistoryEntry = {
      id: generateId(),
      type: source.type,
      label: source.label,
      entity_id: source.entity_id,
      song_count: songs.length,
      songs: unwrapSongs(songs),
      queued_at: Date.now(),
      image: firstImage ? { ...firstImage } : undefined,
      // progress tracking — use resume state if provided, otherwise defaults
      listened_seconds: resumeProgress?.listened_seconds ?? 0,
      total_seconds: songs.reduce((sum, s) => sum + (s.duration_seconds || 0), 0),
      songs_completed: resumeProgress?.songs_completed ?? 0,
      current_song_index: resumeProgress?.current_song_index ?? 0,
      current_song_position: resumeProgress?.current_song_position ?? 0,
    };

    await db.put(STORE_QUEUE_HISTORY, entry);

    // enforce max entries cap
    const allEntries = await db.getAll(STORE_QUEUE_HISTORY);
    if (allEntries.length > MAX_HISTORY_ENTRIES) {
      // sort oldest first, delete extras
      allEntries.sort((a, b) => a.queued_at - b.queued_at);
      const toDelete = allEntries.slice(
        0,
        allEntries.length - MAX_HISTORY_ENTRIES,
      );
      const tx = db.transaction(STORE_QUEUE_HISTORY, "readwrite");
      for (const old of toDelete) {
        await tx.store.delete(old.id);
      }
      await tx.done;
    }

    // reload the signal
    await loadQueueHistory();

    return entry.id;
  } catch (error) {
    console.error("failed to add queue history entry:", error);
    return null;
  }
}

// remove a single history entry
export async function removeHistoryEntry(id: string): Promise<void> {
  try {
    const db = await initAppDB();
    await db.delete(STORE_QUEUE_HISTORY, id);
    await loadQueueHistory();
  } catch (error) {
    console.error("failed to remove history entry:", error);
  }
}

// update listen progress on a history entry (called periodically during playback)
export async function updateHistoryProgress(
  id: string,
  updates: {
    listened_seconds?: number;
    songs_completed?: number;
    current_song_index?: number;
    current_song_position?: number;
  },
): Promise<void> {
  try {
    const db = await initAppDB();
    const entry = await db.get(STORE_QUEUE_HISTORY, id);
    if (!entry) return;

    const updated = {
      ...entry,
      ...updates,
    };

    await db.put(STORE_QUEUE_HISTORY, updated);

    // update signal in-place (avoid full reload for frequent updates)
    setQueueHistory((prev) =>
      prev.map((e) => (e.id === id ? { ...e, ...updates } : e)),
    );
  } catch (error) {
    console.error("failed to update history progress:", error);
  }
}

// update the song list on an existing history entry
// called when songs are added to, removed from, or reordered in the queue
export async function updateHistoryEntrySongs(
  id: string,
  songs: Song[],
): Promise<void> {
  try {
    const db = await initAppDB();
    const entry = await db.get(STORE_QUEUE_HISTORY, id);
    if (!entry) return;

    // only recompute label when the entry didn't come from a named entity
    // (e.g. genre, artist, album, playlist keep their original label)
    const shouldKeepLabel = !!entry.entity_id;
    const updated: QueueHistoryEntry = {
      ...entry,
      songs: unwrapSongs(songs),
      song_count: songs.length,
      label: shouldKeepLabel ? entry.label : computeSmartLabel(songs),
      total_seconds: songs.reduce((sum, s) => sum + (s.duration_seconds || 0), 0),
    };

    await db.put(STORE_QUEUE_HISTORY, updated);

    // update signal in-place
    setQueueHistory((prev) =>
      prev.map((e) =>
        e.id === id
          ? { ...e, songs: updated.songs, song_count: updated.song_count, label: updated.label, total_seconds: updated.total_seconds }
          : e,
      ),
    );
  } catch (error) {
    console.error("failed to update history entry songs:", error);
  }
}

// clear all history
export async function clearQueueHistory(): Promise<void> {
  try {
    const db = await initAppDB();
    await db.clear(STORE_QUEUE_HISTORY);
    setQueueHistory([]);
  } catch (error) {
    console.error("failed to clear queue history:", error);
  }
}
