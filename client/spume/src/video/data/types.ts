// data source abstractions for the video domain
// mirrors music/data/types.ts's MusicDataSource shape, simplified

import type {
  Video,
  VideoSeries,
  VideoSeason,
  VideoWithMetadata,
} from "@freqhole/api-client";
import type { QueuedVideo } from "../../app/services/storage/mediaItem";
import type { ImageMetadata } from "../../music/services/storage/types";

// entity types the generic entity_imagez-backed image routes accept for
// the video domain (mirrors grimoire's video::crud::entity_imagez::VideoEntityType)
export type VideoImageEntityType = "video" | "video_series";

export type { Video, VideoSeries, VideoSeason, VideoWithMetadata };

/** a browsable video row — local or remote, with the same local-storage
 * bookkeeping fields a queued video carries (minus queue-only fields).
 * adds `added_at` (unix seconds — mirrors `Song.added_at`'s "when this
 * entered the local library" convention, used for sorting/display);
 * local videos have no server blob so `media_blob_id` is `""` rather
 * than absent, keeping the field's type identical to `QueuedVideo`'s
 * (required `string`, per the generated `Video` schema) so a
 * `VideoSummary` can be spread directly into a `QueuedVideo`. */
export type VideoSummary = Omit<QueuedVideo, "queue_entry_id"> & {
  added_at: number;
};

export interface PaginatedVideos {
  items: VideoSummary[];
  total_count: number;
  has_more: boolean;
  offset: number;
}

export interface PaginatedVideoSeries {
  items: VideoSeries[];
  total_count: number;
  has_more: boolean;
  offset: number;
}

export interface VideoQueryParams {
  offset?: number;
  limit?: number;
  search?: string;
  sort_by?: "added_at" | "title" | "year" | "duration";
  sort_direction?: "asc" | "desc";
  series_id?: string;
  season_id?: string;
  unassigned?: boolean;
}

export interface VideoDataSource {
  getVideos(params?: VideoQueryParams): Promise<PaginatedVideos>;
  getVideoById(id: string): Promise<VideoSummary | null>;
  getVideoWithMetadata?(id: string): Promise<VideoWithMetadata | null>;
  getVideoSeriesList(params?: {
    offset?: number;
    limit?: number;
    search?: string;
  }): Promise<PaginatedVideoSeries>;
  getVideoSeriesById(id: string): Promise<VideoSeries | null>;
  getVideoSeasons(seriesId: string): Promise<VideoSeason[]>;
  getVideosBySeason(seasonId: string): Promise<VideoSummary[]>;
  getVideosBySeries(seriesId: string): Promise<VideoSummary[]>;
  /** full series detail in one call: the series, every season (each with
   * its videos), and any videos attached directly to the series with no
   * season (mirrors grimoire's `get_series_detail` — this is the piece
   * `useVideoSeriesDetailQuery` was missing, which silently dropped any
   * season-less video from the series detail view). */
  getVideoSeriesDetail(id: string): Promise<{
    series: VideoSeries;
    seasons: (VideoSeason & { videos: VideoSummary[] })[];
    unassignedVideos: VideoSummary[];
  } | null>;

  // mutations (optional - not all sources support all mutations)
  updateVideo?(params: {
    video_id: string;
    title?: string;
    description?: string | null;
    episode_number?: number | null;
    release_date?: string | null;
    series_id?: string | null;
    season_id?: string | null;
  }): Promise<void>;
  deleteVideo?(videoId: string): Promise<void>;
  // series has no local writer yet (see services/storage/db/series.ts) —
  // only implemented by RemoteVideoDataSource.
  createVideoSeries?(params: {
    title: string;
    description?: string | null;
  }): Promise<VideoSeries>;
  updateVideoSeries?(params: {
    series_id: string;
    title?: string;
    description?: string | null;
    poster_blob_id?: string | null;
  }): Promise<void>;
  deleteVideoSeries?(seriesId: string): Promise<void>;
  // seasons have no local writer yet either (mirrors createVideoSeries
  // above) — only implemented by RemoteVideoDataSource.
  createVideoSeason?(params: {
    series_id: string;
    season_number: number;
    title?: string | null;
    description?: string | null;
  }): Promise<VideoSeason>;

  // image operations — generic entity_imagez routes (mirrors
  // music/data/types.ts's MusicDataSource image methods)
  uploadImage?(params: {
    file?: File;
    filePath?: string;
    entityType: VideoImageEntityType;
    entityId: string;
    isPrimary?: boolean;
  }): Promise<{ blob_id: string; job_id: string }>;

  getEntityImages?(params: {
    entityType: VideoImageEntityType;
    entityId: string;
  }): Promise<ImageMetadata[]>;

  removeImage?(params: {
    entityType: VideoImageEntityType;
    entityId: string;
    blobId: string;
  }): Promise<void>;

  setPrimaryImage?(params: {
    entityType: VideoImageEntityType;
    entityId: string;
    blobId: string;
  }): Promise<void>;
}
