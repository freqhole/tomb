// remote video data source — queries a peer/server for video library data
// via app/api/client facade. mirrors music/data/remote/remoteSource.ts's
// error-handling shape, simplified.
import {
  getClientForRemote,
  isNetworkError,
  type ApiClient,
  type RemoteRef,
  type SafeParseResult,
} from "../../../app/api/client";
import { RemoteOfflineError } from "../../../music/data/remote/remoteSource";
import { getRemoteMediaUrl } from "../../../utils/urls";
import type { ImageMetadata } from "../../../music/services/storage/types";
import type {
  PaginatedVideoSeries,
  PaginatedVideos,
  Video,
  VideoDataSource,
  VideoImageEntityType,
  VideoQueryParams,
  VideoSeason,
  VideoSeries,
  VideoSummary,
} from "../types";

export class RemoteVideoDataSource implements VideoDataSource {
  private remote: RemoteRef;
  private remoteId: string;
  private client: ApiClient | null = null;

  constructor(remote: RemoteRef) {
    if (!remote.remote_id) {
      throw new Error("remote_id required for RemoteVideoDataSource");
    }
    this.remote = remote;
    this.remoteId = remote.remote_id;
  }

  private async getClient(): Promise<ApiClient> {
    if (!this.client) {
      this.client = await getClientForRemote(this.remote);
    }
    return this.client;
  }

  private get baseUrl(): string {
    return this.remote.base_url ?? "";
  }

  // Tauri-managed remotes don't run an HTTP server — blob access goes through IPC
  private getBlobHttpUrl(blobId: string): string | undefined {
    if (this.remote.is_charnel_managed) {
      return undefined;
    }
    return getRemoteMediaUrl(this.baseUrl, blobId);
  }

  // throws RemoteOfflineError on a network error, or a generic error
  // otherwise. always throws — callers rely on this for control flow.
  private failRequest(result: SafeParseResult<unknown>): never {
    if (isNetworkError(result)) {
      const remoteName = this.remote.name ?? this.remote.base_url ?? this.remoteId;
      throw new RemoteOfflineError(this.remoteId, remoteName);
    }
    throw new Error("video request failed");
  }

  private mapVideo(video: Video): VideoSummary {
    return {
      ...video,
      added_at: video.created_at,
      source_type: "remote",
      remote_server_id: this.remoteId,
      opfs_path: null,
      poster_opfs_path: null,
    };
  }

  private buildQueryVideosParams(params?: VideoQueryParams) {
    return {
      params: {
        q: params?.search ?? null,
        search_fields: null,
        filters: {},
        sort_by: params?.sort_by ?? null,
        sort_direction: params?.sort_direction ?? null,
        limit: params?.limit ?? null,
        offset: params?.offset ?? null,
        user_id: null,
        favorites_only: null,
        min_rating: null,
        mb_lookup_status: null,
        pending_review: null,
        caller_is_admin: null,
      },
      series_id: params?.series_id ?? null,
      season_id: params?.season_id ?? null,
      unassigned: params?.unassigned ?? false,
    };
  }

  async getVideos(params?: VideoQueryParams): Promise<PaginatedVideos> {
    const client = await this.getClient();
    const result = await client.video.queryVideos(
      this.buildQueryVideosParams(params),
    );
    if (!result.success) this.failRequest(result);

    return {
      items: result.data.items.map((v) => this.mapVideo(v)),
      total_count: result.data.total_count,
      has_more: result.data.has_more,
      offset: result.data.offset,
    };
  }

  async getVideoById(id: string): Promise<VideoSummary | null> {
    const client = await this.getClient();
    const result = await client.video.getVideo({ id });
    if (!result.success) return null;
    return this.mapVideo(result.data);
  }

  async getVideoSeriesList(params?: {
    offset?: number;
    limit?: number;
    search?: string;
  }): Promise<PaginatedVideoSeries> {
    const client = await this.getClient();
    const result = await client.video.queryVideoSeries({
      q: params?.search ?? null,
      search_fields: null,
      filters: {},
      sort_by: null,
      sort_direction: null,
      limit: params?.limit ?? null,
      offset: params?.offset ?? null,
      user_id: null,
      favorites_only: null,
      min_rating: null,
      mb_lookup_status: null,
      pending_review: null,
      caller_is_admin: null,
    });
    if (!result.success) this.failRequest(result);

    return {
      items: result.data.items,
      total_count: result.data.total_count,
      has_more: result.data.has_more,
      offset: result.data.offset,
    };
  }

  async getVideoSeriesById(id: string): Promise<VideoSeries | null> {
    const client = await this.getClient();
    const result = await client.video.getVideoSeries({ id });
    if (!result.success) return null;
    return result.data;
  }

