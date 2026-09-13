// dial-side implementation of cenotaph's `LocalLibraryHooks` (see
// lib/cenotaph/ts/src/playback/playbackEngine.ts) - bridges cenotaph's
// generic playback engine to spume's own browser IDB/OPFS song library,
// so queued media gets promoted into a real local library entry (not just
// an ephemeral blob cache) when "sync queue to local" is on. see
// docs/cenotaph-migration-plan.md phase 3, tier 2.
//
// registered once, unconditionally, right next to
// `initRemotePlaybackAcceptMode()` in app/api/client.ts - both sides
// (this tab being controlled, or this tab controlling itself via
// `/player/`) share the exact same `mediaPlaybackBackend` singleton, so
// hooks need to be set regardless of which side ends up actually playing.

import { setLocalLibraryHooks, type LocalLibraryHooks, type MediaRef } from "@freqhole/cenotaph";
import { getSyncQueueToLocal } from "../storage/db";
import { getSongByBlake3 } from "../../../music/services/storage/db/songs";
import { readAudioFromOPFS } from "../../../music/services/opfs/helpers";
import { getVideoByBlake3 } from "../../../video/services/storage/db/videos";
import { readVideoFromOPFS } from "../../../video/services/opfs/helpers";
import { resolveMediaRefToSong, resolveMediaRefToVideo } from "./mediaRefResolve";
import { warn } from "../../../utils/logger";

async function getLocalBlob(blake3Hash: string): Promise<Blob | null> {
  const song = await getSongByBlake3(blake3Hash);
  if (song?.opfs_path) {
    try {
      return await readAudioFromOPFS(song.opfs_path);
    } catch (err) {
      warn(
        "localLibraryHooks",
        `failed to read local audio for ${blake3Hash.slice(0, 8)}...:`,
        err
      );
      return null;
    }
  }

  const video = await getVideoByBlake3(blake3Hash);
  if (video?.opfs_path) {
    try {
      return await readVideoFromOPFS(video.opfs_path);
    } catch (err) {
      warn(
        "localLibraryHooks",
        `failed to read local video for ${blake3Hash.slice(0, 8)}...:`,
        err
      );
      return null;
    }
  }

  return null;
}

function isSyncEnabled(): boolean {
  return getSyncQueueToLocal();
}

/** resolves `item` to bytes for cenotaph's own playback engine - via the
 * shared `mediaRefResolve.ts` resolvers (which promote the item into a
 * real local library entry, syncing it in from its source peer first if
 * needed), then reads the resulting local file back out of OPFS. */
async function syncToLocal(item: MediaRef): Promise<Blob | null> {
  if (item.kind === "video") {
    const video = await resolveMediaRefToVideo(item);
    return video ? getLocalBlob(item.blake3_hash) : null;
  }
  const song = await resolveMediaRefToSong(item);
  return song ? getLocalBlob(item.blake3_hash) : null;
}

const hooks: LocalLibraryHooks = { getLocalBlob, isSyncEnabled, syncToLocal };

let started = false;

/** wires spume's browser library into cenotaph's playback engine. safe to
 * call more than once (no-ops after the first call). */
export function initLocalLibraryHooks(): void {
  if (started) return;
  started = true;
  setLocalLibraryHooks(hooks);
}
