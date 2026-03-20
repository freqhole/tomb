// normalized music storage types matching server schema

// source types for songs
export type MusicSourceType = "local" | "downloaded" | "remote";

// image metadata with source-specific fields
export interface ImageMetadata {
  local_blob_id?: string; // for local/downloaded images
  remote_blob_id?: string; // server blob ID (from API)
  remote_url?: string; // for remote images (already includes base URL)
  remote_server_id?: string; // which remote server this image is from (for P2P resolution)
  is_primary: boolean; // primary/featured image
  blob_type: 'thumbnail' | 'waveform' | 'original' | 'preview'; // image type
}

// ===== ARTISTS TABLE =====
export interface Artist {
  artist_id: string; // uuid
  name: string;
  bio?: string | null;
  images?: ImageMetadata[]; // artist images
  urls?: Array<{ id?: string; name?: string; url: string }>; // entity URLs
  created_at: number;
  updated_at: number;
  // user-specific fields (from query views)
  is_favorite?: boolean;
  user_rating?: number;
}

// ===== ALBUMS TABLE =====
export interface Album {
  album_id: string; // uuid
  title: string;
  artist_id: string | null; // null for compilations/various artists
  album_type: string; // "album", "single", "compilation", etc
  release_date: string | null; // ISO date string
  release_date_precision: string | null; // "day", "month", "year"
  label: string | null;
  genre_id: string | null; // FK to genres
  year: number | null;
  images?: ImageMetadata[]; // album images (artwork, etc)
  urls?: Array<{ id?: string; name?: string; url: string }>; // entity URLs
  created_at: number;
  updated_at: number;
  // user-specific fields (from query views)
  is_favorite?: boolean;
  user_rating?: number;
}

// genre reference with id and name (from album's genres array)
export interface GenreRef {
  id: string;
  name: string;
}

// ===== SONGS TABLE =====
export interface Song {
  /** local database primary key (auto-increment converted to string) */
  id: string;
  /** content hash of audio file - 64 hex chars, universal deduplication identifier */
  sha256: string;
  /** server's short blob ID (16 hex chars) - used for analytics FK constraints */
  media_blob_id?: string;
  title: string;
  artist_id: string; // FK to artists (always required)
  album_id: string; // FK to albums
  track_number: number;
  disc_number: number;
  duration_seconds: number;
  year: number | null;
  bpm: number | null;
  track_artist: string | null; // per-track artist for compilation albums
  lyrics: string | null;
  metadata: string | null; // json string for extra metadata
  created_at: number;
  updated_at: number;
  created_by_username?: string;
  updated_by_username?: string;

  // denormalized for quick access (no lookups needed for display/playback)
  artist_name: string;
  album_title: string;
  album_type?: string; // "album", "single", "compilation" — from joined album data
  images?: ImageMetadata[]; // song images (constructed by data source)
  urls?: Array<{ id?: string; name?: string; url: string }>; // entity URLs

  // denormalized for album-grouped sorting (songs always grouped by album then disc/track)
  album_added_at: number; // earliest added_at of any song in this album
  album_primary_genre_id: string | null; // most common genre for this album
  album_primary_genre_name?: string | null; // genre name for display

  // user-specific metadata (from current authenticated user)
  is_favorite?: boolean; // whether user has favorited this song
  user_rating?: number; // user's rating (1-5)
  album_is_favorite?: boolean; // whether user has favorited the album this song belongs to
  album_rating?: number; // user's rating for the album this song belongs to (1-5)
  album_tags?: string[]; // tags applied to the album this song belongs to
  album_genres?: GenreRef[]; // genres for the album this song belongs to (array with id+name)
  album_images?: ImageMetadata[]; // images associated with the album this song belongs to

  // source information
  source_type: MusicSourceType;

  // local/downloaded files: audio stored in opfs
  opfs_path: string | null;
  file_name: string | null;
  file_size: number | null;
  last_modified: number | null; // original file timestamp
  mime_type: string | null;

  // downloaded files: original source url
  source_url: string | null;
  downloaded_at: number | null;

  // remote files: server info
  /** which remote server this song came from (for P2P resolution) */
  remote_server_id: string | null;
  /** server's song.id that this was downloaded from (for sync tracking) */
  remote_song_id: string | null;
  /** blake3 content hash (64 hex chars) for iroh-blobs verified streaming */
  blake3: string | null;

