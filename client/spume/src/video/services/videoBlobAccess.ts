// video blob access — resolves a playable URL for a QueuedVideo.
//
// two sources: a locally-imported video (browser OPFS, no server
// involved) or a server-backed video (grimoire's video domain), resolved
// via the existing `resolveBlobUrl` remote transport path (same
// P2P/Tauri/HTTP resolution songs already use for remote playback). see
// docs/video-domain-plan.md phase 9 for scope notes.

import type { BlobProgressCallback } from "@freqhole/api-client";
import { resolveBlobUrl, usesBlobResolver } from "../../music/services/storage/blobResolver";
import {
  getCachedBlob,
  preCacheBlob,
  isRemoteBlobCachedReactive,
} from "../../music/services/cache/blobCache";
import { getClientForRemote } from "../../app/api/client";
import { getRemoteById } from "../../app/services/remotes/remoteManager";
import type { QueuedVideo } from "../../app/services/storage/mediaItem";
import { readVideoFromOPFS } from "./opfs/helpers";
import { resolveLocalVideoUrl } from "./localVideo";
import { canSyncVideo, syncVideoToLocal } from "./sync/syncVideoToLocal";
import { getSyncQueueToLocal } from "../../app/services/storage/db";
import { useVideoWindow } from "../../music/services/audio/selectVideo";
import { isVideoSyncedLocally } from "./syncState";
import { resolvePlaybackBlobId } from "./playbackBlobId";
import { warn } from "../../utils/logger";

export async function getVideoURL(
  video: QueuedVideo,
  onProgress?: BlobProgressCallback
): Promise<string> {
  if (video.source_type === "local") {
    if (!video.opfs_path) {
      throw new Error(`local video has no opfs_path (id=${video.id})`);
    }
    const file = await readVideoFromOPFS(video.opfs_path);
    return URL.createObjectURL(file);
  }

  // a remote video may have since been synced to local storage (see
  // syncVideoToLocal.ts) without the in-memory queue item's source_type
  // being updated. `isVideoSyncedLocally` is a plain reactive set lookup
  // (no IDB round trip) kept up to date by markVideoSynced/initVideoSyncState,
  // so the common "never synced" case skips straight to the remote path
  // below instead of paying for an IDB read on every single play.
  if (isVideoSyncedLocally(video.id)) {
    const localUrl = await resolveLocalVideoUrl(video.id, undefined, !useVideoWindow());
    if (localUrl) return localUrl;
  }

  // sync-to-local on: the bytes belong in the library, not the api cache.
  // download once, write to the library, then play from there. falls through
  // to streaming if the sync fails so playback never hard-fails on it.
  if (getSyncQueueToLocal() && canSyncVideo(video)) {
    const result = await syncVideoToLocal(video);
    if (result.success) {
      const localUrl = await resolveLocalVideoUrl(video.id, result.localPath, !useVideoWindow());
      if (localUrl) return localUrl;
    }
    warn(
      "videoBlobAccess",
      `sync-to-local failed for video ${video.id} (${result.error ?? "no local copy"}), streaming instead`
    );
  }

  if (!video.media_blob_id) {
    throw new Error(`video has no media_blob_id (id=${video.id})`);
  }
  if (!video.remote_server_id) {
    throw new Error(`remote video has no remote_server_id (id=${video.id})`);
  }
  const remoteId = video.remote_server_id;
  const blobId = await resolvePlaybackBlobId(video, remoteId);

  // P2P/tauri-managed remotes: resolveBlobUrl already checks the Cache
  // API before fetching from the peer. unlike Song, Video carries no
  // blake3/size/mime of its own, but the transport's verified-streaming
  // progress path (WasmTransport.fetchBlobWithProgress) needs a blake3 to
  // even attempt real progress, and needs totalBytes to report anything
  // other than a stuck indeterminate value — so look both up via the
  // same blob_metadata route syncSongToLocal.ts already uses, whenever a
  // caller actually wants progress.
  if (await usesBlobResolver(remoteId)) {
    let blake3: string | undefined;
    let totalBytes: number | undefined;
    let mimeType: string | undefined;
    if (onProgress) {
      try {
        const remote = await getRemoteById(remoteId);
        if (remote) {
          const client = await getClientForRemote(remote);
          const metadataResult = await client.music.blobMetadata({ id: blobId });
          if (metadataResult.success && metadataResult.data) {
            blake3 = metadataResult.data.blake3 ?? undefined;
            totalBytes = metadataResult.data.size ?? undefined;
            mimeType = metadataResult.data.mime ?? undefined;
          }
        }
      } catch (err) {
        warn(
          "videoBlobAccess",
          `failed to fetch blob metadata for ${blobId}, progress will stay indeterminate:`,
          err
        );
      }
    }
    return resolveBlobUrl(
      blobId,
      remoteId,
      "video",
      onProgress,
      undefined,
      blake3,
      totalBytes,
      mimeType
    );
  }

  // plain HTTP remote: resolveBlobUrl returns a raw direct URL for this
  // transport with no cache check, so check our own blob cache first -
  // otherwise an already pre-cached video (see videoPreCache.ts's
  // rolling window) would still be re-fetched over the network on play.
  // gate the actual Cache API read behind the reactive flag (sync, no
  // round trip) so a definite cache-miss skips straight past it.
  if (isRemoteBlobCachedReactive(remoteId, blobId)) {
    const cachedResponse = await getCachedBlob(remoteId, blobId);
    if (cachedResponse) {
      const blob = await cachedResponse.blob();
      return URL.createObjectURL(blob);
    }
  }

  const remote = await getRemoteById(remoteId);
  if (!remote?.base_url) {
    throw new Error(`remote ${remoteId} has no base_url`);
  }
  const directUrl = `${remote.base_url}/api/blobs/${blobId}`;
  // stream directly now, and cache in the background for next time
  // (mirrors audioAccess.ts's HTTP-remote song path)
  void preCacheBlob(directUrl, "video", remoteId, blobId, 3, video.id);
  return directUrl;
}