  async getVideoSeasons(seriesId: string): Promise<VideoSeason[]> {
    const client = await this.getClient();
    const result = await client.video.listVideoSeasons({ series_id: seriesId });
    if (!result.success) this.failRequest(result);
    return result.data;
  }

  async getVideosBySeason(seasonId: string): Promise<VideoSummary[]> {
    const client = await this.getClient();
    const result = await client.video.listVideosBySeason({ season_id: seasonId });
    if (!result.success) this.failRequest(result);
    return result.data.map((v) => this.mapVideo(v));
  }

  async getVideosBySeries(seriesId: string): Promise<VideoSummary[]> {
    const client = await this.getClient();
    const result = await client.video.listVideosBySeries({ series_id: seriesId });
    if (!result.success) this.failRequest(result);
    return result.data.map((v) => this.mapVideo(v));
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
    const client = await this.getClient();
    const result = await client.video.updateVideos({
      video_ids: [params.video_id],
      title: params.title,
      description: params.description,
      episode_number: params.episode_number,
      release_date: params.release_date,
      series_id: params.series_id,
      season_id: params.season_id,
    });
    if (!result.success) this.failRequest(result);
    if (result.data.videos_failed.length > 0) {
      throw new Error("failed to update video");
    }
  }

  async deleteVideo(videoId: string): Promise<void> {
    const client = await this.getClient();
    const result = await client.video.deleteVideo({ id: videoId });
    if (!result.success) this.failRequest(result);
  }

  async createVideoSeries(params: {
    title: string;
    description?: string | null;
  }): Promise<VideoSeries> {
    const client = await this.getClient();
    const result = await client.video.createVideoSeries(params);
    if (!result.success) this.failRequest(result);
    return result.data;
  }

  async updateVideoSeries(params: {
    series_id: string;
    title?: string;
    description?: string | null;
    poster_blob_id?: string | null;
  }): Promise<void> {
    const client = await this.getClient();
    const result = await client.video.updateVideoSeries(params);
    if (!result.success) this.failRequest(result);
  }

  async deleteVideoSeries(seriesId: string): Promise<void> {
    const client = await this.getClient();
    const result = await client.video.deleteVideoSeries({ id: seriesId });
    if (!result.success) this.failRequest(result);
  }

  // image operations — same generic entity_imagez routes albums use,
  // scoped to entity_type "video"/"video_series" (mirrors
  // music/data/remote/remoteSource.ts's image methods)
  async uploadImage(params: {
    file?: File;
    filePath?: string;
    entityType: VideoImageEntityType;
    entityId: string;
    isPrimary?: boolean;
  }): Promise<{ blob_id: string; job_id: string }> {
    const client = await this.getClient();
    const associateOpts = {
      associate: {
        entity_type: params.entityType,
        entity_id: params.entityId,
        is_primary: params.isPrimary ?? false,
      },
    };

    // path-based upload only works when the remote is charnel-managed
    // (same-machine IPC) — see music/data/remote/remoteSource.ts's
    // uploadImage for the full explanation of why a plain http/p2p
    // remote can't use filePath.
    const canUploadByPath = !!params.filePath && !!this.remote.is_charnel_managed;

    let result;
    if (canUploadByPath) {
      result = await client.upload.imageByPath(params.filePath!, associateOpts);
    } else if (params.file) {
      result = await client.upload.image(params.file, associateOpts);
    } else {
      throw new Error("either file or filePath must be provided");
    }

    if (!result.success) this.failRequest(result);
    return { blob_id: result.data.blob_id, job_id: result.data.job_id };
  }

  async getEntityImages(params: {
    entityType: VideoImageEntityType;
    entityId: string;
  }): Promise<ImageMetadata[]> {
    const client = await this.getClient();
    const result = await client.entities.getEntityImages({
      entity_type: params.entityType,
      entity_id: params.entityId,
    });
    if (!result.success) this.failRequest(result);
    return result.data.map((img) => ({
      remote_blob_id: img.blob_id,
      remote_url: this.getBlobHttpUrl(img.blob_id),
      remote_server_id: this.remoteId,
      is_primary: !!img.is_primary,
      blob_type: img.blob_type,
    }));
  }

  async removeImage(params: {
    entityType: VideoImageEntityType;
    entityId: string;
    blobId: string;
  }): Promise<void> {
    const client = await this.getClient();
    const result = await client.music.deleteImage({
      entity_type: params.entityType,
      entity_id: params.entityId,
      blob_id: params.blobId,
    });
    if (!result.success) this.failRequest(result);
  }

  async setPrimaryImage(params: {
    entityType: VideoImageEntityType;
    entityId: string;
    blobId: string;
  }): Promise<void> {
    const client = await this.getClient();
    const result = await client.music.setPrimaryImage({
      entity_type: params.entityType,
      entity_id: params.entityId,
      blob_id: params.blobId,
    });
    if (!result.success) this.failRequest(result);
  }
}
