// local video data source — queries the video domain's own indexeddb
import {
  addLocalVideo as dbAddLocalVideo,
  deleteLocalVideo as dbDeleteLocalVideo,
  getLocalVideoById,
  getLocalVideos,
  updateLocalVideo,
} from "../../services/storage/db/videos";
import { getLocalVideoSeriesList } from "../../services/storage/db/series";
import { getLocalVideoSeasons } from "../../services/storage/db/seasons";
import type {
  PaginatedVideoSeries,
  PaginatedVideos,
  VideoDataSource,
  VideoQueryParams,
  VideoSeason,
  VideoSeries,
  VideoSummary,
} from "../types";

export class LocalVideoDataSource implements VideoDataSource {
  async getVideos(params?: VideoQueryParams): Promise<PaginatedVideos> {
    return getLocalVideos(params);
  }

  async getVideoById(id: string): Promise<VideoSummary | null> {
    return getLocalVideoById(id);
  }

  async getVideoSeriesList(params?: {
    offset?: number;
    limit?: number;
    search?: string;
  }): Promise<PaginatedVideoSeries> {
    return getLocalVideoSeriesList(params);
  }

  async getVideoSeriesById(id: string): Promise<VideoSeries | null> {
    const result = await getLocalVideoSeriesList({});
    return result.items.find((series) => series.id === id) ?? null;
  }

  async getVideoSeasons(seriesId: string): Promise<VideoSeason[]> {
    return getLocalVideoSeasons(seriesId);
  }

  async getVideosBySeason(seasonId: string): Promise<VideoSummary[]> {
    const result = await getLocalVideos({ limit: 1000 });
    return result.items.filter((video) => video.season_id === seasonId);
  }

  async getVideosBySeries(seriesId: string): Promise<VideoSummary[]> {
    const result = await getLocalVideos({ limit: 1000 });
    return result.items.filter((video) => video.series_id === seriesId);
  }

  async updateVideo(params: {
    video_id: string;
    title?: string;
    description?: string | null;
    episode_number?: number | null;
    release_date?: string | null;
  }): Promise<void> {
    const { video_id, ...updates } = params;
    await updateLocalVideo(video_id, updates);
  }
}

export const localVideoDataSource = new LocalVideoDataSource();

// exposed for the OPFS import flow (mirrors music's local import
// writing directly to the local data source's underlying db helpers)
export const addLocalVideo = dbAddLocalVideo;
export const deleteLocalVideo = dbDeleteLocalVideo;
