import { z } from "zod";
import type { ApiClient } from "../api-client.js";
import { musicValidation } from "./validation.js";
import { musicApiUtils } from "./error-handling.js";
import {
  SongSchema,
  SongListResponseSchema,
  ArtistSummarySchema,
  ArtistsListResponseSchema,
  AlbumSchema,
  AlbumListResponseSchema,
  AlbumTracksResponseSchema,
  PlaylistSchema,
  PlaylistListResponseSchema,
  PlaylistSongsResponseSchema,
  CreatePlaylistRequestSchema,
  UpdatePlaylistRequestSchema,
  AddSongsToPlaylistRequestSchema,
  RemoveSongsFromPlaylistRequestSchema,
  UpdateUserPreferenceRequestSchema,
  BulkUpdateUserPreferencesRequestSchema,
  UserPreferenceResponseSchema,
  BulkUserPreferenceResponseSchema,
  PlaylistPreferenceResponseSchema,
  PlaylistWithUserContextResponseSchema,
  AlbumFavoriteStatusResponseSchema,
} from "./schemas/index.js";
import type {
  Song,
  ArtistSummary,
  Album,
  Playlist,
  CreatePlaylistRequest,
  UpdatePlaylistRequest,
  AddSongsToPlaylistRequest,
  RemoveSongsFromPlaylistRequest,
  UpdateUserPreferenceRequest,
  BulkUpdateUserPreferencesRequest,
  UserPreferenceResponse,
  BulkUserPreferenceResponse,
  PlaylistPreferenceResponse,
  PlaylistWithUserContextResponse,
  AlbumFavoriteStatusResponse,
} from "./schemas/index.js";

/**
 * Music API methods to extend the ApiClient class
 * These methods follow the same patterns as existing ApiClient methods
 */
