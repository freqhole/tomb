// small single-item queue-append helpers for the video context menu —
// mirrors the "add to queue"/"play next" shape of
// music/services/queue/queue.ts's addToQueue, simplified (no queue-size-
// limit modal, single item only) since this is an MVP action, not the
// full bulk-add flow. lives outside video/services/queue/ (owned by a
// concurrent workstream) since it only needs setQueue/appState.
import { appState, setQueue } from "../../app/services/storage/db";
import { mediaItemKey, videoToMediaItem } from "../../app/services/storage/mediaItem";
import type { VideoSummary } from "../data/types";

export async function addVideoToQueue(video: VideoSummary): Promise<void> {
  const queue = appState()?.queue ?? [];
  const item = videoToMediaItem({ ...video, queue_entry_id: undefined });
  await setQueue([...queue, item]);
}

export async function playVideoNext(video: VideoSummary): Promise<void> {
  const state = appState();
  const queue = state?.queue ?? [];
  const item = videoToMediaItem({ ...video, queue_entry_id: undefined });
  const currentId = state?.current_sha256;
  const currentIndex = currentId ? queue.findIndex((i) => mediaItemKey(i) === currentId) : -1;
  const insertAt = currentIndex >= 0 ? currentIndex + 1 : queue.length;
  await setQueue([...queue.slice(0, insertAt), item, ...queue.slice(insertAt)]);
}
