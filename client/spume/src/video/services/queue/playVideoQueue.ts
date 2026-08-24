// play a list of videos as the active queue, starting at startIndex.
// mirrors music/services/queue/queue.ts's playQueue — when a `source` is
// given, records a video history entry and starts local watch-progress
// tracking. still no p2p pre-cache (video pre-cache scheduling is a later
// phase per docs/video-domain-plan.md) and no remote/server progress sync
// (a separate, much-less-frequent mechanism — see videoListenProgress.ts).
import { setQueue } from "../../../app/services/storage/db";
import { playMediaItem } from "../../../music/services/audio/player";
import { videoToMediaItem, videosOnly } from "../../../app/services/storage/mediaItem";
import type {
  VideoQueueHistoryEntry,
  VideoQueueSourceContext,
} from "../../../app/services/storage/types";
import { addVideoHistoryEntry } from "./videoQueueHistory";
import { resumeVideoTracking, startVideoTracking } from "./videoListenProgress";
import { startVideoRemoteSync } from "./videoServerProgressSync";
import type { VideoSummary } from "../../data/types";

export async function playVideoQueue(
  videos: VideoSummary[],
  startIndex = 0,
  source?: VideoQueueSourceContext
): Promise<void> {
  if (videos.length === 0) return;
  const items = videos.map((v) => videoToMediaItem({ ...v, queue_entry_id: undefined }));
  await setQueue(items);
  await playMediaItem(items[startIndex], { userInitiated: true });

  if (source) {
    const entryId = await addVideoHistoryEntry(videosOnly(items), source);
    if (entryId) {
      startVideoTracking(entryId);
      startVideoRemoteSync();
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

  resumeVideoTracking(entry.id, {
    watched_seconds: entry.watched_seconds || 0,
    videos_completed: entry.videos_completed || 0,
    current_video_index: resumeIndex,
    current_video_position: entry.current_video_position || 0,
  });
  startVideoRemoteSync();
}
