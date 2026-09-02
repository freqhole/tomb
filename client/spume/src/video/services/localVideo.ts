// resolve a playable url for video that already lives in the local library.
//
// mirrors music's localAudio.ts: the library is OPFS in the browser and
// grimoire's filesystem under charnel, so callers that want tier-1 bytes go
// through here rather than reaching for OPFS directly.

import { readVideoFromOPFS } from "./opfs/helpers";
import { getLocalVideoById } from "./storage/db/videos";
import { syncVideoToLocal } from "./sync/syncVideoToLocal";
import { isCharnelMode } from "../../app/services/charnel";
import type { QueuedVideo } from "../../app/services/storage/mediaItem";
import { warn, debug } from "../../utils/logger";

let convertFileSrc: ((path: string) => string) | null = null;

async function ensureConvertFileSrc(): Promise<((path: string) => string) | null> {
  if (convertFileSrc) return convertFileSrc;
  try {
    const tauri = await import("@tauri-apps/api/core");
    convertFileSrc = tauri.convertFileSrc;
    return convertFileSrc;
  } catch {
    return null;
  }
}

/**
 * build a playable url for a video already in the local library, or null if it
 * isn't there (or can't be read).
 *
 * @param localPath - absolute fs path, when the caller already has one from a
 *   charnel sync. saves re-resolving it.
 */
export async function resolveLocalVideoUrl(
  videoId: string,
  localPath?: string,
  bufferForWebview = false
): Promise<string | null> {
  if (isCharnelMode()) {
    if (!localPath) return null;
    const convert = await ensureConvertFileSrc();
    if (!convert) {
      warn("localVideo", "convertFileSrc unavailable; cannot play local file under charnel");
      return null;
    }
    const assetUrl = convert(localPath);
    if (!bufferForWebview) return assetUrl;

    // WebKitGTK rejects asset:// in <video>. The non-experimental fallback
    // deliberately pays the full-memory cost to hand it a blob: URL instead.
    try {
      const response = await fetch(assetUrl);
      if (!response.ok) {
        throw new Error(`asset fetch returned ${response.status}`);
      }
      const blob = await response.blob();
      // TEMP(video-window): confirms the fallback handed WebKitGTK a blob:
      // URL and reports the memory cost that this compatibility mode accepts.
      console.info(`[video-window] buffered ${videoId} bytes=${blob.size}`);
      return URL.createObjectURL(blob);
    } catch (err) {
      warn("localVideo", `failed to buffer local video ${videoId}:`, err);
      return null;
    }
  }

  const local = await getLocalVideoById(videoId);
  if (!local?.opfs_path) return null;
  try {
    const file = await readVideoFromOPFS(local.opfs_path);
    return URL.createObjectURL(file);
  } catch (err) {
    // a missing/corrupt local file should degrade to streaming, not hard-fail
    warn("localVideo", `opfs read failed for video ${videoId}:`, err);
    return null;
  }
}

/**
 * absolute filesystem path of a video's local copy, or null.
 *
 * distinct from `resolveLocalVideoUrl`: gstreamer opens a real file, so an
 * `asset://` url or an OPFS object url is no use to it. only charnel has a
 * filesystem library, so this is null in the browser by definition.
 */
export async function resolveLocalVideoPath(video: QueuedVideo): Promise<string | null> {
  if (!isCharnelMode()) return null;

  if (video.source_type === "local" && video.opfs_path) {
    // a charnel-imported video records its fs path in opfs_path
    console.info(`[video-window] using imported local path for ${video.id}: ${video.opfs_path}`);
    return video.opfs_path;
  }

  // Charnel's library rows are served by grimoire and normally have no
  // browser-only opfs_path. Their local media_blob_id is the stable bridge to
  // the filesystem, exactly as RodioBackend resolves local audio paths.
  // checked before the remote-sync branch below: a video whose bytes are
  // already resident locally (prior sync, or already-local-in-grimoire)
  // must never re-trigger a remote pull, which can pick a not-yet-ready
  // rendition blob (no blake3 yet) and fail even though the original bytes
  // already sit on disk.
  if (video.media_blob_id) {
    try {
      // eslint-disable-next-line no-restricted-syntax -- tauri-only api, avoid bundling into web builds
      const { invoke } = await import("@tauri-apps/api/core");
      const result = await invoke<{ path: string }>("resolve_blob_path", {
        blobId: video.media_blob_id,
      });
      console.info(`[video-window] resolved local ${video.id} from ${result.path}`);
      return result.path;
    } catch (err) {
      debug("localVideo", `media_blob_id not resolvable locally yet for ${video.id}:`, err);
      // a non-remote video's media_blob_id is its only bridge to the
      // filesystem - no remote to fall back to syncing from.
      if (video.source_type !== "remote") {
        console.info(`[video-window] no local path found for ${video.id}`);
        return null;
      }
    }
  }

  // remote item: ask the local grimoire for the synced copy's path. the sync
  // short-circuits to a db lookup when the video is already local.
  if (video.source_type === "remote") {
    const result = await syncVideoToLocal(video);
    if (result.success && result.localPath) return result.localPath;
    console.info(
      `[video-window] remote sync did not yield a local path for ${video.id} (${result.error ?? "no path"})`
    );
    return null;
  }

  const local = await getLocalVideoById(video.id);
  if (!local?.opfs_path) {
    console.info(
      `[video-window] no local path found for ${video.id} (source_type=${video.source_type}, media_blob_id=${video.media_blob_id ?? "none"})`
    );
    return null;
  }
  return local.opfs_path;
}
