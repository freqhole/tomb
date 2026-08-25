// local video data source — queries the video domain's own indexeddb
import {
  addLocalVideo as dbAddLocalVideo,
  deleteLocalVideo as dbDeleteLocalVideo,
  getLocalVideoById,
  getLocalVideos,
  updateLocalVideo,
} from "../../services/storage/db/videos";
import { getLocalVideoSeriesList } from "../../services/storage/db/series";
import {
  getOrCreateLocalVideoSeries,
  updateLocalVideoSeries,
  type LocalVideoSeriesRow,
} from "../../services/storage/db/series";
import { getLocalVideoSeasons } from "../../services/storage/db/seasons";
import { purgeVideoFromOPFS } from "../../services/opfs/helpers";
import { storeBlob } from "../../../music/services/storage/blobs";
import type { ImageMetadata } from "../../../music/services/storage/types";
import type {
  PaginatedVideoSeries,
  PaginatedVideos,
  VideoDataSource,
  VideoImageEntityType,
  VideoQueryParams,
  VideoSeason,
  VideoSeries,
  VideoSummary,
} from "../types";

/** first image marked primary, or the first image if none are — mirrors
 * the picking logic `pickBestImage()` (utils/images.ts) uses for display,
 * kept local here since we only need the blob id, not a resolved url. */
