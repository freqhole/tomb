// local video CRUD against the video domain's IndexedDB store
import { getVideoDB, STORE_VIDEOS } from "./init";
import { getEntityTags } from "./entityTags";
import type { PaginatedVideos, VideoQueryParams, VideoSummary } from "../../../data/types";
import type { ImageMetadata } from "../../../../music/services/storage/types";

// local-only bookkeeping fields kept on the stored row but not part of
// the server-derived VideoSummary shape. `images` is overridden from
// VideoSummary's inherited raw codegen shape (`{blob_id, is_primary:
// number, blob_type}`, meant for server responses) to the richer
// `ImageMetadata` shape (`local_blob_id`/`remote_blob_id`/`is_primary:
// boolean`/...) that the entity_imagez-backed gallery UI (EditVideoModal
// et al, via VideoDataSource.getEntityImages) actually reads/writes —
// mirrors how music's local Album/Artist/Playlist row types declare
// `images?: ImageMetadata[]` directly.
interface LocalVideoRow extends Omit<VideoSummary, "images"> {
  file_name: string;
  file_size: number;
  mime_type: string;
  images?: ImageMetadata[];
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
}): Promise<LocalVideoRow> {
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

  // tag filters — mirrors music's local getAlbums tag filtering:
  // include_tags = keep videos with ANY of these tags, exclude_tags =
  // drop videos with ANY of these tags. no bulk "tags for many videos"
  // helper exists locally, so this fetches one entity_tags row-set per
  // loaded video in parallel.
  const includeTags = params?.include_tags ?? [];
  const excludeTags = params?.exclude_tags ?? [];
  if (includeTags.length > 0 || excludeTags.length > 0) {
    const includeSet = new Set(includeTags);
    const excludeSet = new Set(excludeTags);
    const withTags = await Promise.all(
      items.map(async (video) => ({
        video,
        names: (await getEntityTags("video", video.id)).map((t) => t.name),
      }))
    );
    items = withTags
      .filter(({ names }) => {
        if (includeSet.size > 0 && !names.some((n) => includeSet.has(n))) return false;
        if (excludeSet.size > 0 && names.some((n) => excludeSet.has(n))) return false;
        return true;
      })
      .map(({ video }) => video);
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

export async function updateLocalVideo(
  id: string,
  updates: {
    title?: string;
    description?: string | null;
    episode_number?: number | null;
    release_date?: string | null;
    series_id?: string | null;
    season_id?: string | null;
    poster_blob_id?: string | null;
    images?: ImageMetadata[];
  }
): Promise<void> {
  const db = await getVideoDB();
  const row = (await db.get(STORE_VIDEOS, id)) as LocalVideoRow | undefined;
  if (!row) return;
  const updated: LocalVideoRow = { ...row, ...updates, updated_at: Date.now() };
  await db.put(STORE_VIDEOS, updated);
}
