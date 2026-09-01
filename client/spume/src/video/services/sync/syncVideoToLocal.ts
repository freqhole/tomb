// sync-to-local for remote video playback — mirrors the essential shape of
// music/services/sync/syncSongToLocal.ts, deliberately scoped down: dedup
// by the video's own id (not a content hash — `Video` has no sha256 field
// yet). plain http remotes stream straight to opfs with byte-range resume
// (see streamVideoToOPFSWithResume) so a large video that fails partway
// through picks back up where it left off instead of restarting from byte
// 0 on every retry/replay. P2P/charnel remotes still go through
// preCacheP2PBlob/getCachedBlob (iroh-blobs is already content-addressed
// and block-verified — a different resume story, out of scope here).
//
// fired (fire-and-forget) from VideoBackend.loadAndPlay whenever a remote
// video is played and the "sync queue to local" setting is on.

import {
  resolveBlobUrl,
  usesBlobResolver,
  preCacheP2PBlob,
} from "../../../music/services/storage/blobResolver";
import { getCachedBlob } from "../../../music/services/cache/blobCache";
import {
  addToLoadingSet,
  updateLoadingProgress,
  removeFromLoadingSet,
} from "../../../music/services/download";
import { getSyncQueueToLocal } from "../../../app/services/storage/db";
import { isCharnelMode } from "../../../app/services/charnel";
import { getRemoteById } from "../../../app/services/remotes/remoteManager";
import { getClientForRemote } from "../../../app/api/client";
import type { Remote } from "../../../app/services/storage/schemas/remote";
import { addLocalVideo, getLocalVideoById } from "../storage/db/videos";
import { markVideoSynced } from "../syncState";
import {
  writeVideoPosterToOPFS,
  writeVideoToOPFS,
  streamVideoToOPFSWithResume,
} from "../opfs/helpers";
import { resolvePlaybackBlobId } from "../videoBlobAccess";
import { syncVideoViaLocalGrimoire } from "./syncVideoViaLocalGrimoire";
import type { QueuedVideo } from "../../../app/services/storage/mediaItem";
import type { BlobMetadataResponse } from "@freqhole/api-client";
import { debug, warn } from "../../../utils/logger";

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

/** look up size/mime/blake3 for a video's blob up front - lets the http
 *  download path pick the right (stable, resume-friendly) file extension
 *  and know the total size *before* fetching, and avoids a second
 *  metadata round-trip later just for blake3. best-effort: a failure here
 *  just means less metadata, never blocks the sync. */
async function fetchBlobMetadata(
  remoteId: string,
  blobId: string,
  remoteOverride?: Remote
): Promise<Partial<BlobMetadataResponse>> {
  try {
    const remote = remoteOverride ?? (await getRemoteById(remoteId));
    if (!remote) return {};
    const client = await getClientForRemote(remote);
    const metadataResult = await client.music.blobMetadata({ id: blobId });
    if (metadataResult.success && metadataResult.data) {
      return metadataResult.data;
    }
  } catch (err) {
    warn("videoSync", `failed to fetch blob metadata for ${blobId} (non-fatal):`, err);
  }
  return {};
}

/** fetch the full video blob via the P2P/charnel path, tracking download
 *  progress under `video.id` (preCacheP2PBlob owns addToLoadingSet/
 *  updateLoadingProgress itself, type "video"). */
