// data source abstractions for music library
// supports local (indexeddb/opfs) and remote (server) sources

import type { Song, ImageMetadata } from "../services/storage/types";

// re-export for convenience
export type { Song, ImageMetadata };

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

// genre reference with id and name
export interface GenreRef {
  id: string;
  name: string;
}

// clean entity URL type for app use (adapter filters out incomplete entries)
export interface EntityUrl {
  id: string;
  name?: string;
  url: string;
}

// album summary data for grids
export interface AlbumSummary {
  album_id: string;
  title: string;
  artist_id: string;
  artist_name: string;
  album_type: string;
  year?: number;
  release_date?: string;
  label?: string;
  genres?: GenreRef[];
  song_count: number;
  total_duration: number;
  images?: ImageMetadata[];
  urls?: EntityUrl[];
  is_favorite?: boolean;
  user_rating?: number;
  tags?: string[];
  created_at?: number;
  updated_at?: number;
  created_by_username?: string;
  updated_by_username?: string;
}

// artist summary data for lists
export interface ArtistSummary {
  artist_id: string;
  name: string;
  bio?: string | null;
  album_count: number;
  song_count: number;
  total_duration: number;
  images?: ImageMetadata[];
  urls?: EntityUrl[];
  is_favorite?: boolean;
  user_rating?: number;
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
  images?: ImageMetadata[];
  urls?: EntityUrl[];
  song_count: number;
  created_at: number;
  updated_at: number;
  is_favorite?: boolean;
  created_by_id?: string | null;
}

// favorite target type for mutations
export type FavoriteTarget = "song" | "album" | "artist" | "playlist";

// favorite item - discriminated union of all favoritable types
export type FavoriteItem =
  | { type: "song"; favorited_at: number; data: Song }
  | { type: "album"; favorited_at: number; data: AlbumSummary }
  | { type: "artist"; favorited_at: number; data: ArtistSummary }
  | { type: "playlist"; favorited_at: number; data: PlaylistSummary };

// request params for listing favorites
export interface ListFavoritesParams {
  target_type?: FavoriteTarget;
  limit?: number;
  offset?: number;
}

// search suggestion types
export type SuggestionType =
  | "artist"
  | "album"
  | "song"
  | "genre"
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
  genres: string[];
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
  getSongsByIds?(ids: string[]): Promise<Song[]>;

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
      entity_urls?: Array<{ id?: string | null; name?: string | null; url: string }>;
    },
  ): Promise<PlaylistSummary>;
  deletePlaylist?(playlistId: string): Promise<void>;
  deleteSong?(songId: string): Promise<void>;
  deleteAlbum?(albumId: string): Promise<void>;
  deleteArtist?(artistId: string): Promise<void>;
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

  // favorites (optional - remote only initially)
  listFavorites?(
    params?: ListFavoritesParams,
  ): Promise<PaginatedResponse<FavoriteItem>>;

  // mutations (optional - not all sources support all mutations)
  setFavorite?(params: {
    targetType: FavoriteTarget;
    targetId: string;
    isFavorite: boolean;
  }): Promise<void>;

  setRating?(params: {
    targetType: "song" | "album" | "artist";
    targetId: string;
    rating: number; // 0-5, where 0 means remove rating
  }): Promise<void>;

  updateArtist?(params: {
    artist_id: string;
    name?: string;
    bio?: string;
    entity_urls?: Array<{ id?: string | null; name?: string | null; url: string }>;
  }): Promise<void>;

  updateAlbum?(params: {
    album_id: string;
    title?: string | null;
    artist_id?: string | null;
    artist_name?: string | null;
    album_type?: string | null;
    release_date?: string | null;
    label?: string | null;
    genre_id?: string | null;
    genre_ids?: string[] | null;
    genres?: string[] | null;
    year?: number;
    entity_urls?: Array<{ id?: string | null; name?: string | null; url: string }> | null;
    merge_into_album_id?: string;
    updated_by?: string | null;
  }): Promise<void>;

  updateSong?(params: {
    song_ids: string[];
    title?: string | null;
    artist?: string | null;
    artist_id?: string | null;
    album?: string | null;
    album_id?: string | null;
    genre?: string | null;
    genre_id?: string | null;
    sub_genre_ids?: string[] | null;
    sub_genres?: string[] | null;
    track_number?: number | null;
    disc_number?: number | null;
    year?: number | null;
    duration?: number | null;
    bpm?: number | null;
    lyrics?: string | null;
    track_artist?: string | null;
    user_id?: string | null;
    updated_by?: string | null;
  }): Promise<void>;

  // tags
  getTags?(): Promise<{ tag_id: string; name: string; created_at: number }[]>;
  addTag?(params: { name: string }): Promise<void>;
  deleteTag?(params: { name: string }): Promise<void>;

  // album tags
  getAlbumTags?(albumId: string): Promise<string[]>;
  addTagsToAlbum?(albumId: string, tagNames: string[]): Promise<void>;
  removeTagsFromAlbum?(albumId: string, tagIds: string[]): Promise<void>;

  // image operations
  uploadImage?(params: {
    file: File;
    entityType: 'song' | 'artist' | 'album' | 'playlist';
    entityId: string;
    isPrimary?: boolean;
  }): Promise<{ blob_id: string; job_id: string }>;

  getEntityImages?(params: {
    entityType: 'song' | 'artist' | 'album' | 'playlist';
    entityId: string;
  }): Promise<string[]>;

  removeImage?(params: {
    entityType: 'song' | 'artist' | 'album' | 'playlist';
    entityId: string;
    blobId: string;
  }): Promise<void>;

  setPrimaryImage?(params: {
    entityType: 'song' | 'artist' | 'album' | 'playlist';
    entityId: string;
    blobId: string;
  }): Promise<void>;

  // permission checks - check if current user can perform action
  // remote sources use API auth metadata, local sources return true
  canDeletePlaylist?(playlist: { created_by_id?: string | null }): boolean;
  canUpdatePlaylist?(playlist: { created_by_id?: string | null }): boolean;
  canDeleteSong?(): boolean;
  canDeleteAlbum?(): boolean;
  canDeleteArtist?(): boolean;

  // listen session operations (remote only — returns undefined for local)
  getListenSession?(sessionId: string): Promise<ListenSession | null>;
  deleteListenSession?(sessionId: string): Promise<void>;

  // musicbrainz operations (remote only — returns undefined for local)
  searchMusicbrainzReleases?(params: {
    artist: string | null;
    release: string | null;
    limit: number | null;
    offset: number | null;
  }): Promise<MbSearchReleasesResponse | null>;
  getMusicbrainzRelease?(mbid: string): Promise<MbReleaseDetail | null>;

  // source metadata
  getSourceInfo(): Promise<{
    type: "local" | "remote";
    name: string;
    song_count: number;
  }>;
}

