// ratings operations
import { initMusicDB } from "./init";
import type { Rating } from "../types";
import { STORE_RATINGS } from "../types";

export async function setRating(
  targetType: "song" | "album" | "artist" | "video",
  targetId: string,
  rating: number
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
  targetType: "song" | "album" | "artist" | "video",
  targetId: string
): Promise<number | null> {
  const db = await initMusicDB();
  const rating = await db.get(STORE_RATINGS, [targetType, targetId]);
  return rating?.rating ?? null;
}

// bulk-read every locally-rated target's rating of a given type (e.g. all
// locally-rated video ids). mirrors favorites.ts's getFavoritedTargetIds -
// used by domains (video) that have no local denormalized `user_rating`
// field on their own records and must resolve rating status from this
// shared ratings store instead.
export async function getRatingsMap(
  targetType: "song" | "album" | "artist" | "video"
): Promise<Map<string, number>> {
  const db = await initMusicDB();
  const index = db.transaction(STORE_RATINGS).store.index("by_target_type");
  const ratings = (await index.getAll(targetType)) as Rating[];
  return new Map(ratings.map((r) => [r.target_id, r.rating]));
}
