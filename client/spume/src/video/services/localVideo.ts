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
import { warn } from "../../utils/logger";

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
  localPath?: string
): Promise<string | null> {
  if (isCharnelMode()) {
    if (!localPath) return null;
    const convert = await ensureConvertFileSrc();
    if (!convert) {
      warn("localVideo", "convertFileSrc unavailable; cannot play local file under charnel");
      return null;
    }
    return convert(localPath);
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
    return video.opfs_path;
  }

  // remote item: ask the local grimoire for the synced copy's path. the sync
  // short-circuits to a db lookup when the video is already local.
  if (video.source_type === "remote") {
    const result = await syncVideoToLocal(video);
    if (result.success && result.localPath) return result.localPath;
    return null;
  }

  const local = await getLocalVideoById(video.id);
  return local?.opfs_path ?? null;
}
