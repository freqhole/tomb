// delete song from local storage
// in browser mode: deletes from OPFS + IDB (hard delete)
// in charnel/tauri mode: depends on song source:
//   - if song is from local charnel server → soft-delete from grimoire via offal
//   - if song is from remote P2P peer (cached locally) → delete from browser storage

import { isCharnelMode } from "../../../app/services/charnel";
import { debug, warn } from "../../../utils/logger";
import { deleteSongCascade } from "../storage/db/cascades";
import { unmarkSongSynced } from "../download";
import { invalidateMusicLibraryQueries } from "../../queries/cacheUpdates";
import { getCurrentRemote } from "../../data/currentState";

export interface DeleteSongResult {
  success: boolean;
  error?: string;
}

export interface DeleteSongOptions {
  /** the song's remote_server_id (to determine if it's from local charnel or remote P2P) */
  remoteServerId?: string | null;
  /** last-resort fallback lookup key if `songId` is somehow unavailable -
   *  no longer the preferred key (see session B's id/sha256 decoupling in
   *  syncSongToLocal.ts: a synced song's local `id` is a generated uuid,
   *  not its sha256, going forward). */
  sha256?: string | null;
}

/**
 * delete a song from local storage
 * @param songId - the song's local id (grimoire db row id for tauri,
 *   the local IDB row's own generated id for browser)
 * @param options - context about the song source and lookup keys
 * @returns result with success status
 */
export async function deleteSongFromLocal(
  songId: string,
  options: DeleteSongOptions = {}
): Promise<DeleteSongResult> {
  if (isCharnelMode()) {
    // check if song is from the local charnel-managed server
    const currentRemote = getCurrentRemote();
    const isFromLocalCharnel =
      currentRemote?.is_charnel_managed === true &&
      options.remoteServerId === currentRemote.remote_id;

    if (isFromLocalCharnel) {
      // song is in local grimoire → soft-delete via offal
      return deleteSongViaOffal(songId);
    }
    // song is from a remote P2P peer, cached in browser → delete from
    // browser. `songId` is the caller's own `song.id` (the real local IDB
    // primary key, see syncSongToLocal.ts's session B id/sha256
    // decoupling) - `options.sha256` is only a last-resort fallback now,
    // not the preferred key it used to be.
    const browserKey = songId || options.sha256;
    if (!browserKey) {
      return { success: false, error: "missing song id for browser storage lookup" };
    }
    debug(
      "deleteSongFromLocal",
      `song ${browserKey.slice(0, 8)}... is from remote peer, deleting from browser storage`
    );
    return deleteSongFromBrowser(browserKey);
  }
  return deleteSongFromBrowser(songId);
}

/**
 * delete song from browser storage (OPFS + IDB)
 */
async function deleteSongFromBrowser(songId: string): Promise<DeleteSongResult> {
  try {
    const result = await deleteSongCascade(songId, true);
    debug(
      "deleteSongFromLocal",
      `deleted song ${songId.slice(0, 8)}... from browser storage (${result.deletedBlobs} blobs)`
    );

    // also unmark from synced cache so it can be re-synced if needed
    unmarkSongSynced(songId);
    invalidateMusicLibraryQueries();

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warn("deleteSongFromLocal", `failed to delete song from browser: ${message}`);
    return { success: false, error: message };
  }
}

/**
 * delete song via grimoire offal route (tauri mode)
 * this soft-deletes the song (sets deleted_at)
 */
async function deleteSongViaOffal(songId: string): Promise<DeleteSongResult> {
  try {
    // eslint-disable-next-line no-restricted-syntax -- tauri-only api, avoid bundling into web builds
    const { invoke } = await import("@tauri-apps/api/core");

    const response = (await invoke("api_call", {
      path: "/api/songs/delete",
      body: { id: songId },
    })) as { success: boolean; message: string };

    if (!response.success) {
      return { success: false, error: response.message };
    }

    debug("deleteSongFromLocal", `soft-deleted song ${songId.slice(0, 8)}... from grimoire`);
    invalidateMusicLibraryQueries();
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warn("deleteSongFromLocal", `failed to delete song via offal: ${message}`);
    return { success: false, error: message };
  }
}
