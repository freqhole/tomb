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
import { resolveCharnelLocalBlobPath } from "../../app/services/media/resolveCharnelLocalBlobPath";
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

  // authoritative "is this already on disk in charnel's own library?"
  // check by blake3 - mirrors audioAccess.ts's identical check exactly,
  // and must run BEFORE the `isVideoSyncedLocally` client-side cache
  // below (which only tracks videos synced through THIS device's own
  // sync calls, not content that already happens to be in the library
  // for any other reason). critically, this also handles a queue item
  // whose declared `source_peer_addr` happens to be this very device
  // (e.g. content originally browsed FROM this player and queued
  // straight back to it) without ever dialing out - iroh refuses a
  // self-connect outright, so skipping straight to a local lookup here
  // is required, not just an optimization.
  const charnelLocalPath = await resolveCharnelLocalBlobPath(video.blake3);
  if (charnelLocalPath) {
    const localUrl = await resolveLocalVideoUrl(video.id, charnelLocalPath, !useVideoWindow());
    if (localUrl) return localUrl;
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
  const originalBlobId = video.media_blob_id;
  const blobId = await resolvePlaybackBlobId(video, remoteId);

  // resolves a specific blob id to a playable url - factored out so a
  // rendition attempt can fall back to the original (see below) without
  // duplicating the P2P/HTTP branching.
  const fetchForBlobId = async (id: string): Promise<string> => {
    // P2P/tauri-managed remotes: resolveBlobUrl already checks the Cache
    // API before fetching from the peer. a video usually carries no
    // blake3/size/mime of its own (only set once synced locally, or by a
    // caller that already knows it up front - e.g. cenotaph's queue-pushed
    // videos, which carry it straight off the wire `MediaRef` and have no
    // real remote `media_blob_id` to look anything up by at all) - prefer
    // that known blake3 for verified streaming when present, same as
    // `getAudioURL`'s blake3-first resolution. otherwise fall back to the
    // metadata round-trip (needs a real `media_blob_id` the remote
    // recognizes), which also gets totalBytes/mimeType for progress.
    //
    // `video.blake3` is always the ORIGINAL blob's hash, though - if `id`
    // is a transcoded rendition instead (a different blob, almost always
    // a different size/content), the shortcut must not apply: iroh-blobs
    // fetches by blake3, not blobId, so pairing the rendition's blobId
    // with the original's blake3 pulls the wrong (often web-incompatible,
    // e.g. raw DVD mpeg-2) file while labeling it as the rendition - plays
    // with audio but a black video frame, or size-mismatches entirely
    // elsewhere (see syncVideoToLocal.ts's identical fix). always resolve
    // the rendition's own blake3 fresh.
    if (await usesBlobResolver(remoteId)) {
      const isOriginalBlob = id === originalBlobId;
      let blake3: string | undefined = isOriginalBlob ? (video.blake3 ?? undefined) : undefined;
      let totalBytes: number | undefined;
      let mimeType: string | undefined;
      if (!blake3) {
        try {
          const remote = await getRemoteById(remoteId);
          if (remote) {
            const client = await getClientForRemote(remote);
            const metadataResult = await client.music.blobMetadata({ id });
            if (metadataResult.success && metadataResult.data) {
              blake3 = metadataResult.data.blake3 ?? undefined;
              totalBytes = metadataResult.data.size ?? undefined;
              mimeType = metadataResult.data.mime ?? undefined;
            }
          }
        } catch (err) {
          warn(
            "videoBlobAccess",
            `failed to fetch blob metadata for ${id}, progress will stay indeterminate:`,
            err
          );
        }
      }
      return resolveBlobUrl(
        id,
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
    if (isRemoteBlobCachedReactive(remoteId, id)) {
      const cachedResponse = await getCachedBlob(remoteId, id);
      if (cachedResponse) {
        const blob = await cachedResponse.blob();
        return URL.createObjectURL(blob);
      }
    }

    const remote = await getRemoteById(remoteId);
    if (!remote?.base_url) {
      throw new Error(`remote ${remoteId} has no base_url`);
    }
    const directUrl = `${remote.base_url}/api/blobs/${id}`;
    // stream directly now, and cache in the background for next time
    // (mirrors audioAccess.ts's HTTP-remote song path)
    void preCacheBlob(directUrl, "video", remoteId, id, 3, video.id);
    return directUrl;
  };

  if (blobId === originalBlobId) {
    return fetchForBlobId(blobId);
  }

  // resolved to a rendition - fall back to the original if it's
  // unavailable (never generated on the source, or its local_path file
  // went missing on disk there) rather than failing playback outright.
  try {
    return await fetchForBlobId(blobId);
  } catch (err) {
    warn(
      "videoBlobAccess",
      `rendition ${blobId} unavailable for video ${video.id}, falling back to original ${originalBlobId}:`,
      err
    );
    return fetchForBlobId(originalBlobId);
  }
}
