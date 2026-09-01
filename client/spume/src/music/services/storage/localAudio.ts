// resolve a playable url for audio that already lives in the local library.
//
// the library is OPFS in the browser and grimoire's filesystem under charnel,
// so "read the local copy" means two different things. every caller that wants
// tier-1 bytes goes through here rather than reaching for OPFS directly, which
// is what made the previous local-first playback fix browser-only.

import { readAudioFromOPFS } from "../opfs/helpers";
import { getSongBySha256 } from "./db/songs";
import { isCharnelMode } from "../../../app/services/charnel";
import { warn } from "../../../utils/logger";

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
 * build a playable url for a song already in the local library, or null if it
 * isn't there (or can't be read).
 *
 * @param sha256 - library key. DEPRECATED(sha256): becomes blake3 when the
 *   library is rekeyed.
 * @param localPath - absolute fs path, when the caller already has one from a
 *   charnel sync. saves re-resolving it.
 */
export async function resolveLocalAudioUrl(
  sha256: string,
  localPath?: string
): Promise<string | null> {
  if (isCharnelMode()) {
    if (!localPath) return null;
    const convert = await ensureConvertFileSrc();
    if (!convert) {
      warn("localAudio", "convertFileSrc unavailable; cannot play local file under charnel");
      return null;
    }
    return convert(localPath);
  }

  const local = await getSongBySha256(sha256);
  if (!local?.opfs_path) return null;
  try {
    const file = await readAudioFromOPFS(local.opfs_path);
    return URL.createObjectURL(file);
  } catch (err) {
    // a missing/corrupt local file should degrade to streaming, not hard-fail
    warn("localAudio", `opfs read failed for ${sha256.slice(0, 8)}:`, err);
    return null;
  }
}