export const musicApiMethods = {
  // Songs API methods
  async getSongs(
    this: ApiClient,
    options?: {
      limit?: number;
      offset?: number;
      page?: number;
      page_size?: number;
      sort_by?: string;
      sort_direction?: string;
    }
  ): Promise<{ songs: Song[]; pagination: any }> {
    return musicApiUtils
      .withGracefulPaginatedCollection(
        async () => {
          const params = options || {};
          const response = await this.makeRequest<unknown>(
            "GET",
            "/api/media/songs",
            { params }
          );

          const validatedResponse = musicValidation.validateResponse(
            SongListResponseSchema,
            response,
            "Songs"
          );

          const songs = musicValidation.parseCollection(
            SongSchema,
            validatedResponse.songs || [],
            "Songs"
          ) as Song[];

          const pagination = {
            total: validatedResponse.total,
            page: validatedResponse.page,
            page_size: validatedResponse.page_size,
            total_pages: validatedResponse.total_pages,
            has_next: validatedResponse.has_next,
            has_prev: validatedResponse.has_prev,
          };

          return { items: songs, pagination };
        },
        "/api/media/songs",
        "getSongs",
        options || {}
      )
      .then((result) => ({
        songs: result.items,
        pagination: result.pagination,
      }));
  },

  // Artists API methods
  async getArtists(
    this: ApiClient,
    options?: {
      limit?: number;
      offset?: number;
      page?: number;
      page_size?: number;
    }
  ): Promise<{ artists: ArtistSummary[]; pagination: any }> {
    return musicApiUtils
      .withGracefulPaginatedCollection(
        async () => {
          const params = options || {};
          const response = await this.makeRequest<unknown>(
            "GET",
            "/api/media/artists",
            { params }
          );

          const validatedResponse = musicValidation.validateResponse(
            ArtistsListResponseSchema,
            response,
            "Artists"
          );

          const artists = musicValidation.parseCollection(
            ArtistSummarySchema,
            validatedResponse.artists || [],
            "Artists"
          ) as ArtistSummary[];

          const pagination = {
            total: validatedResponse.total,
            page: validatedResponse.page,
            page_size: validatedResponse.page_size,
            total_pages: validatedResponse.total_pages,
            has_next: validatedResponse.has_next,
            has_prev: validatedResponse.has_prev,
          };

          return { items: artists, pagination };
        },
        "/api/media/artists",
        "getArtists",
        options || {}
      )
      .then((result) => ({
        artists: result.items,
        pagination: result.pagination,
      }));
  },

  async getArtistSongs(
    this: ApiClient,
    artist: string,
    options?: {
      limit?: number;
      offset?: number;
      page?: number;
      page_size?: number;
    }
  ): Promise<{ songs: Song[]; pagination: any }> {
    return musicApiUtils
      .withGracefulPaginatedCollection(
        async () => {
          const params = options || {};
          const response = await this.makeRequest<unknown>(
            "GET",
            `/api/media/artists/${encodeURIComponent(artist)}/songs`,
            { params }
          );

          const validatedResponse = musicValidation.validateResponse(
            SongListResponseSchema,
            response,
            "Artist Songs"
          );

          const songs = musicValidation.parseCollection(
            SongSchema,
            validatedResponse.songs || [],
            "Artist Songs"
          ) as Song[];

          // Use actual pagination metadata from the server response
          const pagination = {
            total: validatedResponse.total,
            page: validatedResponse.page || 1,
            page_size: validatedResponse.page_size || songs.length,
            total_pages: validatedResponse.total_pages || 1,
            has_next: validatedResponse.has_next,
            has_prev: validatedResponse.has_prev,
          };

          return { items: songs, pagination };
        },
        `/api/media/artists/${encodeURIComponent(artist)}/songs`,
        "getArtistSongs",
        { artist, ...options }
      )
      .then((result) => ({
        songs: result.items,
        pagination: result.pagination,
      }));
  },

  // Albums API methods
  async getAlbums(
    this: ApiClient,
    options?: {
      limit?: number;
      offset?: number;
      page?: number;
      page_size?: number;
    }
  ): Promise<{ albums: Album[]; pagination: any }> {
    return musicApiUtils
      .withGracefulPaginatedCollection(
        async () => {
          const params = options || {};
          const response = await this.makeRequest<unknown>(
            "GET",
            "/api/media/albums",
            { params }
          );

          // Handle direct array response (album summaries) - transform to paginated format
          if (Array.isArray(response)) {
            const albums = musicValidation.parseCollection(
              AlbumSchema,
              response,
              "Album Summaries"
            ) as Album[];

            // Create fake pagination metadata for backward compatibility
            const pagination = {
              total: albums.length,
              page: 1,
              page_size: albums.length,
              total_pages: 1,
              has_next: false,
              has_prev: false,
            };

            return { items: albums, pagination };
          }

          // Handle wrapped response
          const validatedResponse = musicValidation.validateResponse(
            AlbumListResponseSchema,
            response,
            "Album Summaries"
          );

          const albums = musicValidation.parseCollection(
            AlbumSchema,
            validatedResponse.albums || [],
            "Album Summaries"
          ) as Album[];

          const pagination = {
            total: validatedResponse.total,
            page: validatedResponse.page,
            page_size: validatedResponse.page_size,
            total_pages: validatedResponse.total_pages,
            has_next: validatedResponse.has_next,
            has_prev: validatedResponse.has_prev,
          };

          return { items: albums, pagination };
        },
        "/api/media/albums",
        "getAlbums",
        options || {}
      )
      .then((result) => ({
        albums: result.items,
        pagination: result.pagination,
      }));
  },

  async getAlbumTracks(
    this: ApiClient,
    album: string,
    artist?: string
  ): Promise<Song[]> {
    return musicApiUtils.withGracefulCollection(
      async () => {
        const params = artist ? { artist } : {};
        const response = await this.makeRequest<unknown>(
          "GET",
          `/api/media/albums/${encodeURIComponent(album)}/tracks`,
          { params }
        );

        const validatedResponse = musicValidation.validateResponse(
          AlbumTracksResponseSchema,
          response,
          "Album Tracks"
        );

        // Convert album tracks to song format
        const tracks = validatedResponse.tracks || [];
        const songs = tracks.map((track) => ({
          id: track.song_id,
          title: track.title,
          artist: track.artist,
          album: validatedResponse.album,
          album_artist: track.artist,
          track_number: track.track_number,
          disc_number: track.disc_number,
          duration_seconds: track.duration,
          genre: track.genre,
          year: track.year,
          bpm: null,
          key_signature: null,
          rating: track.rating,
          is_favorite: track.is_favorite,
          tags: [],
          display_title: track.track_display,
          detailed_display_title: track.track_display,
          created_at: new Date().toISOString(),
          media_blob_id: track.media_blob_id,
          thumbnail_blob_id: track.thumbnail_id,
          waveform_blob_id: track.waveform_id,
          thumbnail_blob_ids: [],
        }));

        return musicValidation.parseCollection(
          SongSchema,
          songs,
          "Album Tracks"
        ) as Song[];
      },
      `/api/media/albums/${encodeURIComponent(album)}/tracks`,
      "getAlbumTracks",
      { album, artist }
    );
  },

  // Playlists API methods
  async getPlaylists(
    this: ApiClient,
    options?: {
      limit?: number;
      offset?: number;
      page?: number;
      page_size?: number;
    }
  ): Promise<{ playlists: Playlist[]; pagination: any }> {
    return musicApiUtils
      .withGracefulPaginatedCollection(
        async () => {
          const params = options || {};
          const response = await this.makeRequest<unknown>(
            "GET",
            "/api/media/playlists",
            { params }
          );

          const validatedResponse = musicValidation.validateResponse(
            PlaylistListResponseSchema,
            response,
            "Playlists"
          );

          const playlists = musicValidation.parseCollection(
            PlaylistSchema,
            validatedResponse.playlists || [],
            "Playlists"
          ) as Playlist[];

          const pagination = {
            total: validatedResponse.total,
            page: validatedResponse.page,
            page_size: validatedResponse.page_size,
            total_pages: validatedResponse.total_pages,
            has_next: validatedResponse.has_next,
            has_prev: validatedResponse.has_prev,
          };

          return { items: playlists, pagination };
        },
        "/api/media/playlists",
        "getPlaylists",
        options || {}
      )
      .then((result) => ({
        playlists: result.items,
        pagination: result.pagination,
      }));
  },

  async getPlaylistSongs(this: ApiClient, playlistId: string): Promise<Song[]> {
    return musicApiUtils.withGracefulCollection(
      async () => {
        const response = await this.makeRequest<unknown>(
          "GET",
          `/api/media/playlists/${playlistId}/songs`
        );

        const validatedResponse = musicValidation.validateResponse(
          PlaylistSongsResponseSchema,
          response,
          "Playlist Songs"
        );

        // Extract songs from playlist song responses
        const playlistSongs = validatedResponse.songs || [];
        const songs = playlistSongs.map((playlistSong) => playlistSong.song);

        return musicValidation.parseCollection(
          SongSchema,
          songs,
          "Playlist Songs"
        ) as Song[];
      },
      `/api/media/playlists/${playlistId}/songs`,
      "getPlaylistSongs",
      { playlistId }
    );
  },

  async createPlaylist(
    this: ApiClient,
    request: CreatePlaylistRequest
  ): Promise<Playlist> {
    return musicApiUtils.withErrorHandling(
      async () => {
        // Validate request
        const validatedRequest = musicValidation.validateResponse(
          CreatePlaylistRequestSchema,
          request,
          "Create Playlist Request"
        );

        const response = await this.makeRequest<unknown>(
          "POST",
          "/api/media/playlists",
          {
            data: validatedRequest,
            headers: { "Content-Type": "application/json" },
          }
        );

        return musicValidation.validateResponse(
          PlaylistSchema,
          response,
          "Created Playlist"
        );
      },
      "/api/media/playlists",
      "createPlaylist",
      {},
      request
    );
  },

  async updatePlaylist(
    this: ApiClient,
    playlistId: string,
    request: UpdatePlaylistRequest
  ): Promise<Playlist> {
    return musicApiUtils.withErrorHandling(
      async () => {
        // Validate request
        const validatedRequest = musicValidation.validateResponse(
          UpdatePlaylistRequestSchema,
          request,
          "Update Playlist Request"
        );

        const response = await this.makeRequest<unknown>(
          "PUT",
          `/api/media/playlists/${playlistId}`,
          {
            data: validatedRequest,
            headers: { "Content-Type": "application/json" },
          }
        );

        return musicValidation.validateResponse(
          PlaylistSchema,
          response,
          "Updated Playlist"
        );
      },
      `/api/media/playlists/${playlistId}`,
      "updatePlaylist",
      { playlistId },
      request
    );
  },

  async addSongsToPlaylist(
    this: ApiClient,
    playlistId: string,
    songIds: string[]
  ): Promise<void> {
    return musicApiUtils.withErrorHandling(
      async () => {
        const request: AddSongsToPlaylistRequest = { song_ids: songIds };

        // Validate request
        const validatedRequest = musicValidation.validateResponse(
          AddSongsToPlaylistRequestSchema,
          request,
          "Add Songs to Playlist Request"
        );

        await this.makeRequest<unknown>(
          "POST",
          `/api/media/playlists/${playlistId}/songs`,
          {
            data: validatedRequest,
            headers: { "Content-Type": "application/json" },
          }
        );
      },
      `/api/media/playlists/${playlistId}/songs`,
      "addSongsToPlaylist",
      { playlistId, songCount: songIds.length },
      { song_ids: songIds }
    );
  },

  async removeSongsFromPlaylist(
    this: ApiClient,
    playlistId: string,
    songIds: string[]
  ): Promise<void> {
    return musicApiUtils.withErrorHandling(
      async () => {
        const request: RemoveSongsFromPlaylistRequest = { song_ids: songIds };

        // Validate request
        const validatedRequest = musicValidation.validateResponse(
          RemoveSongsFromPlaylistRequestSchema,
          request,
          "Remove Songs from Playlist Request"
        );

        await this.makeRequest<unknown>(
          "DELETE",
          `/api/media/playlists/${playlistId}/songs`,
          {
            data: validatedRequest,
            headers: { "Content-Type": "application/json" },
          }
        );
      },
      `/api/media/playlists/${playlistId}/songs`,
      "removeSongsFromPlaylist",
      { playlistId, songCount: songIds.length },
      { song_ids: songIds }
    );
  },

  async deletePlaylist(this: ApiClient, playlistId: string): Promise<void> {
    return musicApiUtils.withErrorHandling(
      async () => {
        await this.makeRequest<unknown>(
          "DELETE",
          `/api/media/playlists/${playlistId}`
        );
      },
      `/api/media/playlists/${playlistId}`,
      "deletePlaylist",
      { playlistId }
    );
  },

  async getPlaylistSummaries(this: ApiClient): Promise<any[]> {
    return musicApiUtils.withGracefulCollection(
      async () => {
        const response = await this.makeRequest<unknown>(
          "GET",
          "/api/media/playlists/summaries"
        );

        // This endpoint returns playlist summaries with additional info
        return response as any[];
      },
      "/api/media/playlists/summaries",
      "getPlaylistSummaries"
    );
  },

  // User preference API methods
  async updateSongPreferences(
    this: ApiClient,
    songId: string,
    request: UpdateUserPreferenceRequest
  ): Promise<UserPreferenceResponse> {
    return musicApiUtils.withErrorHandling(
      async () => {
        // validate request
        const validatedRequest = musicValidation.validateResponse(
          UpdateUserPreferenceRequestSchema,
          request,
          "update user preference request"
        );

        const response = await this.makeRequest<unknown>(
          "PUT",
          `/api/media/songs/${songId}/preferences`,
          {
            data: validatedRequest,
            headers: { "Content-Type": "application/json" },
          }
        );

        return musicValidation.validateResponse(
          UserPreferenceResponseSchema,
          response,
          "user preference response"
        );
      },
      `/api/media/songs/${songId}/preferences`,
      "updateSongPreferences",
      { songId },
      request
    );
  },

  async bulkUpdateUserPreferences(
    this: ApiClient,
    request: BulkUpdateUserPreferencesRequest
  ): Promise<BulkUserPreferenceResponse> {
    return musicApiUtils.withErrorHandling(
      async () => {
        // validate request
        const validatedRequest = musicValidation.validateResponse(
          BulkUpdateUserPreferencesRequestSchema,
          request,
          "bulk update user preferences request"
        );

        const response = await this.makeRequest<unknown>(
          "PUT",
          "/api/media/songs/preferences/bulk",
          {
            data: validatedRequest,
            headers: { "Content-Type": "application/json" },
          }
        );

        return musicValidation.validateResponse(
          BulkUserPreferenceResponseSchema,
          response,
          "bulk user preference response"
        );
      },
      "/api/media/songs/preferences/bulk",
      "bulkUpdateUserPreferences",
      { songCount: request.song_ids.length },
      request
    );
  },

  // convenience methods for common preference operations
  async toggleSongFavorite(
    this: ApiClient,
    songId: string,
    isFavorite: boolean
  ): Promise<UserPreferenceResponse> {
    return this.updateSongPreferences(songId, {
      is_favorite: isFavorite,
    });
  },

  async rateSong(
    this: ApiClient,
    songId: string,
    rating: number
  ): Promise<UserPreferenceResponse> {
    const request =
      rating === 0
        ? {} // Don't include rating field at all when clearing
        : { rating };

    return this.updateSongPreferences(songId, request);
  },

  async bulkToggleFavorite(
    this: ApiClient,
    songIds: string[],
    isFavorite: boolean
  ): Promise<BulkUserPreferenceResponse> {
    return this.bulkUpdateUserPreferences({
      song_ids: songIds,
      updates: { is_favorite: isFavorite },
    });
  },

  async bulkRateSongs(
    this: ApiClient,
    songIds: string[],
    rating: number | null
  ): Promise<BulkUserPreferenceResponse> {
    return this.bulkUpdateUserPreferences({
      song_ids: songIds,
      updates: { rating: rating || undefined },
    });
  },

  // playlist preference methods
  async updatePlaylistPreference(
    this: ApiClient,
    playlistId: string,
    isFavorite: boolean
  ): Promise<PlaylistPreferenceResponse> {
    return musicApiUtils.withErrorHandling(
      async () => {
        const response = await this.makeRequest<unknown>(
          "PATCH",
          `/api/media/playlists/${playlistId}/preferences`,
          {
            data: { is_favorite: isFavorite },
            headers: { "Content-Type": "application/json" },
          }
        );

        return musicValidation.validateResponse(
          PlaylistPreferenceResponseSchema,
          response,
          "playlist preference response"
        );
      },
      `/api/media/playlists/${playlistId}/preferences`,
      "updatePlaylistPreference",
      { playlistId },
      { is_favorite: isFavorite }
    );
  },

  async getPlaylistsWithUserContext(
    this: ApiClient
  ): Promise<PlaylistWithUserContextResponse[]> {
    return musicApiUtils.withErrorHandling(
      async () => {
        const response = await this.makeRequest<unknown>(
          "GET",
          "/api/media/playlists/user-context"
        );

        return musicValidation.validateResponse(
          z.array(PlaylistWithUserContextResponseSchema),
          response,
          "playlists with user context response"
        );
      },
      "/api/media/playlists/user-context",
      "getPlaylistsWithUserContext"
    );
  },

  // album preference methods
  async bulkFavoriteAlbum(
    this: ApiClient,
    album: string,
    isFavorite: boolean
  ): Promise<BulkUserPreferenceResponse> {
    return musicApiUtils.withErrorHandling(
      async () => {
        const response = await this.makeRequest<unknown>(
          "POST",
          "/api/media/albums/favorite",
          {
            data: { album, is_favorite: isFavorite },
            headers: { "Content-Type": "application/json" },
          }
        );

        return musicValidation.validateResponse(
          BulkUserPreferenceResponseSchema,
          response,
          "bulk album favorite response"
        );
      },
      "/api/media/albums/favorite",
      "bulkFavoriteAlbum",
      { album },
      { album, is_favorite: isFavorite }
    );
  },

  async getAlbumFavoriteStatus(
    this: ApiClient,
    album: string
  ): Promise<AlbumFavoriteStatusResponse> {
    return musicApiUtils.withErrorHandling(
      async () => {
        const response = await this.makeRequest<unknown>(
          "GET",
          `/api/media/albums/${encodeURIComponent(album)}/favorite-status`
        );

        return musicValidation.validateResponse(
          AlbumFavoriteStatusResponseSchema,
          response,
          "album favorite status response"
        );
      },
      `/api/media/albums/${encodeURIComponent(album)}/favorite-status`,
      "getAlbumFavoriteStatus",
      { album }
    );
  },

  async bulkFavoritePlaylistSongs(
    this: ApiClient,
    playlistId: string,
    isFavorite: boolean
  ): Promise<BulkUserPreferenceResponse> {
    return musicApiUtils.withErrorHandling(
      async () => {
        const response = await this.makeRequest<unknown>(
          "POST",
          `/api/media/playlists/${playlistId}/favorite-songs`,
          {
            data: { is_favorite: isFavorite },
            headers: { "Content-Type": "application/json" },
          }
        );

        return musicValidation.validateResponse(
          BulkUserPreferenceResponseSchema,
          response,
          "bulk playlist songs favorite response"
        );
      },
      `/api/media/playlists/${playlistId}/favorite-songs`,
      "bulkFavoritePlaylistSongs",
      { playlistId },
      { is_favorite: isFavorite }
    );
  },
};
