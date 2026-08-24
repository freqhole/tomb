// play a list of videos as the active queue, starting at startIndex.
// mirrors music/services/queue/queue.ts's playQueue at a much smaller
// scope — no source-context bookkeeping, history, or p2p pre-cache yet
// (video pre-cache scheduling is a later phase per docs/video-domain-plan.md).
import { setQueue } from "../../../app/services/storage/db";
import { playMediaItem } from "../../../music/services/audio/player";
import { videoToMediaItem } from "../../../app/services/storage/mediaItem";
import type { VideoSummary } from "../../data/types";

export async function playVideoQueue(videos: VideoSummary[], startIndex = 0): Promise<void> {
  if (videos.length === 0) return;
  const items = videos.map((v) => videoToMediaItem({ ...v, queue_entry_id: undefined }));
  await setQueue(items);
  await playMediaItem(items[startIndex], { userInitiated: true });
}
