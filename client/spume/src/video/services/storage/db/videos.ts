// local video CRUD against the video domain's IndexedDB store
import { getVideoDB, STORE_VIDEOS } from "./init";
import type { PaginatedVideos, VideoQueryParams, VideoSummary } from "../../../data/types";

// local-only bookkeeping fields kept on the stored row but not part of
// the server-derived VideoSummary shape.
interface LocalVideoRow extends VideoSummary {
  file_name: string;
  file_size: number;
  mime_type: string;
}

export async function addLocalVideo(input: {
  id: string;
  title: string;
  opfs_path: string;
  poster_opfs_path?: string | null;
  file_name: string;
  file_size: number;
  mime_type: string;
  duration_seconds?: number | null;
}): Promise<VideoSummary> {
  const now = Date.now();
  const row: LocalVideoRow = {
    id: input.id,
    series_id: null,
    season_id: null,
    episode_number: null,
    title: input.title,
    description: null,
    // no server blob for a local/opfs-backed video; "" (not null) keeps
    // this field's type identical to QueuedVideo's required `string`.
    media_blob_id: "",
    poster_blob_id: null,
    duration_seconds: input.duration_seconds ?? null,
    release_date: null,
    created_at: now,
    updated_at: now,
    added_at: Math.floor(now / 1000),
    deleted_at: null,
    created_by: null,
    updated_by: null,
    deleted_by: null,
    source_type: "local",
    opfs_path: input.opfs_path,
    poster_opfs_path: input.poster_opfs_path ?? null,
    file_name: input.file_name,
    file_size: input.file_size,
    mime_type: input.mime_type,
  };

  const db = await getVideoDB();
  await db.put(STORE_VIDEOS, row);
  return row;
}

export async function deleteLocalVideo(id: string): Promise<void> {
  const db = await getVideoDB();
  await db.delete(STORE_VIDEOS, id);
}

export async function getLocalVideos(params?: VideoQueryParams): Promise<PaginatedVideos> {
  const limit = params?.limit ?? 50;
  const offset = params?.offset ?? 0;
  const sortBy = params?.sort_by ?? "added_at";
  const sortDirection = params?.sort_direction ?? "desc";

  const db = await getVideoDB();
  let items = (await db.getAll(STORE_VIDEOS)) as VideoSummary[];

  if (params?.search) {
    const searchLower = params.search.toLowerCase();
    items = items.filter((video) => video.title?.toLowerCase().includes(searchLower));
  }

  items.sort((a, b) => {
    let cmp = 0;
    switch (sortBy) {
      case "title":
        cmp = a.title.localeCompare(b.title);
        break;
      case "duration":
        cmp = (a.duration_seconds ?? 0) - (b.duration_seconds ?? 0);
        break;
      case "year":
        cmp = (a.release_date ?? "").localeCompare(b.release_date ?? "");
        break;
      case "added_at":
      default:
        cmp = a.added_at - b.added_at;
        break;
    }
    return sortDirection === "asc" ? cmp : -cmp;
  });

  const total_count = items.length;
  const paged = items.slice(offset, offset + limit);

  return {
    items: paged,
    total_count,
    has_more: offset + limit < total_count,
    offset,
  };
}

export async function getLocalVideoById(id: string): Promise<VideoSummary | null> {
  const db = await getVideoDB();
  const row = (await db.get(STORE_VIDEOS, id)) as VideoSummary | undefined;
  return row ?? null;
}
