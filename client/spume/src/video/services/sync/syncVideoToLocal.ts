// sync-to-local for remote video playback — mirrors the essential shape of
// music/services/sync/syncSongToLocal.ts, deliberately scoped down: dedup
// by the video's own id (not a content hash — `Video` has no sha256 field
// yet), no pause/resume, no P2P-specific optimization beyond what
// `resolveBlobUrl`/`preCacheP2PBlob` already give us for free (a P2P/
// charnel blob already fetched for playback is served from its Cache API
// entry, not re-downloaded). download progress reuses the same generic
// loading-set/progress tracking (keyed by video.id) that the on-demand
// playback path (videoBlobAccess.ts) already wires up, via preCacheP2PBlob/
// preCacheBlob rather than a raw untracked fetch.
//
// fired (fire-and-forget) from VideoBackend.loadAndPlay whenever a remote
// video is played and the "sync queue to local" setting is on.

import {
  resolveBlobUrl,
  usesBlobResolver,
  preCacheP2PBlob,
} from "../../../music/services/storage/blobResolver";
import { preCacheBlob, getCachedBlob } from "../../../music/services/cache/blobCache";
import { getSyncQueueToLocal } from "../../../app/services/storage/db";
import { isCharnelMode } from "../../../app/services/charnel";
import { getRemoteById } from "../../../app/services/remotes/remoteManager";
import { getClientForRemote } from "../../../app/api/client";
import type { Remote } from "../../../app/services/storage/schemas/remote";
import { addLocalVideo, getLocalVideoById } from "../storage/db/videos";
import { markVideoSynced } from "../syncState";
import { writeVideoPosterToOPFS, writeVideoToOPFS } from "../opfs/helpers";
import { resolvePlaybackBlobId } from "../videoBlobAccess";
import type { QueuedVideo } from "../../../app/services/storage/mediaItem";
import { debug, warn } from "../../../utils/logger";

/** fetch the full video blob, tracking download progress under `video.id`
 *  via the same generic loading-set/progress machinery the on-demand
 *  playback path uses (see videoBlobAccess.ts's HTTP branch and
 *  blobResolver.ts's P2P branch) — never a plain untracked fetch. */
async function fetchVideoBlobWithProgress(
  video: QueuedVideo,
  remoteId: string,
  blobId: string,
  remoteOverride?: Remote
): Promise<Blob> {
  if (await usesBlobResolver(remoteId)) {
    // P2P/charnel: preCacheP2PBlob tracks addToLoadingSet/updateLoadingProgress
    // itself (type "video", trackingId=video.id) while warming the cache.
    await preCacheP2PBlob(blobId, remoteId, video.id, "video");
    const cached = await getCachedBlob(remoteId, blobId);
    if (cached) return cached.blob();
    // fallback: preCacheP2PBlob failed silently (e.g. remote unreachable) —
    // resolve directly, without progress, rather than give up entirely.
    const url = await resolveBlobUrl(blobId, remoteId, "video");
    const response = await fetch(url);
    if (!response.ok) throw new Error(`failed to fetch video blob: ${response.statusText}`);
    return response.blob();
  }

  // plain HTTP remote: preCacheBlob streams into the Cache API with real
  // received/total progress (same call videoBlobAccess.ts's HTTP path uses).
  const remote = remoteOverride ?? (await getRemoteById(remoteId));
  if (!remote?.base_url) {
    throw new Error(`remote ${remoteId} has no base_url`);
  }
  const directUrl = `${remote.base_url}/api/blobs/${blobId}`;
  await preCacheBlob(directUrl, "video", remoteId, blobId, 3, video.id);
  const cached = await getCachedBlob(remoteId, blobId);
  if (cached) return cached.blob();
  // fallback: caching failed — fetch directly without progress.
  const response = await fetch(directUrl);
  if (!response.ok) throw new Error(`failed to fetch video blob: ${response.statusText}`);
  return response.blob();
}

const MIME_TO_EXTENSION: Record<string, string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "video/x-matroska": "mkv",
  "video/ogg": "ogv",
};

function extensionFromMime(mime: string): string {
  return MIME_TO_EXTENSION[mime] ?? "mp4";
}

/** sync the currently-playing remote video to the local OPFS-backed video
 * library, if "sync queue to local" is enabled and it hasn't already been
 * synced. syncs whichever blob is actually being played (the selected
 * rendition, if any, else the original) — the same file downloaded to
 * play, per the user's own framing. never throws; failures are logged
 * and simply skip the sync so playback is never affected.
 *
 * @param remoteOverride - skip the internal `getRemoteById(remote_server_id)`
 *   lookup and use this instead - for callers with a peer that was never
 *   added as a persisted `Remote` (e.g. cenotaph's tier-2 sync-to-local).
 *   see syncSongToLocal.ts's identical param for the full rationale. */
