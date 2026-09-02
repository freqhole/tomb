// play a list of videos as the active queue, starting at startIndex.
// mirrors music/services/queue/queue.ts's playQueue — when a `source` is
// given, records a video history entry, starts local watch-progress
// tracking, and (phase 5c) creates a server-side playback session mirroring
// the song side. the rolling-window pre-cache scheduler
// (preCacheScheduler.ts) takes over once playback crosses the 50% mark;
// the immediate `preCacheNextVideos` call below just mirrors queue.ts's
// equivalent immediate trigger for songs so the *next* video is already
// warming before that threshold is reached.
import { setQueue } from "../../../app/services/storage/db";
import { playMediaItem } from "../../../music/services/audio/player";
import {
  videoToMediaItem,
  videosOnly,
  type QueuedVideo,
} from "../../../app/services/storage/mediaItem";
import type {
  VideoQueueHistoryEntry,
  VideoQueueSourceContext,
} from "../../../app/services/storage/types";
import { addVideoHistoryEntry, updateVideoHistoryServerSession } from "./videoQueueHistory";
import { resumeVideoTracking, startVideoTracking } from "./videoListenProgress";
import { startVideoRemoteSync } from "./videoServerProgressSync";
import { mirrorReplaceVideosToQueue } from "../../../app/services/players/remoteQueueMirror";
import { preCacheNextVideos } from "../videoPreCache";
import type { VideoSummary } from "../../data/types";
import {
  createServerSessions,
  resumeServerSession,
} from "../../../music/services/queue/serverSession";
import { getRemoteById } from "../../../app/services/remotes/remoteManager";

export async function playVideoQueue(
  videos: (VideoSummary | QueuedVideo)[],
  startIndex = 0,
  source?: VideoQueueSourceContext
): Promise<void> {
  if (videos.length === 0) return;
  const items = videos.map((v) => videoToMediaItem({ ...v, queue_entry_id: undefined }));
  await setQueue(items);
  // playVideoQueue always fully replaces the local queue (no insert-after-
  // current merge logic like queue.ts's playQueue) - mirror that as a
  // replace on the remote target too, same as queue.ts's mirrorReplaceQueue.
  mirrorReplaceVideosToQueue(videosOnly(items));
  await playMediaItem(items[startIndex], { userInitiated: true });
  void preCacheNextVideos(videosOnly(items), 30, startIndex + 1);

  if (source) {
    const entryId = await addVideoHistoryEntry(videosOnly(items), source);
    if (entryId) {
      startVideoTracking(entryId);
      startVideoRemoteSync();
      // create a server-side playback session for this (video-only) queue
      // and link it to the video-side history entry — createServerSessions
      // itself only links to the song-side history store, so the linking
      // is done here instead (see queueHistory.ts's updateHistoryServerSession
      // vs videoQueueHistory.ts's updateVideoHistoryServerSession).
      void createServerSessions(items, source).then((created) => {
        const first = created.entries().next().value;
        if (first) {
          const [remoteId, sessionId] = first;
          void updateVideoHistoryServerSession(entryId, sessionId, remoteId);
        }
      });
    }
  }
}

// resume a previously-queued set of videos from history — mirrors
// music/services/queue/queue.ts's resumeHistoryEntry, used by a later
// "replay" UI action.
export async function resumeVideoHistoryEntry(entry: VideoQueueHistoryEntry): Promise<void> {
  if (entry.videos.length === 0) return;

  const resumeIndex = Math.min(entry.current_video_index || 0, entry.videos.length - 1);
  const items = entry.videos.map(videoToMediaItem);

  await setQueue(items);
  // video's playMediaItem supports seeking to an initial position directly
  // (unlike the song player, which needs a post-load setTimeout+seek).
  await playMediaItem(items[resumeIndex], {
    userInitiated: true,
    initialPosition: entry.current_video_position || 0,
  });
  void preCacheNextVideos(videosOnly(items), 30, resumeIndex + 1);

  resumeVideoTracking(entry.id, {
    watched_seconds: entry.watched_seconds || 0,
    videos_completed: entry.videos_completed || 0,
    current_video_index: resumeIndex,
    current_video_position: entry.current_video_position || 0,
  });
  startVideoRemoteSync();

  if (entry.server_session_id && entry.server_remote_id) {
    const remote = await getRemoteById(entry.server_remote_id);
    if (remote) {
      await resumeServerSession(
        entry.server_session_id,
        { progress: entry.videos_completed || 0 },
        remote,
        { label: entry.label, sessionType: entry.type, entityId: entry.entity_id },
        undefined,
        items
      );
    }
  }
}
