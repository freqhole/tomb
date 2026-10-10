// small single-item queue-append helpers for the video context menu —
// mirrors the "add to queue"/"play next" shape of
// music/services/queue/queue.ts's addToQueue, simplified (no queue-size-
// limit modal, single item only) since this is an MVP action, not the
// full bulk-add flow. lives outside video/services/queue/ (owned by a
// concurrent workstream) since it only needs setQueue/appState.
import { appState, setQueue } from "../../app/services/storage/db";
import {
  mediaItemKey,
  videoToMediaItem,
  videosOnly,
  type MediaItem,
  type QueuedVideo,
} from "../../app/services/storage/mediaItem";
import type { VideoQueueSourceContext } from "../../app/services/storage/types";
import type { VideoSummary } from "../data/types";
import { isRemoteTargetActive } from "../../app/services/players/activeTarget";
import { mirrorAppendVideosToQueue } from "../../app/services/players/remoteQueueMirror";
import {
  addVideoHistoryEntry,
  updateVideoHistoryEntryVideos,
  updateVideoHistoryServerSession,
} from "./queue/videoQueueHistory";
import { activeVideoHistoryEntryId, startVideoTracking } from "./queue/videoListenProgress";
import { startVideoRemoteSync } from "./queue/videoServerProgressSync";
import {
  activeServerSessionId,
  createServerSessions,
  updateServerSessionItems,
} from "../../music/services/queue/serverSession";

// keeps video history/local-tracking/server-session in sync when a video is
// appended to an already-active queue (add to queue/play next) instead of
// replacing it via playVideoQueue - mirrors queue.ts's addToQueueInternal's
// tail. without this, a video reached this way never gets a history entry,
// so its watch position can never resume on reload (see
// videoListenProgress.ts's reconnectVideoProgressTracking, which can only
// restore a position for a video it has a history entry for). a no-op
// when `source` is omitted, same as the song side.
//
// deliberately calls updateVideoHistoryServerSession itself rather than
// passing a historyEntryId into createServerSessions - that function's own
// auto-link only knows about the song-side history store (see
// serverSession.ts), so passing a video entry id through it would link the
// session to the wrong store.
async function syncVideoHistoryOnAppend(
  newQueue: MediaItem[],
  source?: VideoQueueSourceContext
): Promise<void> {
  if (!source) return;
  const newQueueVideos = videosOnly(newQueue);
  const existingEntryId = activeVideoHistoryEntryId();

  if (existingEntryId) {
    void updateVideoHistoryEntryVideos(existingEntryId, newQueueVideos);
    if (activeServerSessionId()) {
      void updateServerSessionItems(newQueue);
    } else {
      void createServerSessions(newQueue, source).then((created) => {
        const first = created.entries().next().value;
        if (first) void updateVideoHistoryServerSession(existingEntryId, first[0], first[1]);
      });
    }
    return;
  }

  const entryId = await addVideoHistoryEntry(newQueueVideos, source);
  if (entryId) {
    startVideoTracking(entryId);
    startVideoRemoteSync();
    void createServerSessions(newQueue, source).then((created) => {
      const first = created.entries().next().value;
      if (first) void updateVideoHistoryServerSession(entryId, first[0], first[1]);
    });
  }
}

export async function addVideoToQueue(
  video: VideoSummary | QueuedVideo,
  source?: VideoQueueSourceContext
): Promise<void> {
  const queue = appState()?.queue ?? [];
  const item = videoToMediaItem({ ...video, queue_entry_id: undefined });
  if (isRemoteTargetActive()) mirrorAppendVideosToQueue(videosOnly([item]));
  const newQueue = [...queue, item];
  await setQueue(newQueue);
  void syncVideoHistoryOnAppend(newQueue, source);
}

// Fisher-Yates shuffle — used by series/season "shuffle all" actions
// (mirrors music/views/ArtistsView.tsx's local shuffleArray, shared here
// since two video call sites need it: the series context menu and the
// series detail panel's season row buttons).
export function shuffleVideos(videos: VideoSummary[]): VideoSummary[] {
  const result = [...videos];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// bulk version — appends a whole list (e.g. an entire series/season) to
// the end of the current queue without interrupting playback.
export async function addVideosToQueue(
  videos: VideoSummary[],
  source?: VideoQueueSourceContext
): Promise<void> {
  if (videos.length === 0) return;
  const queue = appState()?.queue ?? [];
  const items = videos.map((v) => videoToMediaItem({ ...v, queue_entry_id: undefined }));
  if (isRemoteTargetActive()) mirrorAppendVideosToQueue(videosOnly(items));
  const newQueue = [...queue, ...items];
  await setQueue(newQueue);
  void syncVideoHistoryOnAppend(newQueue, source);
}

export async function playVideoNext(
  video: VideoSummary | QueuedVideo,
  source?: VideoQueueSourceContext
): Promise<void> {
  const state = appState();
  const queue = state?.queue ?? [];
  const item = videoToMediaItem({ ...video, queue_entry_id: undefined });
  const currentId = state?.current_item_key;
  const currentIndex = currentId ? queue.findIndex((i) => mediaItemKey(i) === currentId) : -1;
  const insertAt = currentIndex >= 0 ? currentIndex + 1 : queue.length;
  const newQueue = [...queue.slice(0, insertAt), item, ...queue.slice(insertAt)];
  await setQueue(newQueue);
  void syncVideoHistoryOnAppend(newQueue, source);
}
