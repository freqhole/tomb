// local video CRUD against the video domain's IndexedDB store
import { getVideoDB, STORE_VIDEOS, STORE_VIDEO_SERIES, STORE_VIDEO_SEASONS } from "./init";
import { getEntityTags } from "./entityTags";
import type { PaginatedVideos, VideoQueryParams, VideoSummary } from "../../../data/types";
import type { ImageMetadata } from "../../../../music/services/storage/types";
import { debug } from "../../../../utils/logger";

// local-only bookkeeping fields kept on the stored row but not part of
// the server-derived VideoSummary shape. `images` is overridden from
// VideoSummary's inherited raw codegen shape (`{blob_id, is_primary:
// number, blob_type}`, meant for server responses) to the richer
// `ImageMetadata` shape (`local_blob_id`/`remote_blob_id`/`is_primary:
// boolean`/...) that the entity_imagez-backed gallery UI (EditVideoModal
// et al, via VideoDataSource.getEntityImages) actually reads/writes —
// mirrors how music's local Album/Artist/Playlist row types declare
// `images?: ImageMetadata[]` directly.
export interface LocalVideoRow extends Omit<VideoSummary, "images"> {
  file_name: string;
  file_size: number;
  mime_type: string;
  images?: ImageMetadata[];
  /** blake3 content hash (64 hex chars) for iroh-blobs verified
   * streaming/serving - mirrors Song.blake3. only set for videos synced
   * in from a remote (already hashed there) or freshly-uploaded local
   * videos (hashed at import time, see video/import/localImport.ts);
   * older local videos predating this field are null. */
  blake3?: string | null;
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
  /** blake3 hash - required for the video to be reachable via a peer's
   * blake3-keyed queries (cenotaph tier-2), see LocalVideoRow's field
   * comment for who's expected to supply this. */
  blake3?: string | null;
  /** local series/season rows, when syncing an episode in from a remote.
   * these are *local* ids - the caller resolves the source's series/season
   * to local rows first (grimoire matches on title + number, not source id). */
  series_id?: string | null;
  season_id?: string | null;
  episode_number?: number | null;
  content_type?: LocalVideoRow["content_type"];
  description?: string | null;
  /** artwork downloaded into local blobs during sync. */
  images?: ImageMetadata[];
  /** local blob id of the primary image - grid tiles read this directly
   * rather than the images gallery. */
  poster_blob_id?: string | null;
}): Promise<LocalVideoRow> {
  const now = Date.now();
  const row: LocalVideoRow = {
    id: input.id,
    series_id: input.series_id ?? null,
    season_id: input.season_id ?? null,
    episode_number: input.episode_number ?? null,
    content_type: input.content_type ?? "clip",
    title: input.title,
    description: input.description ?? null,
    // no server blob for a local/opfs-backed video; "" (not null) keeps
    // this field's type identical to QueuedVideo's required `string`.
    media_blob_id: "",
    poster_blob_id: input.poster_blob_id ?? null,
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
    blake3: input.blake3 ?? null,
    images: input.images?.length ? input.images : undefined,
  };

  const db = await getVideoDB();
  await db.put(STORE_VIDEOS, row);
  return row;
}

export async function deleteLocalVideo(id: string): Promise<void> {
  const db = await getVideoDB();
  await db.delete(STORE_VIDEOS, id);
}

/** look up a local video by its blake3 hash - mirrors
 * music/services/storage/db/songs.ts's getSongByBlake3(), used the same
 * way: deciding whether a remote/peer queue entry (blake3_hash) already
 * exists in this device's own local library. */
