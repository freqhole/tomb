// delete song from local storage
// in browser mode: deletes from OPFS + IDB (hard delete)
// in charnel/tauri mode: depends on song source:
//   - if song is from local charnel server → soft-delete from grimoire via offal
//   - if song is from remote P2P peer (cached locally) → delete from browser storage

import { isCharnelMode } from "../../../app/services/charnel";
import { debug, warn } from "../../../utils/logger";
import { deleteSongCascade } from "../storage/db/cascades";
import { unmarkSongSynced } from "../download";
import { getCurrentRemote } from "../../data";

export interface DeleteSongResult {
  success: boolean;
  error?: string;
}

export interface DeleteSongOptions {
  /** the song's remote_server_id (to determine if it's from local charnel or remote P2P) */
  remoteServerId?: string | null;
  /** the song's sha256 hash (for browser storage lookup - required for synced songs) */
  sha256?: string | null;
}

/**
 * delete a song from local storage
 * @param songId - the song ID (grimoire UUID for tauri, sha256 for browser)
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
    // song is from a remote P2P peer, cached in browser → delete from browser
    // use sha256 as lookup key since that's how synced songs are stored in IDB
    const browserKey = options.sha256 || songId;
    debug("deleteSongFromLocal", `song ${browserKey.slice(0, 8)}... is from remote peer, deleting from browser storage`);
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
    debug("deleteSongFromLocal", `deleted song ${songId.slice(0, 8)}... from browser storage (${result.deletedBlobs} blobs)`);
    
    // also unmark from synced cache so it can be re-synced if needed
    unmarkSongSynced(songId);
    
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
    const { invoke } = await import("@tauri-apps/api/core");
    
    const response = await invoke("api_call", {
      path: "/api/songs/delete",
      body: { id: songId },
    }) as { success: boolean; message: string };

    if (!response.success) {
      return { success: false, error: response.message };
    }

    debug("deleteSongFromLocal", `soft-deleted song ${songId.slice(0, 8)}... from grimoire`);
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warn("deleteSongFromLocal", `failed to delete song via offal: ${message}`);
    return { success: false, error: message };
  }
}
