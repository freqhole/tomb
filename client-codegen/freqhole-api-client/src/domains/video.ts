// video domain methods for FreqholeClient

import { routes } from "../codegen/routes.js";
import type * as s from "../codegen/schema.js";
import {
  UpdateVideoSeasonRequestSchema,
  UpdateVideoSeriesRequestSchema,
  UpdateVideosRequestSchema,
} from "../codegen/schema.js";
import type { CallFn } from "./types.js";

// partial schemas for update operations
const UpdateVideosRequestPartialSchema = UpdateVideosRequestSchema.partial().required({
  video_ids: true,
});
const UpdateVideoSeriesRequestPartialSchema = UpdateVideoSeriesRequestSchema.partial().required({
  series_id: true,
});
const UpdateVideoSeasonRequestPartialSchema = UpdateVideoSeasonRequestSchema.partial().required({
  season_id: true,
});

export function createVideoMethods(call: CallFn) {
  return {
    // videos
    queryVideos: (params: s.QueryVideosRequest) => {
      return call(
        "video",
        "query_videos",
        routes.video.query_videos.resp,
        routes.video.query_videos.req,
        routes.video.query_videos.method,
        routes.video.query_videos.path,
        params,
      );
    },

    createVideo: (params: s.CreateVideoRequest) => {
      return call(
        "video",
        "create_video",
        routes.video.create_video.resp,
        routes.video.create_video.req,
        routes.video.create_video.method,
        routes.video.create_video.path,
        params,
      );
    },

    getVideo: (params: s.GetVideoRequest) => {
      return call(
        "video",
        "get_video",
        routes.video.get_video.resp,
        routes.video.get_video.req,
        routes.video.get_video.method,
        routes.video.get_video.path,
        params,
      );
    },

    getVideoWithMetadata: (params: s.GetVideoRequest) => {
      return call(
        "video",
        "get_video_with_metadata",
        routes.video.get_video_with_metadata.resp,
        routes.video.get_video_with_metadata.req,
        routes.video.get_video_with_metadata.method,
        routes.video.get_video_with_metadata.path,
        params,
      );
    },

    listVideosBySeries: (params: s.ListVideosBySeriesRequest) => {
      return call(
        "video",
        "list_videos_by_series",
        routes.video.list_videos_by_series.resp,
        routes.video.list_videos_by_series.req,
        routes.video.list_videos_by_series.method,
        routes.video.list_videos_by_series.path,
        params,
      );
    },

    listVideosBySeason: (params: s.ListVideosBySeasonRequest) => {
      return call(
        "video",
        "list_videos_by_season",
        routes.video.list_videos_by_season.resp,
        routes.video.list_videos_by_season.req,
        routes.video.list_videos_by_season.method,
        routes.video.list_videos_by_season.path,
        params,
      );
    },

    listVideosUnattached: (params: s.ListVideosUnattachedRequest) => {
      return call(
        "video",
        "list_videos_unattached",
        routes.video.list_videos_unattached.resp,
        routes.video.list_videos_unattached.req,
        routes.video.list_videos_unattached.method,
        routes.video.list_videos_unattached.path,
        params,
      );
    },

    updateVideos: (params: Partial<s.UpdateVideosRequest> & { video_ids: string[] }) => {
      return call(
        "video",
        "update_videos",
        routes.video.update_videos.resp,
        UpdateVideosRequestPartialSchema,
        routes.video.update_videos.method,
        routes.video.update_videos.path,
        params,
      );
    },

    deleteVideo: (params: s.DeleteVideoRequest) => {
      return call(
        "video",
        "delete_video",
        routes.video.delete_video.resp,
        routes.video.delete_video.req,
        routes.video.delete_video.method,
        routes.video.delete_video.path,
        params,
      );
    },

    bulkDeleteVideos: (params: s.BulkDeleteVideosRequest) => {
      return call(
        "video",
        "bulk_delete_videos",
        routes.video.bulk_delete_videos.resp,
        routes.video.bulk_delete_videos.req,
        routes.video.bulk_delete_videos.method,
        routes.video.bulk_delete_videos.path,
        params,
      );
    },

    getVideoRenditions: (params: s.GetVideoRenditionsRequest) => {
      return call(
        "video",
        "get_video_renditions",
        routes.video.get_video_renditions.resp,
        routes.video.get_video_renditions.req,
        routes.video.get_video_renditions.method,
        routes.video.get_video_renditions.path,
        params,
      );
    },

    deleteVideoRendition: (params: s.DeleteVideoRenditionRequest) => {
      return call(
        "video",
        "delete_video_rendition",
        routes.video.delete_video_rendition.resp,
        routes.video.delete_video_rendition.req,
        routes.video.delete_video_rendition.method,
        routes.video.delete_video_rendition.path,
        params,
      );
    },

    // playback progress
    upsertPlaybackProgress: (params: s.UpsertPlaybackProgressRequest) => {
      return call(
        "video",
        "upsert_playback_progress",
        routes.video.upsert_playback_progress.resp,
        routes.video.upsert_playback_progress.req,
        routes.video.upsert_playback_progress.method,
        routes.video.upsert_playback_progress.path,
        params,
      );
    },

    getPlaybackProgress: (params: s.GetPlaybackProgressRequest) => {
      return call(
        "video",
        "get_playback_progress",
        routes.video.get_playback_progress.resp,
        routes.video.get_playback_progress.req,
        routes.video.get_playback_progress.method,
        routes.video.get_playback_progress.path,
        params,
      );
    },

    listPlaybackProgress: (params: s.ListPlaybackProgressRequest) => {
      return call(
        "video",
        "list_playback_progress",
        routes.video.list_playback_progress.resp,
        routes.video.list_playback_progress.req,
        routes.video.list_playback_progress.method,
        routes.video.list_playback_progress.path,
        params,
      );
    },

    // video series
    queryVideoSeries: (params: s.QueryParams) => {
      return call(
        "video",
        "query_video_series",
        routes.video.query_video_series.resp,
        routes.video.query_video_series.req,
        routes.video.query_video_series.method,
        routes.video.query_video_series.path,
        params,
      );
    },

    createVideoSeries: (params: s.CreateVideoSeriesRequest) => {
      return call(
        "video",
        "create_video_series",
        routes.video.create_video_series.resp,
        routes.video.create_video_series.req,
        routes.video.create_video_series.method,
        routes.video.create_video_series.path,
        params,
      );
    },

    listVideoSeries: (params: s.ListVideoSeriesRequest) => {
      return call(
        "video",
        "list_video_series",
        routes.video.list_video_series.resp,
        routes.video.list_video_series.req,
        routes.video.list_video_series.method,
        routes.video.list_video_series.path,
        params,
      );
    },

    getVideoSeries: (params: s.GetVideoSeriesRequest) => {
      return call(
        "video",
        "get_video_series",
        routes.video.get_video_series.resp,
        routes.video.get_video_series.req,
        routes.video.get_video_series.method,
        routes.video.get_video_series.path,
        params,
      );
    },

    getVideoSeriesDetail: (params: s.GetVideoSeriesRequest) => {
      return call(
        "video",
        "get_video_series_detail",
        routes.video.get_video_series_detail.resp,
        routes.video.get_video_series_detail.req,
        routes.video.get_video_series_detail.method,
        routes.video.get_video_series_detail.path,
        params,
      );
    },

    updateVideoSeries: (params: Partial<s.UpdateVideoSeriesRequest> & { series_id: string }) => {
      return call(
        "video",
        "update_video_series",
        routes.video.update_video_series.resp,
        UpdateVideoSeriesRequestPartialSchema,
        routes.video.update_video_series.method,
        routes.video.update_video_series.path,
        params,
      );
    },

    deleteVideoSeries: (params: s.DeleteVideoSeriesRequest) => {
      return call(
        "video",
        "delete_video_series",
        routes.video.delete_video_series.resp,
        routes.video.delete_video_series.req,
        routes.video.delete_video_series.method,
        routes.video.delete_video_series.path,
        params,
      );
    },

    // video seasons
    createVideoSeason: (params: s.CreateVideoSeasonRequest) => {
      return call(
        "video",
        "create_video_season",
        routes.video.create_video_season.resp,
        routes.video.create_video_season.req,
        routes.video.create_video_season.method,
        routes.video.create_video_season.path,
        params,
      );
    },

    listVideoSeasons: (params: s.ListVideoSeasonsRequest) => {
      return call(
        "video",
        "list_video_seasons",
        routes.video.list_video_seasons.resp,
        routes.video.list_video_seasons.req,
        routes.video.list_video_seasons.method,
        routes.video.list_video_seasons.path,
        params,
      );
    },

    getVideoSeason: (params: s.GetVideoSeasonRequest) => {
      return call(
        "video",
        "get_video_season",
        routes.video.get_video_season.resp,
        routes.video.get_video_season.req,
        routes.video.get_video_season.method,
        routes.video.get_video_season.path,
        params,
      );
    },

    updateVideoSeason: (params: Partial<s.UpdateVideoSeasonRequest> & { season_id: string }) => {
      return call(
        "video",
        "update_video_season",
        routes.video.update_video_season.resp,
        UpdateVideoSeasonRequestPartialSchema,
        routes.video.update_video_season.method,
        routes.video.update_video_season.path,
        params,
      );
    },

    deleteVideoSeason: (params: s.DeleteVideoSeasonRequest) => {
      return call(
        "video",
        "delete_video_season",
        routes.video.delete_video_season.resp,
        routes.video.delete_video_season.req,
        routes.video.delete_video_season.method,
        routes.video.delete_video_season.path,
        params,
      );
    },
  };
}

export type VideoMethods = ReturnType<typeof createVideoMethods>;
