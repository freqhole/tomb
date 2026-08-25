// video queue history service — tracks what was added to the video queue
// mirrors music/services/queue/queueHistory.ts's shape but for videos.
// stores entries in freqhole_app indexed db with a 200 item cap (smaller
// than the song history's 1,000 — video entries carry a `videos` array
// that tends to be larger per-entry, e.g. a whole series/season).
import { createSignal } from "solid-js";
import { error as errorLog } from "../../../utils/logger";
import { initAppDB } from "../../../app/services/storage/db";
import {
  STORE_VIDEO_QUEUE_HISTORY,
  type VideoQueueHistoryEntry,
  type VideoQueueSourceContext,
} from "../../../app/services/storage/types";
import type { QueuedVideo } from "../../../app/services/storage/mediaItem";
import { getCurrentRemote } from "../../../music/data";

const MAX_HISTORY_ENTRIES = 200;

// reactive signal for history entries (sorted newest first)
const [videoQueueHistory, setVideoQueueHistory] = createSignal<VideoQueueHistoryEntry[]>([]);
export { videoQueueHistory };

function generateId(): string {
  return crypto.randomUUID();
}

// unwrap proxy objects before storing videos in IndexedDB or passing through
// IPC — mirrors queueHistory.ts's unwrapSongs(). `images` is the one
// nested array field QueuedVideo carries (added alongside Video.images),
// so it needs its own deep copy the same way a shallow spread doesn't
// unwrap a solid-store-proxied array — see app/services/storage/db.ts's
// `setQueue` for the sibling fix and the DataCloneError it was causing.
export function unwrapVideos(videos: QueuedVideo[]): QueuedVideo[] {
  return videos.map((v) => ({ ...v, images: v.images?.map((img) => ({ ...img })) }));
}

// load history from idb into reactive signal
export async function loadVideoQueueHistory(): Promise<void> {
  try {
    const db = await initAppDB();
    const all = await db.getAll(STORE_VIDEO_QUEUE_HISTORY);
    all.sort((a, b) => b.queued_at - a.queued_at);
    setVideoQueueHistory(all);
  } catch (error) {
    errorLog("video/queueHistory", "load failed:", error);
  }
}

// add a history entry — returns the entry id
// when resumeProgress is provided, the entry is created with existing progress
export async function addVideoHistoryEntry(
  videos: QueuedVideo[],
  source: VideoQueueSourceContext,
  resumeProgress?: {
    watched_seconds: number;
    videos_completed: number;
    current_video_index: number;
    current_video_position: number;
  }
): Promise<string | null> {
  if (videos.length === 0) return null;

  try {
    const db = await initAppDB();

    const entry: VideoQueueHistoryEntry = {
      id: generateId(),
      type: source.type,
      label: source.label,
      entity_id: source.entity_id,
      remote_name: getCurrentRemote()?.name || undefined,
      video_count: videos.length,
      videos: unwrapVideos(videos),
      queued_at: Date.now(),
      image: source.image ? { ...source.image } : undefined,
      watched_seconds: resumeProgress?.watched_seconds ?? 0,
      total_seconds: videos.reduce((sum, v) => sum + (v.duration_seconds || 0), 0),
      videos_completed: resumeProgress?.videos_completed ?? 0,
      current_video_index: resumeProgress?.current_video_index ?? 0,
      current_video_position: resumeProgress?.current_video_position ?? 0,
    };

    await db.put(STORE_VIDEO_QUEUE_HISTORY, entry);

    // enforce max entries cap
    const allEntries = await db.getAll(STORE_VIDEO_QUEUE_HISTORY);
    if (allEntries.length > MAX_HISTORY_ENTRIES) {
      allEntries.sort((a, b) => a.queued_at - b.queued_at);
      const toDelete = allEntries.slice(0, allEntries.length - MAX_HISTORY_ENTRIES);
      const tx = db.transaction(STORE_VIDEO_QUEUE_HISTORY, "readwrite");
      for (const old of toDelete) {
        await tx.store.delete(old.id);
      }
      await tx.done;
    }

    await loadVideoQueueHistory();

    return entry.id;
  } catch (error) {
    errorLog("video/queueHistory", "add entry failed:", error);
    return null;
  }
}

// remove a single history entry
export async function removeVideoHistoryEntry(id: string): Promise<void> {
  try {
    const db = await initAppDB();
    await db.delete(STORE_VIDEO_QUEUE_HISTORY, id);
    await loadVideoQueueHistory();
  } catch (error) {
    errorLog("video/queueHistory", "remove entry failed:", error);
  }
}

// update watch progress on a history entry (called periodically during playback)
export async function updateVideoHistoryProgress(
  id: string,
  updates: {
    watched_seconds?: number;
    videos_completed?: number;
    current_video_index?: number;
    current_video_position?: number;
  }
): Promise<void> {
  try {
    const db = await initAppDB();
    const entry = await db.get(STORE_VIDEO_QUEUE_HISTORY, id);
    if (!entry) return;

    const updated = { ...entry, ...updates };
    await db.put(STORE_VIDEO_QUEUE_HISTORY, updated);

    // update signal in-place (avoid full reload for frequent updates)
    setVideoQueueHistory((prev) => prev.map((e) => (e.id === id ? { ...e, ...updates } : e)));
  } catch (error) {
    errorLog("video/queueHistory", "update progress failed:", error);
  }
}

// clear all video history
export async function clearVideoQueueHistory(): Promise<void> {
  try {
    const db = await initAppDB();
    await db.clear(STORE_VIDEO_QUEUE_HISTORY);
    setVideoQueueHistory([]);
  } catch (error) {
    errorLog("video/queueHistory", "clear failed:", error);
  }
}