export async function syncVideoToLocal(video: QueuedVideo, remoteOverride?: Remote): Promise<void> {
  // TEMP DEBUG - remove once sync-to-local wiring bug is found
  console.log(`[debug/syncVideoToLocal] called with:`, {
    id: video.id,
    source_type: video.source_type,
    remote_server_id: video.remote_server_id,
    media_blob_id: video.media_blob_id,
    title: video.title,
    syncQueueToLocal: getSyncQueueToLocal(),
  });
  if (video.source_type !== "remote") return;
  if (!video.remote_server_id || !video.media_blob_id) return;
  if (!getSyncQueueToLocal()) return;

  // tauri's webview (WKWebView on macOS) supports OPFS getFileHandle/
  // getDirectoryHandle but not the async createWritable() writable-stream
  // api, so writeVideoToOPFS below would throw. music's syncSongToLocal.ts
  // avoids this by routing charnel-mode syncs through a native iroh-blobs
  // pull (isCharnelMode() -> syncSongViaLocalGrimoire); no video equivalent
  // route exists yet, so just skip rather than crash into the opfs write.
  if (isCharnelMode()) {
    debug(
      "videoSync",
      `skipping local sync for video ${video.id}: opfs write unsupported in charnel/tauri mode (no native sync route yet)`
    );
    return;
  }

  try {
    if (await getLocalVideoById(video.id)) {
      // TEMP DEBUG - remove once sync-to-local wiring bug is found
      console.log(
        `[debug/syncVideoToLocal] ${video.id} already exists locally - skipping (dedup by source id)`
      );
      return; // already synced
    }

    const blobId = await resolvePlaybackBlobId(video, video.remote_server_id);
    // TEMP DEBUG - remove once sync-to-local wiring bug is found
    console.log(`[debug/syncVideoToLocal] resolvePlaybackBlobId(${video.id}) = ${blobId}`);
    let videoBlob: Blob;
    try {
      videoBlob = await fetchVideoBlobWithProgress(
        video,
        video.remote_server_id,
        blobId,
        remoteOverride
      );
    } catch (err) {
      warn("videoSync", `fetch failed for video ${video.id}, skipping sync:`, err);
      return;
    }
    const extension = extensionFromMime(videoBlob.type);
    const opfsPath = await writeVideoToOPFS(videoBlob, video.id, extension);

    // a video synced in from a remote already has a blake3 on its
    // media_blobz record there - fetch it via the same shared
    // blob_metadata route videoBlobAccess.ts already uses for progress
    // (never hash client-side for a remote video; only local uploads need
    // that, see video/import/localImport.ts). best-effort: a missing
    // blake3 just means this synced copy won't be servable by blake3 to a
    // further peer, not a sync failure.
    let blake3: string | null = null;
    try {
      const remote = remoteOverride ?? (await getRemoteById(video.remote_server_id));
      if (remote) {
        const client = await getClientForRemote(remote);
        const metadataResult = await client.music.blobMetadata({ id: blobId });
        if (metadataResult.success && metadataResult.data) {
          blake3 = metadataResult.data.blake3 ?? null;
        }
      }
    } catch (err) {
      warn("videoSync", `failed to fetch blake3 for video ${video.id} (non-fatal):`, err);
    }
    // TEMP DEBUG - remove once sync-to-local wiring bug is found
    console.log(
      `[debug/syncVideoToLocal] resolved blake3 for ${video.id} (blobId=${blobId}) =`,
      blake3
    );

    let posterOpfsPath: string | null = null;
    if (video.poster_blob_id) {
      try {
        const posterUrl = await resolveBlobUrl(
          video.poster_blob_id,
          video.remote_server_id,
          "image"
        );
        const posterResponse = await fetch(posterUrl);
        if (posterResponse.ok) {
          posterOpfsPath = await writeVideoPosterToOPFS(await posterResponse.blob(), video.id);
        }
      } catch (err) {
        warn("videoSync", `poster sync failed for video ${video.id} (non-fatal):`, err);
      }
    }

    await addLocalVideo({
      id: video.id,
      title: video.title,
      opfs_path: opfsPath,
      poster_opfs_path: posterOpfsPath,
      file_name: `${video.id}.${extension}`,
      file_size: videoBlob.size,
      mime_type: videoBlob.type || "video/mp4",
      duration_seconds: video.duration_seconds ?? null,
      blake3,
    });
    markVideoSynced(video.id);

    // TEMP DEBUG - remove once sync-to-local wiring bug is found
    console.log(
      `[debug/syncVideoToLocal] addLocalVideo succeeded for ${video.id} (blake3=${blake3})`
    );
    debug("videoSync", `synced video "${video.title}" (${video.id}) to local library`);
  } catch (err) {
    // TEMP DEBUG - remove once sync-to-local wiring bug is found
    console.log(`[debug/syncVideoToLocal] threw for ${video.id}:`, err);
    warn("videoSync", `sync-to-local failed for video ${video.id}:`, err);
  }
}
