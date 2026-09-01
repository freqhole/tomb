// resolve a playable url for video that already lives in the local library.
//
// mirrors music's localAudio.ts: the library is OPFS in the browser and
// grimoire's filesystem under charnel, so callers that want tier-1 bytes go
// through here rather than reaching for OPFS directly.

import { readVideoFromOPFS } from "./opfs/helpers";
import { getLocalVideoById } from "./storage/db/videos";
import { isCharnelMode } from "../../app/services/charnel";
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
