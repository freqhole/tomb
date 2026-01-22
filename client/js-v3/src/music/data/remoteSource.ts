// remote data source implementation
// queries remote server for music library data using freqhole-api-client
import * as apiClient from "freqhole-api-client";
import type {
  AlbumSummary,
  ArtistSummary,
  GenreSummary,
  MusicDataSource,
  PaginatedResponse,
  PlaylistSummary,
  QueryParams,
  SearchField,
  SearchResponse,
  Song,
  SuggestionsResponse,
} from "./types";

// adapter to convert API song query result to local Song type
function adaptSongFromAPI(item: any, baseUrl: string): Song {
  const song = item.song;
  const artist = item.artist;
  const album = item.album;
  const blob = item.blob;

  const sha256 = blob?.sha256 || song.media_blob_id;

  return {
    id: song.id,
    sha256,
    title: song.title,
    artist_id: artist?.id || "",
    album_id: album?.id || "",
    track_number: song.track_number || 0,
    disc_number: song.disc_number || 1,
    duration_seconds: song.duration ? Math.floor(song.duration / 1000) : 0, // convert ms to seconds
    year:
      song.year ||
      (album?.release_date
        ? parseInt(album.release_date.substring(0, 4))
        : null),
    bpm: song.bpm || null,
    key_signature: song.key_signature || null,
    lyrics: song.lyrics || null,
    metadata: song.metadata || null,
    created_at: song.created_at,
    updated_at: song.updated_at,

    // denormalized fields
    artist_name: artist?.name || "unknown artist",
    album_title: album?.title || "unknown album",
    thumbnail_blob_id: song.thumbnail_blob_id || null,
    album_added_at: song.created_at, // use song's created_at as proxy
    album_primary_genre_id: item.genre?.id || null,

    // remote source type
    source_type: "remote" as const,

    // local/downloaded fields (null for remote)
    opfs_path: null,
    file_name: null,
    file_size: null,
    last_modified: null,
    mime_type: blob?.mime_type || null,
    source_url: `${baseUrl}/api/blobs/${song.media_blob_id}`,
    downloaded_at: null,

    // remote fields
    remote_server_id: null,
    remote_sha256: song.id,
    added_at: song.created_at,
  };
}

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
    return {
      items: result.data.items.map((item) =>
        adaptSongFromAPI(item, this.baseUrl),
      ),
      total: result.data.total_count,
      offset: result.data.offset,
      limit: result.data.limit,
      has_more: result.data.has_more,
    };
  }

  async getSongById(id: string): Promise<Song | null> {
    // note: there's no getSong endpoint in the API yet
    // we'll need to query with filter
    const filters: Record<string, any> = { song_ids: [id] };
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

    return adaptSongFromAPI(result.data.items[0], this.baseUrl);
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
        images:
          item.images?.map((img) => ({
            blob_id: img.blob_id,
            is_primary: img.is_primary ? 1 : 0,
          })) || undefined,
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

    return {
      items: result.data.items.map((item) =>
        adaptSongFromAPI(item, this.baseUrl),
      ),
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
        images:
          item.images?.map((img) => ({
            blob_id: img.blob_id,
            is_primary: img.is_primary ? 1 : 0,
          })) || undefined,
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

    return {
      items: result.data.items.map((item) =>
        adaptSongFromAPI(item, this.baseUrl),
      ),
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

    return {
      items: result.data.items.map((item) =>
        adaptSongFromAPI(item, this.baseUrl),
      ),
      total: result.data.total_count,
      offset: result.data.offset,
      limit: result.data.limit,
      has_more: result.data.has_more,
    };
  }

  // playlists
  async getPlaylists(
    params?: QueryParams,
  ): Promise<PaginatedResponse<PlaylistSummary>> {
    const apiParams = this.buildApiParams(params);
    const result = await apiClient.music.listPlaylists(this.baseUrl, apiParams);

    if (!result.success) {
      throw new Error("failed to query playlists");
    }

    // adapt API response to our interface
    return {
      items: result.data.items.map((item) => ({
        playlist_id: item.playlist.id,
        title: item.playlist.title,
        description: item.playlist.description,
        is_public: item.playlist.is_public === 1,
        thumbnail_blob_id: item.playlist.thumbnail_blob_id,
        song_count: item.song_count,
        created_at: item.playlist.created_at * 1000, // convert seconds to milliseconds
        updated_at: item.playlist.updated_at * 1000, // convert seconds to milliseconds
      })),
      total: result.data.total_count,
      offset: result.data.offset,
      limit: result.data.limit,
      has_more: result.data.has_more,
    };
  }

  async getPlaylistSongs(
    playlistId: string,
    params?: QueryParams,
  ): Promise<PaginatedResponse<Song>> {
    const result = await apiClient.music.queryPlaylistSongs(this.baseUrl, {
      playlist_id: playlistId,
      q: params?.search || null,
      sort_by: params?.sort_by || null,
      sort_direction: params?.sort_direction || null,
      limit: params?.limit || null,
      offset: params?.offset || null,
    });

    if (!result.success) {
      throw new Error("failed to query playlist songs");
    }

    // adapt API response to our interface
    // playlist songs have same structure as regular song queries
    return {
      items: result.data.items.map((item) =>
        adaptSongFromAPI(item.details, this.baseUrl),
      ),
      total: result.data.total_count,
      offset: result.data.offset,
      limit: result.data.limit,
      has_more: result.data.has_more,
    };
  }

  async createPlaylist(params: {
    title: string;
    description?: string | null;
    is_public?: boolean;
  }): Promise<PlaylistSummary> {
    const result = await apiClient.music.createPlaylist(this.baseUrl, {
      title: params.title,
      description: params.description || null,
      is_public: params.is_public ?? false,
      created_by_id: null, // server will use authenticated user
    });

    if (!result.success) {
      throw new Error("failed to create playlist");
    }

    return {
      playlist_id: result.data.id,
      title: result.data.title,
      description: result.data.description,
      is_public: result.data.is_public === 1,
      thumbnail_blob_id: result.data.thumbnail_blob_id,
      song_count: result.data.song_count,
      created_at: result.data.created_at * 1000, // convert seconds to milliseconds
      updated_at: result.data.updated_at * 1000, // convert seconds to milliseconds
    };
  }

  async updatePlaylist(
    playlistId: string,
    params: {
      title?: string | null;
      description?: string | null;
      is_public?: boolean | null;
    },
  ): Promise<PlaylistSummary> {
    const result = await apiClient.music.updatePlaylist(this.baseUrl, {
      playlist_id: playlistId,
      title: params.title || null,
      description: params.description || null,
      is_public: params.is_public ?? null,
      thumbnail_blob_id: null,
      updated_by: null, // server will use authenticated user
    });

    if (!result.success) {
      throw new Error("failed to update playlist");
    }

    return {
      playlist_id: result.data.id,
      title: result.data.title,
      description: result.data.description,
      is_public: result.data.is_public === 1,
      thumbnail_blob_id: result.data.thumbnail_blob_id,
      song_count: result.data.song_count,
      created_at: result.data.created_at * 1000, // convert seconds to milliseconds
      updated_at: result.data.updated_at * 1000, // convert seconds to milliseconds
    };
  }

  async deletePlaylist(playlistId: string): Promise<void> {
    const result = await apiClient.music.deletePlaylist(this.baseUrl, {
      playlist_id: playlistId,
      deleted_by: null, // server will use authenticated user
    });

    if (!result.success) {
      throw new Error("failed to delete playlist");
    }
  }

  async addSongsToPlaylist(
    playlistId: string,
    songIds: string[],
  ): Promise<void> {
    const result = await apiClient.music.addSongsToPlaylist(this.baseUrl, {
      playlist_id: playlistId,
      song_ids: songIds,
    });

    if (!result.success) {
      throw new Error("failed to add songs to playlist");
    }
  }

  async removeSongsFromPlaylist(
    playlistId: string,
    songIds: string[],
  ): Promise<void> {
    const result = await apiClient.music.removeSongsFromPlaylist(this.baseUrl, {
      playlist_id: playlistId,
      song_ids: songIds,
    });

    if (!result.success) {
      throw new Error("failed to remove songs from playlist");
    }
  }

  async reorderPlaylistSongs(
    playlistId: string,
    songIds: string[],
    newPosition: number,
  ): Promise<void> {
    const result = await apiClient.music.reorderPlaylistSongs(this.baseUrl, {
      playlist_id: playlistId,
      song_ids: songIds,
      new_position: newPosition,
    });

    if (!result.success) {
      throw new Error("failed to reorder playlist songs");
    }
  }

  // search suggestions
  async searchSuggestions(params: {
    field: SearchField;
    partial: string;
    page?: number;
    page_size?: number;
  }): Promise<SuggestionsResponse> {
    const result = await apiClient.music.suggestions(this.baseUrl, {
      field: params.field,
      partial: params.partial,
      page: params.page || 1,
      page_size: params.page_size || 10,
      context: null,
    });

    if (!result.success) {
      throw new Error("failed to get search suggestions");
    }

    return result.data;
  }

  // full search
  async search(params: {
    query: string;
    field?: SearchField | null;
    page?: number;
    page_size?: number;
  }): Promise<SearchResponse> {
    const result = await apiClient.music.search(this.baseUrl, {
      query: params.query,
      field: params.field || null,
      page: params.page || null,
      page_size: params.page_size || null,
      context: null,
    });

    if (!result.success) {
      throw new Error("failed to search");
    }

    return result.data;
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
