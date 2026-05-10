// facade helpers — small utilities used by the player facade to
// keep `player.ts` readable. extracted because they're re-used by
// future code paths (e.g. the future "loadSong without playing"
// helper for the queue's pre-buffer logic).

import { getDataSource } from "../../data";
import type { Song } from "../storage/types";

/**
 * resolve a `string | Song` into a materialized `Song`. throws if
 * the id can't be found in the local data source. used by the
 * facade's `playSong` to make sure backends always get a Song
 * object (the rodio backend in particular needs `media_blob_id` to
 * resolve a filesystem path).
 */
export async function resolveSongOrId(songOrId: string | Song): Promise<Song> {
  if (typeof songOrId !== "string") return songOrId;
  const dataSource = getDataSource();
  const song = await dataSource.getSongById(songOrId);
  if (!song) {
    throw new Error(`song not found: ${songOrId}`);
  }
  return song;
}
