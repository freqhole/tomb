// shared SendVideoPayload builders - mirrors VideoDetailView.tsx's/
// VideoSeriesDetailPanel.tsx's own inline versions, factored out so
// video/hooks/contextMenu.ts's "share..." action can build the same
// payload shape without duplicating the mapping logic a third time.
import type { QueuedVideo } from "../../../app/services/storage/mediaItem";
import type { VideoSummary } from "../../data/types";
import type { SendVideoItem, SendVideoPayload } from "./sendVideoToRemote";

function toSendVideoItem(video: VideoSummary | QueuedVideo): SendVideoItem {
  return {
    video: video as QueuedVideo,
    blobId: video.media_blob_id,
    blake3: video.blake3 ?? null,
  };
}

/** payload for a single video. */
export function buildVideoSendPayload(video: VideoSummary | QueuedVideo): SendVideoPayload {
  return { kind: "video", videos: [toSendVideoItem(video)] };
}

/** payload for a whole series (every episode across every season, plus any
 *  season-less videos) - caller resolves the full video list. */
export function buildVideosSendPayload(
  videos: Array<VideoSummary | QueuedVideo>
): SendVideoPayload {
  return { kind: "video", videos: videos.map(toSendVideoItem) };
}
