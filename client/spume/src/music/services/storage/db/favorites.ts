// favorites operations
import { initMusicDB } from "./init";
import type { Favorite, Song } from "../types";
import { STORE_FAVORITES, STORE_SONGS } from "../types";

export async function setFavorite(
  targetType: "song" | "album" | "artist" | "playlist",
  targetId: string,
  isFavorite: boolean,
): Promise<void> {
  const db = await initMusicDB();

  if (isFavorite) {
    const favorite: Favorite = {
      target_type: targetType,
      target_id: targetId,
      favorited_at: Date.now(),
    };
    await db.put(STORE_FAVORITES, favorite);
  } else {
    await db.delete(STORE_FAVORITES, [targetType, targetId]);
  }
}

export async function checkFavorite(
  targetType: "song" | "album" | "artist" | "playlist",
  targetId: string,
): Promise<boolean> {
  const db = await initMusicDB();
  const favorite = await db.get(STORE_FAVORITES, [targetType, targetId]);
  return !!favorite;
}

// aggregate distinct album_id and artist_id sets from all song
// favorites in the local idb library. mirrors the server-side
// favorites_only=true querySongs path used for peer remotes; lets
// the graph favorites hub include songs (not just album/artist
// direct favorites).
export async function listFavoritedSongAlbumArtistIds(): Promise<{
  album_ids: Set<string>;
  artist_ids: Set<string>;
}> {
  const db = await initMusicDB();
  const songFavIndex = db.transaction(STORE_FAVORITES).store.index("by_target_type");
  const songFavs = (await songFavIndex.getAll("song")) as Favorite[];
  const album_ids = new Set<string>();
  const artist_ids = new Set<string>();
  if (songFavs.length === 0) return { album_ids, artist_ids };
  const songs = await Promise.all(
    songFavs.map((f) => db.get(STORE_SONGS, f.target_id) as Promise<Song | undefined>),
  );
  for (const song of songs) {
    if (!song) continue;
    if (song.album_id) album_ids.add(song.album_id);
    if (song.artist_id) artist_ids.add(song.artist_id);
  }
  return { album_ids, artist_ids };
}
