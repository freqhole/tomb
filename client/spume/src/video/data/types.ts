// data source abstractions for the video domain
// mirrors music/data/types.ts's MusicDataSource shape, simplified

import type { Video, VideoSeries, VideoSeason } from "@freqhole/api-client";
import type { QueuedVideo } from "../../app/services/storage/mediaItem";

export type { Video, VideoSeries, VideoSeason };

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
  getVideoSeriesList(params?: {
    offset?: number;
    limit?: number;
    search?: string;
  }): Promise<PaginatedVideoSeries>;
  getVideoSeriesById(id: string): Promise<VideoSeries | null>;
  getVideoSeasons(seriesId: string): Promise<VideoSeason[]>;
  getVideosBySeason(seasonId: string): Promise<VideoSummary[]>;
  getVideosBySeries(seriesId: string): Promise<VideoSummary[]>;
}
