// favorites operations
import { initMusicDB } from "./init";
import type { Favorite } from "../types";
import { STORE_FAVORITES } from "../types";

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

export async function migrateFavorite(
  targetType: "song" | "album" | "artist" | "playlist",
  oldId: string,
  newId: string,
): Promise<void> {
  const db = await initMusicDB();
  const oldFavorite = await db.get(STORE_FAVORITES, [targetType, oldId]);
  if (oldFavorite) {
    // copy to new entity
    await setFavorite(targetType, newId, true);
    // delete old favorite
    await db.delete(STORE_FAVORITES, [targetType, oldId]);
  }
}
