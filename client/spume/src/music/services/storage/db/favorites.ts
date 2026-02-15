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
