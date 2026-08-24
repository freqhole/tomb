// queue progress tracking for visual progress fill in queue sidebar
// tracks max progress (0-1) per queue_entry_id
// - in-memory signal for reactive display updates
// - persisted on song.queue_max_progress in IDB via queue save
import { createSignal } from "solid-js";
import { error as errorLog } from "../../../utils/logger";
import { appState, setQueue } from "../../../app/services/storage/db";

// reactive signal for live progress updates (queue_entry_id -> max progress 0-1)
const [progressMap, setProgressMap] = createSignal<Map<string, number>>(new Map());

// export for use in components
export { progressMap };

// update progress for the currently playing song (only stores the max)
export function updateQueueItemProgress(queueEntryId: string, progress: number): void {
  const currentMap = progressMap();
  const currentMax = currentMap.get(queueEntryId) ?? 0;

  // only update if new progress is higher
  if (progress > currentMax) {
    const newMap = new Map(currentMap);
    newMap.set(queueEntryId, progress);
    setProgressMap(newMap);
  }
}

// get progress for a song by queue_entry_id (0-1)
export function getQueueItemProgress(queueEntryId: string): number {
  return progressMap().get(queueEntryId) ?? 0;
}

// clear progress for a specific queue entry (called on remove)
export function clearQueueItemProgress(queueEntryId: string): void {
  const currentMap = progressMap();
  if (currentMap.has(queueEntryId)) {
    const newMap = new Map(currentMap);
    newMap.delete(queueEntryId);
    setProgressMap(newMap);
  }
}

// clear all progress (called on queue clear)
export function clearAllQueueProgress(): void {
  setProgressMap(new Map());
}

// save progress to IDB by syncing to songs and persisting the queue.
// video items are scoped out of progress tracking for now (see phase 9
// MVP scope note) — they pass through unmodified.
export async function saveProgressToIDB(): Promise<void> {
  const state = appState();
  if (!state?.queue) return;

  try {
    const map = progressMap();
    // sync progress map to song items only
    const updatedQueue = state.queue.map((item) => {
      if (item.kind !== "song") return item;
      const song = item.song;
      if (song.queue_entry_id && map.has(song.queue_entry_id)) {
        return {
          kind: "song" as const,
          song: { ...song, queue_max_progress: map.get(song.queue_entry_id) },
        };
      }
      return item;
    });

    await setQueue(updatedQueue);
  } catch (err) {
    errorLog("queue.progress", "save failed:", err);
  }
}

// load progress from IDB - populate signal from song items' queue_max_progress.
// video items don't participate in progress tracking yet.
export function loadProgressFromStorage(): void {
  const state = appState();
  if (!state?.queue) return;

  const map = new Map<string, number>();
  for (const item of state.queue) {
    if (item.kind !== "song") continue;
    const song = item.song;
    if (song.queue_entry_id && song.queue_max_progress !== undefined) {
      map.set(song.queue_entry_id, song.queue_max_progress);
    }
  }

  if (map.size > 0) {
    setProgressMap(map);
  }
}