  // local tracking
  added_at: number;

  // queue tracking - assigned when song is added to queue (for progress tracking)
  queue_entry_id?: string;
  // max progress reached (0-1) for visual fill in queue sidebar
  queue_max_progress?: number;
}

// song before insertion (no id - will be auto-generated by IDB)
export type NewSong = Omit<Song, 'id'>;

// ===== GENRES TABLE =====
export interface Genre {
  genre_id: string; // uuid
  name: string;
  created_at: number;
}

// ===== PLAYLISTS TABLE =====
export interface Playlist {
  playlist_id: string; // uuid
  title: string;
  description: string | null;
  is_public: boolean;
  images?: ImageMetadata[]; // playlist images
  urls?: Array<{ id?: string; name?: string; url: string }>; // entity URLs
  created_at: number;
  updated_at: number;
  created_by_id?: string | null; // user who created the playlist
  // sync fields for remote playlists
  source_type?: "local" | "remote"; // undefined for legacy, defaults to "local"
  source_remote_id?: string | null; // remote playlist id
  source_remote_url?: string | null; // base url of remote server
  source_etag?: string | null; // last known etag for sync
  last_synced_at?: number | null; // timestamp of last sync
  is_editable?: boolean; // false for synced playlists, defaults to true
  // user-specific fields (from query views)
  is_favorite?: boolean;
  user_rating?: number;
}

// ===== PLAYLIST_SONGS TABLE (junction) =====
export interface PlaylistSong {
  playlist_id: string; // FK to playlists
  song_id: string; // FK to songs.id
  position: number; // order in playlist
  added_at: number;
}

// ===== USER DATA TABLES =====

// user favorites (songs, albums, artists, playlists)
export interface Favorite {
  target_type: "song" | "album" | "artist" | "playlist";
  target_id: string;
  favorited_at: number;
}

// user ratings (songs, albums, artists)
export interface Rating {
  target_type: "song" | "album" | "artist";
  target_id: string;
  rating: number; // 1-5
  created_at: number;
}

// ===== QUERY RESULT TYPES (denormalized for display) =====

// song with joined artist + album + genre
export interface SongQueryResult {
  song: Song; // song object already has is_favorite and user_rating populated
  artist: Artist;
  album: Album;
  genre: Genre | null;
}

// album with aggregated stats and runtime-augmented fields
export interface AlbumQueryResult {
  album: Album;
  artist_name: string;
  song_count: number;
  total_duration: number;
  genres?: GenreRef[];
}

// artist with aggregated stats
export interface ArtistQueryResult {
  artist: Artist;
  song_count: number;
  album_count: number;
  total_duration: number;
  is_favorite: boolean;
  rating: number | null;
}

// ===== AGGREGATION TYPES (for query helpers) =====

// tag
export interface Tag {
  tag_id: string; // uuid
  name: string; // unique tag name
  created_at: number;
}

// album tag junction (many-to-many)
export interface AlbumTag {
  album_id: string;
  tag_id: string;
  created_at: number;
}

// album aggregation with song counts and durations
export interface AlbumWithStats {
  album: Album;
  artist_name: string;
  song_count: number;
  total_duration: number;
}

// artist aggregation with album/song counts and durations
export interface ArtistWithStats {
  artist: Artist;
  album_count: number;
  song_count: number;
  total_duration: number;
}

// genre aggregation with album/song counts
export interface GenreWithStats {
  genre: Genre;
  album_count: number;
  song_count: number;
}

// database metadata
export const MUSIC_DB_NAME = "freqhole_music";
export const MUSIC_DB_VERSION = 11;

// store names
export const STORE_ARTISTS = "artists";
export const STORE_ALBUMS = "albums";
export const STORE_SONGS = "songs";
export const STORE_GENRES = "genres";
export const STORE_PLAYLISTS = "playlists";
export const STORE_PLAYLIST_SONGS = "playlist_songs";
export const STORE_FAVORITES = "favorites";
export const STORE_RATINGS = "ratings";
export const STORE_TAGS = "tags";
export const STORE_ALBUM_TAGS = "album_tags";
