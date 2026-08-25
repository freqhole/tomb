// local read/write helpers for video seasons
import { getVideoDB, STORE_VIDEO_SEASONS } from "./init";
import type { VideoSeason } from "../../../data/types";

export async function getLocalVideoSeasons(seriesId: string): Promise<VideoSeason[]> {
  const db = await getVideoDB();
  return (await db.getAllFromIndex(STORE_VIDEO_SEASONS, "by_series_id", seriesId)) as VideoSeason[];
}

export async function findLocalVideoSeasonByNumber(
  seriesId: string,
  seasonNumber: number
): Promise<VideoSeason | undefined> {
  const seasons = await getLocalVideoSeasons(seriesId);
  return seasons.find((season) => season.season_number === seasonNumber);
}

export async function createLocalVideoSeason(input: {
  series_id: string;
  season_number: number;
  title?: string | null;
  description?: string | null;
}): Promise<VideoSeason> {
  const db = await getVideoDB();
  const now = Date.now();
  const season: VideoSeason = {
    id: crypto.randomUUID(),
    series_id: input.series_id,
    season_number: input.season_number,
    title: input.title ?? null,
    description: input.description ?? null,
    poster_blob_id: null,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  };
  await db.put(STORE_VIDEO_SEASONS, season);
  return season;
}

// mirrors series.ts's `getOrCreateLocalVideoSeries` dedup-by-name
// pattern so a repeated create (double-click, or re-typing the same
// season via the autocomplete's "create new" affordance) never spawns
// duplicate local season rows for the same series.
export async function getOrCreateLocalVideoSeason(input: {
  series_id: string;
  season_number: number;
  title?: string | null;
  description?: string | null;
}): Promise<VideoSeason> {
  const existing = await findLocalVideoSeasonByNumber(input.series_id, input.season_number);
  if (existing) return existing;
  return createLocalVideoSeason(input);
}
