import type { ApiClient } from "../api-client.js";
import { musicValidation } from "./validation.js";
import {
  SongSchema,
  SongListResponseSchema,
  ArtistSummarySchema,
  ArtistsListResponseSchema,
  ArtistSongsResponseSchema,
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
} from "./schemas/index.js";

/**
 * Music API methods to extend the ApiClient class
 * These methods follow the same patterns as existing ApiClient methods
 */
export const musicApiMethods = {
  // Songs API methods
  async getSongs(this: ApiClient, limit?: number): Promise<Song[]> {
    try {
      const params = limit ? { limit } : {};
      const response = await this.makeRequest<unknown>(
        "GET",
        "/api/media/songs",
        { params }
      );

      // Use graceful collection parsing
      // Use graceful validation like existing search methods
      const validatedResponse = musicValidation.validateResponse(
        SongListResponseSchema,
        response,
        "Songs"
      );

      return musicValidation.parseCollection(
        SongSchema,
        validatedResponse.songs || [],
        "Songs"
      ) as Song[];
    } catch (error) {
      console.error("getSongs failed:", error);
      throw error;
    }
  },

  // Artists API methods
  async getArtists(this: ApiClient): Promise<ArtistSummary[]> {
    try {
      const response = await this.makeRequest<unknown>(
        "GET",
        "/api/media/artists"
      );

      // Use graceful collection parsing
      const validatedResponse = musicValidation.validateResponse(
        ArtistsListResponseSchema,
        response,
        "Artists"
      );

      return musicValidation.parseCollection(
        ArtistSummarySchema,
        validatedResponse.artists || [],
        "Artists"
      ) as ArtistSummary[];
    } catch (error) {
      console.error("getArtists failed:", error);
      throw error;
    }
  },

  async getArtistSongs(
    this: ApiClient,
    artist: string,
    limit?: number
  ): Promise<Song[]> {
    try {
      const params = limit ? { limit } : {};
      const response = await this.makeRequest<unknown>(
        "GET",
        `/api/media/artists/${encodeURIComponent(artist)}/songs`,
        { params }
      );

      // Use graceful collection parsing
      const validatedResponse = musicValidation.validateResponse(
        ArtistSongsResponseSchema,
        response,
        "Artist Songs"
      );

      return musicValidation.parseCollection(
        SongSchema,
        validatedResponse.songs || [],
        "Artist Songs"
      ) as Song[];
    } catch (error) {
      console.error("getArtistSongs failed:", error);
      throw error;
    }
  },

  // Albums API methods
  async getAlbums(this: ApiClient): Promise<Album[]> {
    try {
      const response = await this.makeRequest<unknown>(
        "GET",
        "/api/media/albums"
      );

      // Handle direct array response (album summaries)
      if (Array.isArray(response)) {
        return musicValidation.parseCollection(
          AlbumSchema,
          response,
          "Album Summaries"
        ) as Album[];
      }

      // Handle wrapped response
      const validatedResponse = musicValidation.validateResponse(
        AlbumListResponseSchema,
        response,
        "Album Summaries"
      );

      return musicValidation.parseCollection(
        AlbumSchema,
        validatedResponse.albums || [],
        "Album Summaries"
      ) as Album[];
    } catch (error) {
      console.error("getAlbums failed:", error);
      throw error;
    }
  },

  async getAlbumTracks(
    this: ApiClient,
    album: string,
    artist?: string
  ): Promise<Song[]> {
    try {
      const params = artist ? { artist } : {};
      const response = await this.makeRequest<unknown>(
        "GET",
        `/api/media/albums/${encodeURIComponent(album)}/tracks`,
        { params }
      );

      // Use graceful collection parsing
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
    } catch (error) {
      console.error("getAlbumTracks failed:", error);
      throw error;
    }
  },

  // Playlists API methods
  async getPlaylists(this: ApiClient, limit?: number): Promise<Playlist[]> {
    try {
      const params = limit ? { limit } : {};
      const response = await this.makeRequest<unknown>(
        "GET",
        "/api/media/playlists",
        { params }
      );

      // Use graceful collection parsing
      const validatedResponse = musicValidation.validateResponse(
        PlaylistListResponseSchema,
        response,
        "Playlists"
      );

      return musicValidation.parseCollection(
        PlaylistSchema,
        validatedResponse.playlists || [],
        "Playlists"
      ) as Playlist[];
    } catch (error) {
      console.error("getPlaylists failed:", error);
      throw error;
    }
  },

  async getPlaylistSongs(this: ApiClient, playlistId: string): Promise<Song[]> {
    try {
      const response = await this.makeRequest<unknown>(
        "GET",
        `/api/media/playlists/${playlistId}/songs`
      );

      // Use graceful collection parsing
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
    } catch (error) {
      console.error("getPlaylistSongs failed:", error);
      throw error;
    }
  },

  async createPlaylist(
    this: ApiClient,
    request: CreatePlaylistRequest
  ): Promise<Playlist> {
    try {
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
    } catch (error) {
      console.error("createPlaylist failed:", error);
      throw error;
    }
  },

  async updatePlaylist(
    this: ApiClient,
    playlistId: string,
    request: UpdatePlaylistRequest
  ): Promise<Playlist> {
    try {
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
    } catch (error) {
      console.error("updatePlaylist failed:", error);
      throw error;
    }
  },

  async addSongsToPlaylist(
    this: ApiClient,
    playlistId: string,
    songIds: string[]
  ): Promise<void> {
    try {
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
    } catch (error) {
      console.error("addSongsToPlaylist failed:", error);
      throw error;
    }
  },

  async removeSongsFromPlaylist(
    this: ApiClient,
    playlistId: string,
    songIds: string[]
  ): Promise<void> {
    try {
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
    } catch (error) {
      console.error("removeSongsFromPlaylist failed:", error);
      throw error;
    }
  },

  async deletePlaylist(this: ApiClient, playlistId: string): Promise<void> {
    try {
      await this.makeRequest<unknown>(
        "DELETE",
        `/api/media/playlists/${playlistId}`
      );
    } catch (error) {
      console.error("deletePlaylist failed:", error);
      throw error;
    }
  },

  async getPlaylistSummaries(this: ApiClient): Promise<any[]> {
    try {
      const response = await this.makeRequest<unknown>(
        "GET",
        "/api/media/playlists/summaries"
      );

      // This endpoint returns playlist summaries with additional info
      return response as any[];
    } catch (error) {
      console.error("getPlaylistSummaries failed:", error);
      throw error;
    }
  },
};
