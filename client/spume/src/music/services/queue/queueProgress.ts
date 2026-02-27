// queue progress tracking for visual progress fill in queue sidebar
// tracks max progress (0-1) per queue_entry_id
// - in-memory signal for reactive display updates
// - persisted on song.queue_max_progress in IDB via queue save
import { createSignal } from "solid-js";
import { appState, setQueue } from "../../../app/services/storage/db";
import { debug } from "../../../utils/logger";

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
  debug("[queueProgress] cleared all progress");
}

// save progress to IDB by syncing to songs and persisting the queue
export async function saveProgressToIDB(): Promise<void> {
  const state = appState();
  if (!state?.queue) return;
  
  try {
    const map = progressMap();
    // sync progress map to songs
    const updatedQueue = state.queue.map(song => {
      if (song.queue_entry_id && map.has(song.queue_entry_id)) {
        return { ...song, queue_max_progress: map.get(song.queue_entry_id) };
      }
      return song;
    });
    
    await setQueue(updatedQueue);
    debug("[queueProgress] saved progress to IDB", { entries: map.size });
  } catch (err) {
    console.error("[queueProgress] failed to save progress:", err);
  }
}

// load progress from IDB - populate signal from songs' queue_max_progress
export function loadProgressFromStorage(): void {
  const state = appState();
  if (!state?.queue) return;
  
  const map = new Map<string, number>();
  for (const song of state.queue) {
    if (song.queue_entry_id && song.queue_max_progress !== undefined) {
      map.set(song.queue_entry_id, song.queue_max_progress);
    }
  }
  
  if (map.size > 0) {
    setProgressMap(map);
    debug("[queueProgress] loaded progress from IDB", { entries: map.size });
  }
}