async function fetchP2PVideoBlob(
  video: QueuedVideo,
  remoteId: string,
  blobId: string
): Promise<Blob> {
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

/** check if a video can be synced (is remote and has required fields) —
 *  mirrors music's `canSyncSong` (syncSongToLocal.ts). */
export function canSyncVideo(video: QueuedVideo): boolean {
  return video.source_type === "remote" && !!video.remote_server_id && !!video.media_blob_id;
}

/** charnel/tauri: hand the sync off to the local grimoire, which pulls the
 * video bytes itself over iroh. progress is reported under the video's own id
 * so the queue row's indicator behaves the same as the browser path. */
async function syncVideoViaCharnel(video: QueuedVideo, remoteOverride?: Remote): Promise<void> {
  const remoteId = video.remote_server_id!;
  const remote = remoteOverride ?? (await getRemoteById(remoteId));
  if (!remote) {
    warn("videoSync", `remote ${remoteId} not found, skipping charnel sync for ${video.id}`);
    return;
  }

  const blobId = await resolvePlaybackBlobId(video, remoteId);
  const meta = await fetchBlobMetadata(remoteId, blobId, remoteOverride);

  addToLoadingSet(video.id);
  updateLoadingProgress(video.id, null); // grimoire's pull reports no progress back
  try {
    const result = await syncVideoViaLocalGrimoire(
      video,
      remote,
      blobId,
      meta.blake3 ?? null,
      meta.size,
      meta.mime
    );
    if (!result.success) {
      warn("videoSync", `charnel sync failed for video ${video.id}: ${result.error}`);
      return;
    }
    markVideoSynced(video.id);
    debug(
      "videoSync",
      `synced video "${video.title}" (${video.id}) into the local library via grimoire (existing=${result.skipped})`
    );
  } finally {
    removeFromLoadingSet(video.id);
  }
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
  if (video.source_type !== "remote") return;
  if (!video.remote_server_id || !video.media_blob_id) return;
  if (!getSyncQueueToLocal()) return;
  // tauri's webview (WKWebView on macOS) supports OPFS getFileHandle/
  // getDirectoryHandle but not the async createWritable() writable-stream
  // api, so writeVideoToOPFS below would throw. charnel-mode syncs instead go
  // through the local grimoire, which pulls the bytes natively by blake3 -
  // same split music's syncSongToLocal.ts uses.
  if (isCharnelMode()) {
    await syncVideoViaCharnel(video, remoteOverride);
    return;
  }

  try {
    if (await getLocalVideoById(video.id)) return; // already synced

    const blobId = await resolvePlaybackBlobId(video, video.remote_server_id);

    let opfsPath: string;
    let fileSize: number;
    let mimeType: string;
    let blake3: string | null = null;

    if (await usesBlobResolver(video.remote_server_id)) {
      // P2P/charnel: fetch a full blob via the existing cache-warming path.
      let videoBlob: Blob;
      try {
        videoBlob = await fetchP2PVideoBlob(video, video.remote_server_id, blobId);
      } catch (err) {
        warn("videoSync", `fetch failed for video ${video.id}, skipping sync:`, err);
        return;
      }
      const extension = extensionFromMime(videoBlob.type);
      opfsPath = await writeVideoToOPFS(videoBlob, video.id, extension);
      fileSize = videoBlob.size;
      mimeType = videoBlob.type || "video/mp4";
      const meta = await fetchBlobMetadata(video.remote_server_id, blobId, remoteOverride);
      blake3 = meta.blake3 ?? null;
    } else {
      // plain http remote: stream straight to opfs, resuming a previously
      // interrupted download instead of restarting from byte 0 - critical
      // for large videos, which are otherwise prone to failing partway
      // through and starting over on every retry/replay.
      const remote = remoteOverride ?? (await getRemoteById(video.remote_server_id));
      if (!remote?.base_url) {
        warn(
          "videoSync",
          `remote ${video.remote_server_id} has no base_url, skipping sync for ${video.id}`
        );
        return;
      }
      const meta = await fetchBlobMetadata(video.remote_server_id, blobId, remoteOverride);
      const extension = extensionFromMime(meta.mime ?? "video/mp4");
      mimeType = meta.mime ?? "video/mp4";
      blake3 = meta.blake3 ?? null;

      const directUrl = `${remote.base_url}/api/blobs/${blobId}`;
      addToLoadingSet(video.id);
      updateLoadingProgress(video.id, null);
      try {
        const result = await streamVideoToOPFSWithResume(
          directUrl,
          video.id,
          extension,
          meta.size ?? null,
          (received, total) => updateLoadingProgress(video.id, total ? received / total : null)
        );
        opfsPath = result.opfsPath;
        fileSize = result.size;
      } catch (err) {
        warn(
          "videoSync",
          `fetch failed for video ${video.id}, skipping sync (bytes written so far are kept on disk for the next attempt to resume from):`,
          err
        );
        return;
      } finally {
        removeFromLoadingSet(video.id);
      }
    }

    // a video synced in from a remote already has a blake3 on its
    // media_blobz record there - never hash client-side for a remote video
    // (only local uploads need that, see video/import/localImport.ts). a
    // missing blake3 just means this synced copy won't be servable by
    // blake3 to a further peer, not a sync failure.

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
      file_name: opfsPath.split("/").pop()!,
      file_size: fileSize,
      mime_type: mimeType,
      duration_seconds: video.duration_seconds ?? null,
      blake3,
    });
    markVideoSynced(video.id);

    debug("videoSync", `synced video "${video.title}" (${video.id}) to local library`);
  } catch (err) {
    warn("videoSync", `sync-to-local failed for video ${video.id}:`, err);
  }
}
