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
  deleteLocalVideoSeries as dbDeleteLocalVideoSeries,
  getOrCreateLocalVideoSeries,
  updateLocalVideoSeries,
  type LocalVideoSeriesRow,
} from "../../services/storage/db/series";
import {
  deleteLocalVideoSeason,
  getAllLocalVideoSeasons,
  getLocalVideoSeasons,
  getOrCreateLocalVideoSeason,
  updateLocalVideoSeason,
} from "../../services/storage/db/seasons";
import { purgeVideoFromOPFS } from "../../services/opfs/helpers";
import { getAllTags as getAllLocalVideoTags } from "../../services/storage/db/tags";
import {
  addEntitiesTags as addLocalEntitiesTags,
  getEntitiesTagCounts as getLocalEntitiesTagCounts,
  removeEntitiesTags as removeLocalEntitiesTags,
} from "../../services/storage/db/entityTags";
import { storeBlob } from "../../../music/services/storage/blobs";
import type { ImageMetadata } from "../../../music/services/storage/types";
import { pickBestImage } from "../../../utils/images";
import type {
  PaginatedVideoSeries,
  PaginatedVideos,
  VideoDataSource,
  VideoImageEntityType,
  VideoQueryParams,
  VideoSeason,
  VideoSeries,
  VideoSummary,
  VideoWithMetadata,
} from "../types";

/** primary/best image's local blob id, excluding waveforms (mirrors
 * `pickBestImage()`'s ranking - a naive images[0] fallback could pick a
 * non-primary waveform entry when poster extraction failed). */
function primaryLocalBlobId(images: ImageMetadata[]): string | null {
  return pickBestImage(images)?.local_blob_id ?? null;
}

export class LocalVideoDataSource implements VideoDataSource {
  async getVideos(params?: VideoQueryParams): Promise<PaginatedVideos> {
    return getLocalVideos(params);
  }

  async getVideoById(id: string): Promise<VideoSummary | null> {
    return getLocalVideoById(id);
  }

  // local rows have no server-extracted file metadata (codec/container/
  // bitrate/frame_rate/blob dimensions) and no remote-account username to
  // resolve, so this only synthesizes the created/updated + description
  // fields the edit modal's metadata section can meaningfully show for a
  // local/opfs-backed video - just enough to make that section render at
  // all instead of staying permanently empty (`getVideoWithMetadata` was
  // previously unimplemented here). local rows store created_at/updated_at
  // in milliseconds (`Date.now()`); the server convention (and the edit
  // modal's `* 1000` display code) is unix seconds, so these are converted.
  async getVideoWithMetadata(id: string): Promise<VideoWithMetadata | null> {
    const video = await getLocalVideoById(id);
    if (!video) return null;
    return {
      video: {
        id: video.id,
        series_id: video.series_id,
        season_id: video.season_id,
        episode_number: video.episode_number,
        content_type: video.content_type,
        title: video.title,
        description: video.description,
        media_blob_id: video.media_blob_id,
        poster_blob_id: video.poster_blob_id,
        duration_seconds: video.duration_seconds,
        release_date: video.release_date,
        created_at: Math.floor(video.created_at / 1000),
        updated_at: Math.floor(video.updated_at / 1000),
        deleted_at: video.deleted_at ? Math.floor(video.deleted_at / 1000) : null,
        created_by: video.created_by,
        updated_by: video.updated_by,
        deleted_by: video.deleted_by,
      },
      created_by_username: null,
      updated_by_username: null,
      blob_size: null,
      blob_width: null,
      blob_height: null,
      codec: null,
      container: null,
      bitrate: null,
      frame_rate: null,
    };
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

  async getAllVideoSeasons(): Promise<VideoSeason[]> {
    return getAllLocalVideoSeasons();
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
    content_type?: string;
    clear_series_id?: boolean;
    clear_season_id?: boolean;
  }): Promise<void> {
    const { video_id, clear_series_id, clear_season_id, ...updates } = params;
    // the local (indexeddb) store always applies fields as given (no
    // COALESCE ambiguity), so an explicit clear is just passing null -
    // the flags only matter for the remote/SQL data source.
    await updateLocalVideo(video_id, {
      ...updates,
      series_id: clear_series_id ? null : updates.series_id,
      season_id: clear_series_id || clear_season_id ? null : updates.season_id,
    });
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

  // cascades the same way grimoire's `delete_video_series` does
  // server-side: every video and season under the series goes with it.
  async deleteVideoSeries(seriesId: string): Promise<void> {
    const seriesVideos = await this.getVideosBySeries(seriesId);
    for (const video of seriesVideos) {
      await this.deleteVideo(video.id);
    }
    const seasons = await getLocalVideoSeasons(seriesId);
    for (const season of seasons) {
      await deleteLocalVideoSeason(season.id);
    }
    await dbDeleteLocalVideoSeries(seriesId);
  }

  async createVideoSeason(params: {
    series_id: string;
    season_number: number;
    title?: string | null;
    description?: string | null;
  }): Promise<VideoSeason> {
    return getOrCreateLocalVideoSeason(params);
  }

  async updateVideoSeason(params: {
    season_id: string;
    season_number?: number;
    title?: string | null;
    description?: string | null;
    poster_blob_id?: string | null;
  }): Promise<void> {
    const { season_id, ...updates } = params;
    await updateLocalVideoSeason(season_id, updates);
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

  // tag operations - local storage using the video domain's own
  // entity_tags/tags indexeddb stores (mirrors music's local
  // getAlbumTags/addTagsToAlbum find-or-create pattern).
  async getTags(): Promise<{ tag_id: string; name: string; created_at: number }[]> {
    return getAllLocalVideoTags();
  }

  async getEntitiesTags(params: {
    entityType: VideoImageEntityType;
    entityIds: string[];
  }): Promise<{ tag_id: string; tag_name: string; tag_created_at: number; count: number }[]> {
    return getLocalEntitiesTagCounts(params.entityType, params.entityIds);
  }

  async addEntitiesTags(params: {
    entityType: VideoImageEntityType;
    entityIds: string[];
    tagNames: string[];
  }): Promise<void> {
    await addLocalEntitiesTags(params.entityType, params.entityIds, params.tagNames);
  }

  async removeEntitiesTags(params: {
    entityType: VideoImageEntityType;
    entityIds: string[];
    tagIds: string[];
  }): Promise<void> {
    await removeLocalEntitiesTags(params.entityType, params.entityIds, params.tagIds);
  }
}

export const localVideoDataSource = new LocalVideoDataSource();

// exposed for the OPFS import flow (mirrors music's local import
// writing directly to the local data source's underlying db helpers)
export const addLocalVideo = dbAddLocalVideo;
export const deleteLocalVideo = dbDeleteLocalVideo;
