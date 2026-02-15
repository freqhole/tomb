// clear data and playlist helpers
import { initMusicDB } from "./init";
import type { Playlist } from "../types";
import {
  STORE_ALBUM_TAGS,
  STORE_ALBUMS,
  STORE_ARTISTS,
  STORE_FAVORITES,
  STORE_GENRES,
  STORE_PLAYLIST_SONGS,
  STORE_PLAYLISTS,
  STORE_RATINGS,
  STORE_SONGS,
  STORE_TAGS,
} from "../types";
import { debug } from "../../../../utils/logger";

export async function clearAllMusicData(): Promise<void> {
  const db = await initMusicDB();
  await db.clear(STORE_ARTISTS);
  await db.clear(STORE_ALBUMS);
  await db.clear(STORE_SONGS);
  await db.clear(STORE_GENRES);
  await db.clear(STORE_PLAYLISTS);
  await db.clear(STORE_PLAYLIST_SONGS);
  await db.clear(STORE_FAVORITES);
  await db.clear(STORE_RATINGS);
  await db.clear(STORE_TAGS);
  await db.clear(STORE_ALBUM_TAGS);
  debug("cleared all music data");
}

export async function getPlaylistById(
  playlistId: string,
): Promise<Playlist | undefined> {
  const db = await initMusicDB();
  return db.get(STORE_PLAYLISTS, playlistId);
}
