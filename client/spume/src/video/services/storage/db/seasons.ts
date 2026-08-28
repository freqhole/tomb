// local read/write helpers for video seasons
import { getVideoDB, STORE_VIDEO_SEASONS } from "./init";
import type { VideoSeason } from "../../../data/types";

export async function getLocalVideoSeasons(seriesId: string): Promise<VideoSeason[]> {
  const db = await getVideoDB();
  return (await db.getAllFromIndex(STORE_VIDEO_SEASONS, "by_series_id", seriesId)) as VideoSeason[];
}

/** every non-deleted season in local storage, across every series.
 *  mirrors grimoire's `list_video_seasons(None)` bulk fetch (see
 *  docs/graph-viz-video-domain-plan.md phase 5a) — used by graph viz to
 *  build the season tier without a per-series round trip. */
export async function getAllLocalVideoSeasons(): Promise<VideoSeason[]> {
  const db = await getVideoDB();
  const seasons = (await db.getAll(STORE_VIDEO_SEASONS)) as VideoSeason[];
  return seasons.filter((s) => !s.deleted_at);
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

/** hard-delete a season row from local storage - caller is responsible
 *  for deleting/reassigning any videos that reference it first (mirrors
 *  grimoire's `delete_video_season` cascade; see
 *  `LocalVideoDataSource.deleteVideoSeries`, the only local caller). */
export async function deleteLocalVideoSeason(seasonId: string): Promise<void> {
  const db = await getVideoDB();
  await db.delete(STORE_VIDEO_SEASONS, seasonId);
}

export async function updateLocalVideoSeason(
  seasonId: string,
  updates: {
    season_number?: number;
    title?: string | null;
    description?: string | null;
    poster_blob_id?: string | null;
  }
): Promise<void> {
  const db = await getVideoDB();
  const existing = (await db.get(STORE_VIDEO_SEASONS, seasonId)) as VideoSeason | undefined;
  if (!existing) {
    throw new Error(`video season not found: ${seasonId}`);
  }
  const updated: VideoSeason = { ...existing, ...updates, updated_at: Date.now() };
  await db.put(STORE_VIDEO_SEASONS, updated);
}
