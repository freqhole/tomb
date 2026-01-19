// data source abstractions for music library
// supports local (indexeddb/opfs) and remote (server) sources

import type { Song } from "../services/storage/types";

// query parameters for listing/filtering
export interface QueryParams {
  // pagination
  limit?: number;
  offset?: number;

  // sorting
  sort_by?: string;
  sort_direction?: "asc" | "desc";

  // filtering
  search?: string;
  artist_id?: string;
  album_id?: string;
  genre_id?: string;
}

// paginated response wrapper
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
  has_more: boolean;
}

// re-export storage Song type (no translation needed)
export type { Song };

// album summary data for grids
export interface AlbumSummary {
  album_id: string;
  title: string;
  artist_id: string;
  artist_name: string;
  year?: number;
  song_count: number;
  total_duration: number;
}

// artist summary data for lists
export interface ArtistSummary {
  artist_id: string;
  name: string;
  album_count: number;
  song_count: number;
  total_duration: number;
}

// genre summary data for lists
export interface GenreSummary {
  genre_id: string;
  name: string;
  album_count: number;
  song_count: number;
}

// playlist summary data for lists
export interface PlaylistSummary {
  playlist_id: string;
  title: string;
  description: string | null;
  is_public: boolean;
  thumbnail_blob_id: string | null;
  song_count: number;
  created_at: number;
  updated_at: number;
}

// main data source interface
// both local and remote sources implement this
export interface MusicDataSource {
  // songs
  getSongs(params?: QueryParams): Promise<PaginatedResponse<Song>>;
  getSongById(id: string): Promise<Song | null>;

  // albums (optional - may aggregate from songs)
  getAlbums?(params?: QueryParams): Promise<PaginatedResponse<AlbumSummary>>;
  getAlbumSongs?(
    albumId: string,
    params?: QueryParams,
  ): Promise<PaginatedResponse<Song>>;

  // artists (optional - may aggregate from songs)
  getArtists?(params?: QueryParams): Promise<PaginatedResponse<ArtistSummary>>;
  getArtistSongs?(
    artistId: string,
    params?: QueryParams,
  ): Promise<PaginatedResponse<Song>>;

  // genres (optional - may aggregate from albums/songs)
  getGenres?(params?: QueryParams): Promise<PaginatedResponse<GenreSummary>>;
  getGenreSongs?(
    genreId: string,
    params?: QueryParams,
  ): Promise<PaginatedResponse<Song>>;

  // playlists (optional)
  getPlaylists?(
    params?: QueryParams,
  ): Promise<PaginatedResponse<PlaylistSummary>>;
  getPlaylistSongs?(
    playlistId: string,
    params?: QueryParams,
  ): Promise<PaginatedResponse<Song>>;
  createPlaylist?(params: {
    title: string;
    description?: string | null;
    is_public?: boolean;
  }): Promise<PlaylistSummary>;
  updatePlaylist?(
    playlistId: string,
    params: {
      title?: string | null;
      description?: string | null;
      is_public?: boolean | null;
      thumbnail_blob_id?: string | null;
    },
  ): Promise<PlaylistSummary>;
  deletePlaylist?(playlistId: string): Promise<void>;
  addSongsToPlaylist?(playlistId: string, songIds: string[]): Promise<void>;
  removeSongsFromPlaylist?(
    playlistId: string,
    songIds: string[],
  ): Promise<void>;
  reorderPlaylistSongs?(
    playlistId: string,
    songIds: string[],
    newPosition: number,
  ): Promise<void>;

  // source metadata
  getSourceInfo(): Promise<{
    type: "local" | "remote";
    name: string;
    song_count: number;
  }>;
}
