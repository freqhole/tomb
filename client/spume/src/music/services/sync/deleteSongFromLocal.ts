// delete song from local storage
// in browser mode: deletes from OPFS + IDB (hard delete)
// in charnel/tauri mode: soft-deletes from grimoire via offal route

import { isCharnelMode } from "../../../app/services/charnel";
import { debug, warn } from "../../../utils/logger";
import { deleteSongCascade } from "../storage/db/cascades";
import { unmarkSongSynced } from "../download";

export interface DeleteSongResult {
  success: boolean;
  error?: string;
}

/**
 * delete a song from local storage
 * @param songId - the song ID (sha256 for browser, uuid for tauri)
 * @returns result with success status
 */
export async function deleteSongFromLocal(songId: string): Promise<DeleteSongResult> {
  if (isCharnelMode()) {
    return deleteSongViaOffal(songId);
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