export async function getVideoByBlake3(blake3: string): Promise<LocalVideoRow | undefined> {
  const db = await getVideoDB();
  const index = db.transaction(STORE_VIDEOS).store.index("by_blake3");
  const video = (await index.get(blake3)) as LocalVideoRow | undefined;
  debug(
    "getVideoByBlake3",
    `${blake3.slice(0, 8)}...: ${video ? `found video id ${video.id}` : "not found"}`
  );
  return video;
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

  // content_type filter: keep only videos whose content_type is one of
  // the selected values ("series"/"movie"/"clip").
  if (params?.content_types && params.content_types.length > 0) {
    const allowedTypes = new Set(params.content_types);
    items = items.filter((video) => allowedTypes.has(video.content_type));
  }

  // videos always cluster by series first (mirrors the server's
  // query_videos rule: a whole series stays one contiguous block), then
  // season/episode number is the fixed tie-breaker within that series -
  // computed from the already-loaded `items` rather than re-querying, so
  // no extra DB round trips per video are needed.
  const seriesIds = [...new Set(items.map((v) => v.series_id).filter((id): id is string => !!id))];
  const seriesTitleById = new Map(
    (await Promise.all(seriesIds.map((id) => db.get(STORE_VIDEO_SERIES, id))))
      .filter((s): s is NonNullable<typeof s> => !!s)
      .map((s) => [s.id as string, s.title as string])
  );

  const seasonIds = [...new Set(items.map((v) => v.season_id).filter((id): id is string => !!id))];
  const seasonNumberById = new Map(
    (await Promise.all(seasonIds.map((id) => db.get(STORE_VIDEO_SEASONS, id))))
      .filter((s): s is NonNullable<typeof s> => !!s)
      .map((s) => [s.id as string, s.season_number as number])
  );

  const seriesGroupKey = new Map<string, number | string>();
  for (const seriesId of seriesIds) {
    const episodes = items.filter((v) => v.series_id === seriesId);
    switch (sortBy) {
      case "release_date":
        seriesGroupKey.set(
          seriesId,
          episodes.reduce<string>((min, v) => {
            const d = v.release_date ?? "";
            return min === "" || (d && d < min) ? d : min;
          }, "")
        );
        break;
      case "duration":
        seriesGroupKey.set(
          seriesId,
          episodes.reduce((sum, v) => sum + (v.duration_seconds ?? 0), 0)
        );
        break;
      case "added_at":
        seriesGroupKey.set(seriesId, Math.max(...episodes.map((v) => v.added_at)));
        break;
      case "title":
        // genuinely video-title-based (not series metadata): the
        // alphabetically-earliest episode title within the series.
        seriesGroupKey.set(
          seriesId,
          episodes.reduce<string>((min, v) => (min === "" || v.title < min ? v.title : min), "")
        );
        break;
      // "series" and anything else fall back to clustering alphabetically
      // by the series' own title metadata.
      default:
        seriesGroupKey.set(seriesId, seriesTitleById.get(seriesId) ?? "");
        break;
    }
  }

  const primaryKeyFor = (v: VideoSummary): string | number => {
    if (v.series_id && seriesGroupKey.has(v.series_id)) {
      return seriesGroupKey.get(v.series_id)!;
    }
    switch (sortBy) {
      case "release_date":
        return v.release_date ?? "";
      case "duration":
        return v.duration_seconds ?? 0;
      case "added_at":
        return v.added_at;
      default:
        return v.title;
    }
  };

  items.sort((a, b) => {
    const aKey = primaryKeyFor(a);
    const bKey = primaryKeyFor(b);
    let cmp =
      typeof aKey === "number" && typeof bKey === "number"
        ? aKey - bKey
        : String(aKey).localeCompare(String(bKey));
    if (sortDirection !== "asc") cmp = -cmp;
    if (cmp !== 0) return cmp;

    // fixed tie-breaker within a series: season number then episode number
    const aSeason = a.season_id ? (seasonNumberById.get(a.season_id) ?? 0) : 0;
    const bSeason = b.season_id ? (seasonNumberById.get(b.season_id) ?? 0) : 0;
    if (aSeason !== bSeason) return aSeason - bSeason;
    return (a.episode_number ?? 0) - (b.episode_number ?? 0);
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
    content_type?: string;
    images?: ImageMetadata[];
  }
): Promise<void> {
  const db = await getVideoDB();
  const row = (await db.get(STORE_VIDEOS, id)) as LocalVideoRow | undefined;
  if (!row) return;
  const updated: LocalVideoRow = { ...row, ...updates, updated_at: Date.now() };
  await db.put(STORE_VIDEOS, updated);
}
