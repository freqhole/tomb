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

  // flexible filters (for tag filtering and other dynamic filters)
  include_tags?: string[];
  exclude_tags?: string[];
  [key: string]: any; // allow other filters
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

// image metadata with primary indicator
export interface ImageMetadata {
  blob_id: string;
  is_primary: number; // 0 or 1 from SQLite
}

// album summary data for grids
export interface AlbumSummary {
  album_id: string;
  title: string;
  artist_id: string;
  artist_name: string;
  year?: number;
  song_count: number;
  total_duration: number;
  images?: ImageMetadata[];
  is_favorite?: boolean;
  tags?: string[];
}

// artist summary data for lists
export interface ArtistSummary {
  artist_id: string;
  name: string;
  album_count: number;
  song_count: number;
  total_duration: number;
  images?: ImageMetadata[];
  is_favorite?: boolean;
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
  is_favorite?: boolean;
}

// search suggestion types
export type SuggestionType =
  | "artist"
  | "album"
  | "song"
  | "genre"
  | "subgenre"
  | "playlist";

export interface SearchSuggestion {
  value: string;
  display: string;
  highlight: string;
  count: number;
  suggestion_type?: SuggestionType;
  confidence: number;
  metadata?: any;
  entity_id: string;
  is_favorite: boolean;
}

export interface SuggestionsResponse {
  suggestions: SearchSuggestion[];
  query_time_ms: number;
  total_count: number;
  page: number;
  page_size: number;
  total_pages: number;
  has_next: boolean;
  has_prev: boolean;
}

// search result types
export interface SearchSongResult {
  id: string;
  title: string;
  artist_names: string[];
  album_title?: string | null;
  album_id?: string | null;
  duration?: number | null;
  thumbnail_url?: string | null;
  user_rating?: number | null;
  is_favorite: boolean;
  search_rank: number;
  match_type: string;
  highlight?: string | null;
}

export interface SearchArtistResult {
  id: string;
  name: string;
  song_count: number;
  album_count: number;
  genres: string[];
  user_rating?: number | null;
  is_favorite: boolean;
  search_rank: number;
  highlight?: string | null;
}

export interface SearchAlbumResult {
  id: string;
  title: string;
  artist_names: string[];
  genre?: string | null;
  sub_genres: string[];
  song_count: number;
  thumbnail_url?: string | null;
  user_rating?: number | null;
  is_favorite: boolean;
  search_rank: number;
  highlight?: string | null;
}

export interface SearchGenreResult {
  genre: string;
  genre_id: string;
  sub_genres: string[];
  song_count: number;
  artist_count: number;
  representative_song_id?: string | null;
  representative_thumbnail?: string | null;
  avg_rating?: number | null;
  search_rank: number;
}

export interface SearchPlaylistResult {
  id: string;
  title: string;
  description?: string | null;
  song_count: number;
  is_public: boolean;
  created_by: string;
  thumbnail_url?: string | null;
  search_rank: number;
  highlight?: string | null;
}

export interface SearchResponse {
  songs: SearchSongResult[];
  artists?: SearchArtistResult[] | null;
  albums?: SearchAlbumResult[] | null;
  genres?: SearchGenreResult[] | null;
  playlists?: SearchPlaylistResult[] | null;
  total_count: number;
  page: number;
  page_size: number;
  total_pages: number;
  has_next: boolean;
  has_prev: boolean;
  query_time_ms: number;
  applied_filters?: any | null;
  sort_applied?: string | null;
}

export type SearchField =
  | "all"
  | "artists"
  | "albums"
  | "songs"
  | "genres"
  | "playlists";

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

  // search (optional - remote only initially)
  searchSuggestions?(params: {
    field: SearchField;
    partial: string;
    page?: number;
    page_size?: number;
  }): Promise<SuggestionsResponse>;

  search?(params: {
    query: string;
    field?: SearchField | null;
    page?: number;
    page_size?: number;
  }): Promise<SearchResponse>;

  // source metadata
  getSourceInfo(): Promise<{
    type: "local" | "remote";
    name: string;
    song_count: number;
  }>;
}
