// pre-cache upcoming videos from the queue — the video-side counterpart
// to music's rolling pre-cache pipeline
// (`music/services/{cache/blobCache,storage/blobResolver}.ts`). videos
// used to be entirely excluded from pre-caching (see the phase 9 MVP
// scope note this replaces in `app/services/storage/mediaItem.ts`); this
// closes that gap so any remote video sitting in the rolling ~30 minute
// window ahead of playback gets downloaded the same way remote songs
// already do, whether the remote is plain HTTP or P2P/charnel-managed.
//
// deliberately simpler than the song pipeline: no sha256/blake3-verified
// streaming (`Video` has no content hash yet), no sync-to-local dispatch
// here (`VideoBackend` already fires `syncVideoToLocal` itself on play,
// see `sync/syncVideoToLocal.ts`) — this only warms the Cache API /
// charnel-local blob ahead of time, same as `preCacheP2PBlob` already
// does generically for `type: "video"`.

import { isP2PRemote } from "../../music/services/storage/transportCache";
import { preCacheP2PBlob } from "../../music/services/storage/blobResolver";
import { preCacheBlob, isCached } from "../../music/services/cache/blobCache";
import { getRemoteById } from "../../app/services/remotes/remoteManager";
import { resolvePlaybackBlobId } from "./videoBlobAccess";
import type { QueuedVideo } from "../../app/services/storage/mediaItem";
import { debug, warn } from "../../utils/logger";

/**
 * pre-cache the next videos in the queue (rolling window, mirrors the
 * song pre-cache functions' shape).
 *
 * @param videos the video-only subset of the queue, in queue order.
 * @param targetMinutes how far ahead (by accumulated duration) to cache.
 * @param startIndex where "upcoming" begins in `videos` — pass
 *   `videoStartIndexAfter(queue, currentKey)` from
 *   `app/services/storage/mediaItem.ts` so this keeps advancing
 *   correctly through a mixed song+video queue regardless of which kind
 *   is currently playing.
 */
export async function preCacheNextVideos(
  videos: QueuedVideo[],
  targetMinutes: number = 30,
  startIndex: number = 0
): Promise<void> {
  if (videos.length === 0 || startIndex >= videos.length) {
    return;
  }

  const targetSeconds = targetMinutes * 60;
  let totalSeconds = 0;
  const toProcess: QueuedVideo[] = [];
  for (let i = startIndex; i < videos.length; i++) {
    const video = videos[i];
    toProcess.push(video);
    totalSeconds += video.duration_seconds ?? 0;
    if (totalSeconds >= targetSeconds) break;
  }

  if (toProcess.length === 0) return;

  debug("videoPreCache", `pre-caching next ${toProcess.length} videos (~${targetMinutes} min)`);
  await Promise.allSettled(toProcess.map((v) => preCacheOneVideo(v)));
}

async function preCacheOneVideo(video: QueuedVideo): Promise<void> {
  // local/imported videos are already on disk (OPFS) - nothing to fetch.
  if (video.source_type !== "remote") return;
  if (!video.media_blob_id || !video.remote_server_id) return;

  const remoteId = video.remote_server_id;
  try {
    // resolve the same blob (original or transcoded rendition) that will
    // actually be played, so what's pre-cached is what's played.
    const blobId = await resolvePlaybackBlobId(video, remoteId);

    if (await isP2PRemote(remoteId)) {
      void preCacheP2PBlob(blobId, remoteId, video.id, "video");
      if (video.poster_blob_id) {
        void preCacheP2PBlob(video.poster_blob_id, remoteId, undefined, "image");
      }
      return;
    }

    // plain HTTP remote - fetch + cache directly (P2P case above already
    // routes through preCacheP2PBlob's own resolveBlobUrl-based fetch).
    const remote = await getRemoteById(remoteId);
    if (!remote?.base_url) return;

    if (!(await isCached(remoteId, blobId))) {
      void preCacheBlob(
        `${remote.base_url}/api/blobs/${blobId}`,
        "video",
        remoteId,
        blobId,
        3,
        video.id
      );
    }
    if (video.poster_blob_id && !(await isCached(remoteId, video.poster_blob_id))) {
      void preCacheBlob(
        `${remote.base_url}/api/blobs/${video.poster_blob_id}`,
        "image",
        remoteId,
        video.poster_blob_id
      );
    }
  } catch (err) {
    warn("videoPreCache", `pre-cache failed for video ${video.id}:`, err);
  }
}
