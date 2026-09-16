// shared "is this content already on disk in charnel's own grimoire
// library?" check, keyed purely by blake3 - used as the very first step
// of resolving ANY remote media item (song or video) for playback,
// before ever considering a sync or a P2P fetch.
//
// `media_blobz` (the table this ultimately queries, via
// `resolve_blob_path_by_blake3`) is a single table shared across every
// media domain - a blob doesn't know or care whether it's linked to a
// song or a video row, so this same lookup is correct for both. this
// also transparently handles the "self-peer" case (a queue item whose
// declared `source_peer_addr` happens to be this very device - e.g.
// content the controller originally browsed FROM this player and queued
// straight back to it): the content is already sitting in this device's
// own library under its real blake3, so this check finds it immediately
// and no P2P dial (which iroh flatly refuses for a self-connect) is ever
// attempted.
//
// extracted out of audioAccess.ts (previously audio-only, named
// `resolveCharnelLocalPath`) so video can share the exact same check
// instead of relying on its own, less-authoritative client-side
// "synced" cache.

import { isCharnelMode } from "../charnel";

/** the real on-disk path for `blake3` in charnel's own library, or `null`
 * if it isn't there (or we're not in charnel mode, or `blake3` is
 * unknown). */
export async function resolveCharnelLocalBlobPath(
  blake3: string | null | undefined
): Promise<string | null> {
  if (!isCharnelMode() || !blake3) return null;
  try {
    // eslint-disable-next-line no-restricted-syntax -- tauri-only api, avoid bundling into web builds
    const { invoke } = await import("@tauri-apps/api/core");
    const result = await invoke<{ path: string }>("resolve_blob_path_by_blake3", { blake3 });
    return result.path;
  } catch {
    return null;
  }
}