// feed item types — matches server's snake_case enum
export type FeedItemType =
  | "recent_listen"
  | "recent_favorite"
  | "recent_album"
  | "recent_rating"
  | "recent_playlist"
  | "listen_session"
  | "new_image";

// a single feed event in the activity stream
export interface FeedItem {
  id: string;
  feed_type: FeedItemType;
  song_id: string | null;
  album_id: string | null;
  artist_id: string | null;
  playlist_id: string | null;
  title: string;
  subtitle: string | null;
  images: ImageMetadata[] | null;
  created_at: number;
  user_id: string | null;
  username: string | null;
  play_count: number | null;
  rating: number | null;
  target_type: string | null;
  session_id: string | null;
  session_type: string | null;
  session_status: string | null;
  progress_percent: number | null;
  songs_completed: number | null;
  total_songs: number | null;
  // enrichment fields
  artist_name: string | null;
  album_title: string | null;
  genre: string | null;
  genre_id: string | null;
  year: number | null;
  song_count: number | null;
  total_duration_ms: number | null;
  description: string | null;
  tags: string[] | null;
  is_favorite: boolean;
  // collage images for multi-album listen sessions (up to 4 distinct album covers)
  collage_images: ImageMetadata[] | null;
  // when the entity was originally created (for playlists - to distinguish create vs update)
  entity_created_at: number | null;
}

// paginated feed response
export interface FeedResponse {
  items: FeedItem[];
  total: number;
}

// listen session data from server
export interface ListenSession {
  id: string;
  user_id: string;
  session_type: string;
  entity_id: string | null;
  label: string;
  status: string;
  song_ids: string[];
  total_songs: number;
  songs_completed: number;
  current_song_index: number;
  current_song_position_ms: number | null;
  progress_percent: number | null;
  total_duration_ms: number;
  listened_duration_ms: number;
  created_at: number;
  updated_at: number;
}

// musicbrainz types
export interface MbArtistCredit {
  name: string;
  joinphrase: string | null;
}

export interface MbTrack {
  position: number | null;
  title: string;
  length_ms: number | null;
  artist_credit: MbArtistCredit[];
}

export interface MbMedium {
  position: number | null;
  title: string | null;
  format: string | null;
  tracks: MbTrack[];
  track_count: number;
}

export interface MbCoverArtThumbnails {
  small: string | null;
  large: string | null;
  thumb_250: string | null;
  thumb_500: string | null;
  thumb_1200: string | null;
}

export interface MbCoverArtImage {
  id: string;
  image_url: string;
  thumbnails: MbCoverArtThumbnails | null;
  types: string[];
  front: boolean;
  back: boolean;
  comment: string | null;
}

export interface MbReleaseListItem {
  id: string;
  title: string;
  date: string | null;
  country: string | null;
  status: string | null;
  score: number | null;
  artist_credit: MbArtistCredit[];
  track_count: number;
  has_cover_art: boolean;
  cover_art_url: string | null;
  primary_type: string | null;
  secondary_types: string[];
  label: string | null;
  format: string | null;
  packaging: string | null;
}

export interface MbReleaseDetail {
  id: string;
  title: string;
  date: string | null;
  country: string | null;
  status: string | null;
  artist_credit: MbArtistCredit[];
  media: MbMedium[];
  primary_type: string | null;
  secondary_types: string[];
  has_cover_art: boolean;
  cover_art_url: string | null;
  cover_art_images: MbCoverArtImage[];
  genres: string[];
  label: string | null;
}

export interface MbSearchReleasesResponse {
  results: MbReleaseListItem[];
  count: number;
  offset: number;
}
