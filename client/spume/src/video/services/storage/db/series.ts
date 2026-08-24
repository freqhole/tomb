// local read/write helpers for video series
import { getVideoDB, STORE_VIDEO_SERIES } from "./init";
import type { PaginatedVideoSeries, VideoSeries } from "../../../data/types";

export async function findLocalVideoSeriesByTitle(title: string): Promise<VideoSeries | undefined> {
  const db = await getVideoDB();
  const index = db.transaction(STORE_VIDEO_SERIES).store.index("by_title");
  return index.get(title);
}

export async function createLocalVideoSeries(input: {
  title: string;
  description?: string | null;
}): Promise<VideoSeries> {
  const db = await getVideoDB();
  const now = Date.now();
  const series: VideoSeries = {
    id: crypto.randomUUID(),
    title: input.title,
    description: input.description ?? null,
    poster_blob_id: null,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    created_by: null,
    updated_by: null,
    deleted_by: null,
  } as VideoSeries;
  await db.put(STORE_VIDEO_SERIES, series);
  return series;
}

export async function getOrCreateLocalVideoSeries(title: string): Promise<VideoSeries> {
  const existing = await findLocalVideoSeriesByTitle(title);
  if (existing) return existing;
  return createLocalVideoSeries({ title });
}

export async function updateLocalVideoSeries(
  seriesId: string,
  updates: { title?: string; description?: string | null; poster_blob_id?: string | null }
): Promise<void> {
  const db = await getVideoDB();
  const existing = (await db.get(STORE_VIDEO_SERIES, seriesId)) as VideoSeries | undefined;
  if (!existing) {
    throw new Error(`video series not found: ${seriesId}`);
  }
  const updated: VideoSeries = { ...existing, ...updates, updated_at: Date.now() } as VideoSeries;
  await db.put(STORE_VIDEO_SERIES, updated);
}

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
