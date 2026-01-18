// remote data source implementation
// queries remote server for music library data using freqhole-api-client
import * as apiClient from "freqhole-api-client";
import type {
  AlbumSummary,
  ArtistSummary,
  GenreSummary,
  MusicDataSource,
  PaginatedResponse,
  QueryParams,
  Song,
} from "./types";

// remote data source implementation
// uses cookie-based auth - no credentials stored client-side
export class RemoteMusicDataSource implements MusicDataSource {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  // helper to convert our QueryParams to API QueryParams
  private buildApiParams(params?: QueryParams): apiClient.QueryParams {
    const filters: Record<string, any> = {};

    // map our individual filter fields to the filters object
    if (params?.artist_id) filters.artist_id = params.artist_id;
    if (params?.album_id) filters.album_id = params.album_id;
    if (params?.genre_id) filters.genre_id = params.genre_id;

    return {
      q: params?.search || null,
      search_fields: null,
      filters,
      sort_by: params?.sort_by || null,
      sort_direction: params?.sort_direction || null,
      limit: params?.limit || null,
      offset: params?.offset || null,
      user_id: null,
      favorites_only: null,
      min_rating: null,
    };
  }

  // songs
  async getSongs(params?: QueryParams): Promise<PaginatedResponse<Song>> {
    const apiParams = this.buildApiParams(params);
    const result = await apiClient.music.querySongs(this.baseUrl, apiParams);

    if (!result.success) {
      throw new Error("failed to query songs");
    }

    // adapt API response to our interface
    // TODO: proper type mapping from API song schema to our Song type
    return {
      items: result.data.items as any[], // type mismatch - need proper mapping
      total: result.data.total_count,
      offset: result.data.offset,
      limit: result.data.limit,
      has_more: result.data.has_more,
    };
  }

  async getSongById(id: string): Promise<Song | null> {
    // note: there's no getSong endpoint in the API yet
    // we'll need to query with filter
    const filters: Record<string, any> = { id };
    const result = await apiClient.music.querySongs(this.baseUrl, {
      q: null,
      search_fields: null,
      filters,
      sort_by: null,
      sort_direction: null,
      limit: 1,
      offset: null,
      user_id: null,
      favorites_only: null,
      min_rating: null,
    });

    if (!result.success || result.data.items.length === 0) {
      return null;
    }

    // TODO: proper type mapping
    return result.data.items[0] as any;
  }

  // albums
  async getAlbums(
    params?: QueryParams,
  ): Promise<PaginatedResponse<AlbumSummary>> {
    const apiParams = this.buildApiParams(params);
    const result = await apiClient.music.queryAlbums(this.baseUrl, apiParams);

    if (!result.success) {
      throw new Error("failed to query albums");
    }

    // adapt API response to our interface
    return {
      items: result.data.items.map((item) => ({
        album_id: item.album.id,
        title: item.album.title,
        artist_id: item.artist?.id || "",
        artist_name: item.artist?.name || "unknown artist",
        year: undefined, // TODO: extract year from release_date if present
        song_count: item.album.song_count,
        total_duration: item.album.total_duration,
      })),
      total: result.data.total_count,
      offset: result.data.offset,
      limit: result.data.limit,
      has_more: result.data.has_more,
    };
  }

  async getAlbumSongs(
    albumId: string,
    params?: QueryParams,
  ): Promise<PaginatedResponse<Song>> {
    const apiParams = this.buildApiParams({
      ...params,
      album_id: albumId,
    });

    const result = await apiClient.music.querySongs(this.baseUrl, apiParams);

    if (!result.success) {
      throw new Error("failed to query album songs");
    }

    // TODO: proper type mapping
    return {
      items: result.data.items as any[],
      total: result.data.total_count,
      offset: result.data.offset,
      limit: result.data.limit,
      has_more: result.data.has_more,
    };
  }

  // artists
  async getArtists(
    params?: QueryParams,
  ): Promise<PaginatedResponse<ArtistSummary>> {
    const apiParams = this.buildApiParams(params);
    const result = await apiClient.music.queryArtists(this.baseUrl, apiParams);

    if (!result.success) {
      throw new Error("failed to query artists");
    }

    // adapt API response to our interface
    return {
      items: result.data.items.map((item) => ({
        artist_id: item.artist.id,
        name: item.artist.name,
        album_count: item.album_count,
        song_count: item.song_count,
        total_duration: item.total_duration || 0,
      })),
      total: result.data.total_count,
      offset: result.data.offset,
      limit: result.data.limit,
      has_more: result.data.has_more,
    };
  }

  async getArtistSongs(
    artistId: string,
    params?: QueryParams,
  ): Promise<PaginatedResponse<Song>> {
    const apiParams = this.buildApiParams({
      ...params,
      artist_id: artistId,
    });

    const result = await apiClient.music.querySongs(this.baseUrl, apiParams);

    if (!result.success) {
      throw new Error("failed to query artist songs");
    }

    // TODO: proper type mapping
    return {
      items: result.data.items as any[],
      total: result.data.total_count,
      offset: result.data.offset,
      limit: result.data.limit,
      has_more: result.data.has_more,
    };
  }

  // genres
  async getGenres(
    params?: QueryParams,
  ): Promise<PaginatedResponse<GenreSummary>> {
    const apiParams = this.buildApiParams(params);
    const result = await apiClient.music.queryGenres(this.baseUrl, apiParams);

    if (!result.success) {
      throw new Error("failed to query genres");
    }

    // adapt API response to our interface
    return {
      items: result.data.items.map((item) => ({
        genre_id: item.genre.id,
        name: item.genre.name,
        album_count: item.album_count || 0,
        song_count: item.song_count || 0,
      })),
      total: result.data.total_count,
      offset: result.data.offset,
      limit: result.data.limit,
      has_more: result.data.has_more,
    };
  }

  async getGenreSongs(
    genreId: string,
    params?: QueryParams,
  ): Promise<PaginatedResponse<Song>> {
    const apiParams = this.buildApiParams({
      ...params,
      genre_id: genreId,
    });

    const result = await apiClient.music.querySongs(this.baseUrl, apiParams);

    if (!result.success) {
      throw new Error("failed to query genre songs");
    }

    // TODO: proper type mapping
    return {
      items: result.data.items as any[],
      total: result.data.total_count,
      offset: result.data.offset,
      limit: result.data.limit,
      has_more: result.data.has_more,
    };
  }

  // source metadata
  async getSourceInfo(): Promise<{
    type: "local" | "remote";
    name: string;
    song_count: number;
  }> {
    // use whoami to get server info
    const result = await apiClient.auth.whoami(this.baseUrl);

    if (!result.success) {
      throw new Error("failed to get source info");
    }

    return {
      type: "remote",
      name: result.data.username || this.baseUrl,
      song_count: 0, // TODO: get actual song count from API
    };
  }
}
