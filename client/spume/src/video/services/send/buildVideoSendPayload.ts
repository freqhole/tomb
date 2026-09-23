// shared SendVideoPayload builders - mirrors VideoDetailView.tsx's/
// VideoSeriesDetailPanel.tsx's own inline versions, factored out so
// video/hooks/contextMenu.ts's "share..." action can build the same
// payload shape without duplicating the mapping logic a third time.
import type { QueuedVideo } from "../../../app/services/storage/mediaItem";
import type { VideoSummary } from "../../data/types";
import type { SendVideoItem, SendVideoPayload } from "./sendVideoToRemote";
import { getClientForRemote } from "../../../app/api/client";
import { getRemoteById } from "../../../app/services/remotes/remoteManager";
import { warn } from "../../../utils/logger";

// as of migration 084, grimoire's wire `Video` schema carries `blake3`
// directly (denormalized from `media_blobz`, mirrors `Song.blake3`) - but
// a blob's own `media_blobz.blake3` can still be null/lazily computed (see
// `media_blobz/service.rs`'s `backfill_blake3_if_missing`), which is what
// originally made every video/series send fail with "no blake3
// available". keep this as defense-in-depth: resolve it here the same way
// videoBlobAccess.ts's getVideoURL already does, via a blob-metadata
// round-trip against the video's own remote.
async function resolveMissingBlake3(video: VideoSummary | QueuedVideo): Promise<string | null> {
  if (video.blake3) return video.blake3;
  if (!video.remote_server_id || !video.media_blob_id) return null;
  try {
    const remote = await getRemoteById(video.remote_server_id);
    if (!remote) return null;
    const client = await getClientForRemote(remote);
    const result = await client.music.blobMetadata({ id: video.media_blob_id });
    return result.success ? (result.data?.blake3 ?? null) : null;
  } catch (err) {
    warn(
      "buildVideoSendPayload",
      `failed to resolve blake3 for video ${video.id} (blob ${video.media_blob_id}): ${err}`
    );
    return null;
  }
}

async function toSendVideoItem(video: VideoSummary | QueuedVideo): Promise<SendVideoItem> {
  return {
    video: video as QueuedVideo,
    blobId: video.media_blob_id,
    blake3: await resolveMissingBlake3(video),
  };
}

/** payload for a single video. */
export async function buildVideoSendPayload(
  video: VideoSummary | QueuedVideo
): Promise<SendVideoPayload> {
  return { kind: "video", videos: [await toSendVideoItem(video)] };
}

/** payload for a whole series (every episode across every season, plus any
 *  season-less videos) - caller resolves the full video list. */
export async function buildVideosSendPayload(
  videos: Array<VideoSummary | QueuedVideo>
): Promise<SendVideoPayload> {
  return { kind: "video", videos: await Promise.all(videos.map(toSendVideoItem)) };
}
