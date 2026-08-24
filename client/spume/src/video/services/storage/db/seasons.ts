// minimal local read helpers for video seasons (not populated by any
// writer yet — always returns empty results until a local sync exists)
import { getVideoDB, STORE_VIDEO_SEASONS } from "./init";
import type { VideoSeason } from "../../../data/types";

export async function getLocalVideoSeasons(seriesId: string): Promise<VideoSeason[]> {
  const db = await getVideoDB();
  return (await db.getAllFromIndex(STORE_VIDEO_SEASONS, "by_series_id", seriesId)) as VideoSeason[];
}
