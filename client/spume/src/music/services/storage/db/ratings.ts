// ratings operations
import { initMusicDB } from "./init";
import type { Rating } from "../types";
import { STORE_RATINGS } from "../types";

export async function setRating(
  targetType: "song" | "album" | "artist",
  targetId: string,
  rating: number,
): Promise<void> {
  const db = await initMusicDB();
  const ratingRecord: Rating = {
    target_type: targetType,
    target_id: targetId,
    rating,
    created_at: Date.now(),
  };
  await db.put(STORE_RATINGS, ratingRecord);
}

export async function getRating(
  targetType: "song" | "album" | "artist",
  targetId: string,
): Promise<number | null> {
  const db = await initMusicDB();
  const rating = await db.get(STORE_RATINGS, [targetType, targetId]);
  return rating?.rating ?? null;
}
