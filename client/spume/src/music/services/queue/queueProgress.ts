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

// save progress to IDB by syncing to songs/videos and persisting the queue.
//
// skips the setQueue() write entirely when nothing actually changed (e.g.
// a queue whose progress hasn't advanced since the last flush) -
// setQueue()/updateAppState() rebuild the whole queue array and AppState
// object unconditionally, so calling them on every periodic tick
// regardless of content churns appState()'s reference for no reason. that
// reference change is broadly observed (anything reading appState()
// directly, not just this queue's own progress bars), so a needless tick
// here was tearing down and rebuilding unrelated UI every few seconds -
// e.g. VideoMiniPlayer, whose live re-parented <video> element loses
// fullscreen the instant it gets reparented.
export async function saveProgressToIDB(): Promise<void> {
  const state = appState();
  if (!state?.queue) return;

  try {
    const map = progressMap();
    let changed = false;
    const updatedQueue = state.queue.map((item) => {
      const entryId = item.kind === "song" ? item.song.queue_entry_id : item.video.queue_entry_id;
      const currentProgress =
        item.kind === "song" ? item.song.queue_max_progress : item.video.queue_max_progress;
      const newProgress = entryId ? map.get(entryId) : undefined;
      if (newProgress === undefined || newProgress === currentProgress) return item;
      changed = true;
      return item.kind === "song"
        ? { kind: "song" as const, song: { ...item.song, queue_max_progress: newProgress } }
        : { kind: "video" as const, video: { ...item.video, queue_max_progress: newProgress } };
    });

    if (!changed) return;
    await setQueue(updatedQueue);
  } catch (err) {
    errorLog("queue.progress", "save failed:", err);
  }
}

// load progress from IDB - populate signal from songs'/videos' queue_max_progress.
export function loadProgressFromStorage(): void {
  const state = appState();
  if (!state?.queue) return;

  const map = new Map<string, number>();
  for (const item of state.queue) {
    const entryId = item.kind === "song" ? item.song.queue_entry_id : item.video.queue_entry_id;
    const progress =
      item.kind === "song" ? item.song.queue_max_progress : item.video.queue_max_progress;
    if (entryId && progress !== undefined) {
      map.set(entryId, progress);
    }
  }

  if (map.size > 0) {
    setProgressMap(map);
  }
}