function primaryLocalBlobId(images: ImageMetadata[]): string | null {
  if (images.length === 0) return null;
  return (images.find((img) => img.is_primary) ?? images[0]).local_blob_id ?? null;
}

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

  async getVideoSeriesDetail(id: string) {
    const series = await this.getVideoSeriesById(id);
    if (!series) return null;
    const seasonRows = await getLocalVideoSeasons(id);
    const seriesVideos = await this.getVideosBySeries(id);
    const seasons = seasonRows.map((season) => ({
      ...season,
      videos: seriesVideos.filter((v) => v.season_id === season.id),
    }));
    const unassignedVideos = seriesVideos.filter((v) => !v.season_id);
    return { series, seasons, unassignedVideos };
  }

  async updateVideo(params: {
    video_id: string;
    title?: string;
    description?: string | null;
    episode_number?: number | null;
    release_date?: string | null;
    series_id?: string | null;
    season_id?: string | null;
  }): Promise<void> {
    const { video_id, ...updates } = params;
    await updateLocalVideo(video_id, updates);
  }

  async deleteVideo(videoId: string): Promise<void> {
    await purgeVideoFromOPFS(videoId);
  }

  async createVideoSeries(params: {
    title: string;
    description?: string | null;
  }): Promise<VideoSeries> {
    // mirrors music's `getOrCreateArtist` dedup-by-name pattern so a
    // repeated create (e.g. double-click, or the same title typed again
    // via the autocomplete's "create new" affordance) never spawns
    // duplicate local series rows.
    const series = await getOrCreateLocalVideoSeries(params.title);
    if (params.description && !series.description) {
      await updateLocalVideoSeries(series.id, { description: params.description });
      return { ...series, description: params.description };
    }
    return series;
  }

  async updateVideoSeries(params: {
    series_id: string;
    title?: string;
    description?: string | null;
    poster_blob_id?: string | null;
  }): Promise<void> {
    const { series_id, ...updates } = params;
    await updateLocalVideoSeries(series_id, updates);
  }

  // image operations — local storage using OPFS, mirroring
  // music/data/local/localSource.ts's album/artist/playlist handling.
  // unlike the remote data source (where the server keeps
  // videoz/video_seriez.poster_blob_id in sync with the primary image,
  // see grimoire/src/video/crud/entity_imagez.rs), there's no server
  // here to do that — so every mutation below also mirrors
  // poster_blob_id itself, keeping series/episode grid tiles (which
  // read poster_blob_id directly, not the images gallery) working.
  async uploadImage(params: {
    file?: File;
    filePath?: string;
    entityType: VideoImageEntityType;
    entityId: string;
    isPrimary?: boolean;
  }): Promise<{ blob_id: string; job_id: string }> {
    if (!params.file) {
      throw new Error("localVideoDataSource.uploadImage requires a file");
    }

    const blobId = await storeBlob(params.file, params.file.type);
    const imageMetadata: ImageMetadata = {
      local_blob_id: blobId,
      is_primary: params.isPrimary ?? false,
      blob_type: "thumbnail",
    };

    if (params.entityType === "video") {
      const video = await getLocalVideoById(params.entityId);
      const images: ImageMetadata[] = (video?.images as ImageMetadata[] | undefined) ?? [];
      if (params.isPrimary) images.forEach((img) => (img.is_primary = false));
      images.push(imageMetadata);
      await updateLocalVideo(params.entityId, {
        images,
        poster_blob_id: primaryLocalBlobId(images),
      });
    } else {
      const series = (await this.getVideoSeriesById(
        params.entityId
      )) as LocalVideoSeriesRow | null;
      const images: ImageMetadata[] = series?.images ?? [];
      if (params.isPrimary) images.forEach((img) => (img.is_primary = false));
      images.push(imageMetadata);
      await updateLocalVideoSeries(params.entityId, {
        images,
        poster_blob_id: primaryLocalBlobId(images),
      });
    }

    // local source doesn't have async jobs, return empty job_id
    return { blob_id: blobId, job_id: "" };
  }

  async getEntityImages(params: {
    entityType: VideoImageEntityType;
    entityId: string;
  }): Promise<ImageMetadata[]> {
    if (params.entityType === "video") {
      const video = await getLocalVideoById(params.entityId);
      return (video?.images as ImageMetadata[] | undefined) ?? [];
    }
    const series = (await this.getVideoSeriesById(params.entityId)) as LocalVideoSeriesRow | null;
    return series?.images ?? [];
  }

  async removeImage(params: {
    entityType: VideoImageEntityType;
    entityId: string;
    blobId: string;
  }): Promise<void> {
    if (params.entityType === "video") {
      const video = await getLocalVideoById(params.entityId);
      if (!video) return;
      const images: ImageMetadata[] = (video.images as ImageMetadata[] | undefined) ?? [];
      const remaining = images.filter((img) => img.local_blob_id !== params.blobId);
      if (remaining.length > 0 && !remaining.some((img) => img.is_primary)) {
        remaining[0].is_primary = true;
      }
      await updateLocalVideo(params.entityId, {
        images: remaining,
        poster_blob_id: primaryLocalBlobId(remaining),
      });
    } else {
      const series = (await this.getVideoSeriesById(
        params.entityId
      )) as LocalVideoSeriesRow | null;
      if (!series) return;
      const images: ImageMetadata[] = series.images ?? [];
      const remaining = images.filter((img) => img.local_blob_id !== params.blobId);
      if (remaining.length > 0 && !remaining.some((img) => img.is_primary)) {
        remaining[0].is_primary = true;
      }
      await updateLocalVideoSeries(params.entityId, {
        images: remaining,
        poster_blob_id: primaryLocalBlobId(remaining),
      });
    }
  }

  async setPrimaryImage(params: {
    entityType: VideoImageEntityType;
    entityId: string;
    blobId: string;
  }): Promise<void> {
    if (params.entityType === "video") {
      const video = await getLocalVideoById(params.entityId);
      if (!video) return;
      const images: ImageMetadata[] = ((video.images as ImageMetadata[] | undefined) ?? []).map(
        (img) => ({ ...img, is_primary: img.local_blob_id === params.blobId })
      );
      await updateLocalVideo(params.entityId, {
        images,
        poster_blob_id: primaryLocalBlobId(images),
      });
    } else {
      const series = (await this.getVideoSeriesById(
        params.entityId
      )) as LocalVideoSeriesRow | null;
      if (!series) return;
      const images: ImageMetadata[] = (series.images ?? []).map((img) => ({
        ...img,
        is_primary: img.local_blob_id === params.blobId,
      }));
      await updateLocalVideoSeries(params.entityId, {
        images,
        poster_blob_id: primaryLocalBlobId(images),
      });
    }
  }
}

export const localVideoDataSource = new LocalVideoDataSource();

// exposed for the OPFS import flow (mirrors music's local import
// writing directly to the local data source's underlying db helpers)
export const addLocalVideo = dbAddLocalVideo;
export const deleteLocalVideo = dbDeleteLocalVideo;
