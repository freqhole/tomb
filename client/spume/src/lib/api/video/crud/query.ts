// mirrors grimoire/src/video/crud/query.rs's query_videos() - browser-side
// implementation backed by spume's own IDB `LocalVideoRow` store instead
// of grimoire's sqlite views. same deliberately-scoped-down v1 shape as
// music/crud/query.ts's querySongs(): only `filters.blake3` is supported
// (the one lookup cenotaph's tier-2 sync-to-local actually needs) - see
// docs/cenotaph-migration-plan.md phase 3, tier 2.

import type { QueryVideosRequest, VideosQueryResult } from "@freqhole/api-client";
import { getVideoByBlake3, type LocalVideoRow } from "../../../../video/services/storage/db/videos";
import { readVideoFromOPFS } from "../../../../video/services/opfs/helpers";
import { ensureBlobServable } from "../../blobServing";
import { stageAndMapImages } from "../../images";

/** maps a local video row into grimoire's flat `Video` wire shape, staging
 * its own bytes for iroh-blobs serving along the way (video's
 * `media_blob_id` is its blake3, the same content-addressable identity
 * songs use - see LocalVideoRow.blake3's field comment for who supplies
 * it). */
async function videoToQueryResult(
  video: LocalVideoRow
): Promise<VideosQueryResult["items"][number]> {
  if (video.blake3 && video.opfs_path) {
    const opfsPath = video.opfs_path;
    await ensureBlobServable(video.blake3, () => readVideoFromOPFS(opfsPath));
  }

  return {
    id: video.id,
    series_id: video.series_id,
    season_id: video.season_id,
    episode_number: video.episode_number,
    content_type: video.content_type,
    title: video.title,
    description: video.description,
    media_blob_id: video.blake3 ?? "",
    poster_blob_id: null,
    duration_seconds: video.duration_seconds,
    release_date: video.release_date,
    created_at: video.created_at,
    updated_at: video.updated_at,
    deleted_at: video.deleted_at,
    created_by: video.created_by,
    updated_by: video.updated_by,
    deleted_by: video.deleted_by,
    images: await stageAndMapImages(video.images),
  };
}

/**
 * query videos.
 *
 * grimoire's real query supports search/sort/pagination and series/season/
 * unassigned scoping (see `query_videos()`'s full signature) - this
 * browser implementation only supports `params.filters.blake3` (a single
 * video's blake3 hash), same scoping rationale as music/crud/query.ts.
 */
export async function queryVideos(
  request: Partial<QueryVideosRequest>
): Promise<VideosQueryResult> {
  const limit = request.params?.limit ?? 50;
  const offset = request.params?.offset ?? 0;
  const emptyResult: VideosQueryResult = {
    items: [],
    total_count: 0,
    has_more: false,
    limit,
    offset,
  };

  const blake3 = request.params?.filters?.blake3;
  if (typeof blake3 !== "string" || blake3.length === 0) {
    return emptyResult;
  }

  const video = await getVideoByBlake3(blake3);
  if (!video) return emptyResult;

  return {
    items: [await videoToQueryResult(video)],
    total_count: 1,
    has_more: false,
    limit,
    offset,
  };
}
