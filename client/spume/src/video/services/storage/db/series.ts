// minimal local read helpers for video series (not populated by any
// writer yet — always returns empty results until a local sync exists)
import { getVideoDB, STORE_VIDEO_SERIES } from "./init";
import type { PaginatedVideoSeries, VideoSeries } from "../../../data/types";

export async function getLocalVideoSeriesList(params?: {
  offset?: number;
  limit?: number;
  search?: string;
}): Promise<PaginatedVideoSeries> {
  const limit = params?.limit ?? 50;
  const offset = params?.offset ?? 0;

  const db = await getVideoDB();
  let items = (await db.getAll(STORE_VIDEO_SERIES)) as VideoSeries[];

  if (params?.search) {
    const searchLower = params.search.toLowerCase();
    items = items.filter((series) => series.title?.toLowerCase().includes(searchLower));
  }

  const total_count = items.length;
  const paged = items.slice(offset, offset + limit);

  return {
    items: paged,
    total_count,
    has_more: offset + limit < total_count,
    offset,
  };
}
