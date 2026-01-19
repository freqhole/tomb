// normalized music storage types matching server schema

// source types for songs
export type MusicSourceType = "local" | "downloaded" | "remote";

// ===== ARTISTS TABLE =====
export interface Artist {
  artist_id: string; // uuid
  name: string;
  created_at: number;
  updated_at: number;
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
  created_at: number;
  updated_at: number;
}

// ===== SONGS TABLE =====
export interface Song {
  song_id: string; // uuid
  title: string;
  artist_id: string; // FK to artists (always required)
  album_id: string; // FK to albums
  track_number: number;
  disc_number: number;
  duration_seconds: number;
  year: number | null;
  bpm: number | null;
  key_signature: string | null;
  lyrics: string | null;
  metadata: string | null; // json string for extra metadata
  created_at: number;
  updated_at: number;

  // denormalized for quick access (no lookups needed for display/playback)
  artist_name: string;
  album_title: string;

  // denormalized for album-grouped sorting (songs always grouped by album then disc/track)
  album_added_at: number; // earliest added_at of any song in this album
  album_primary_genre_id: string | null; // most common genre for this album

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

  // remote files: server info (not yet implemented)
  remote_server_id: string | null;
  remote_song_id: string | null;

  // local tracking
  added_at: number;
}

// ===== GENRES TABLE =====
export interface Genre {
  genre_id: string; // uuid
  name: string;
  parent_genre_id: string | null; // for sub-genres
  created_at: number;
}

// ===== PLAYLISTS TABLE =====
export interface Playlist {
  playlist_id: string; // uuid
  title: string;
  description: string | null;
  is_public: boolean;
  thumbnail_blob_id: string | null;
  created_at: number;
  updated_at: number;
}

// ===== PLAYLIST_SONGS TABLE (junction) =====
export interface PlaylistSong {
  playlist_id: string; // FK
  song_id: string; // FK
  position: number; // order in playlist
  added_at: number;
}

// ===== USER DATA TABLES =====

// user favorites (songs, albums, artists)
export interface Favorite {
  target_type: "song" | "album" | "artist";
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
  song: Song;
  artist: Artist;
  album: Album;
  genre: Genre | null;
  is_favorite: boolean;
  rating: number | null;
}

// album with joined artist + genre
export interface AlbumQueryResult {
  album: Album;
  artist: Artist | null;
  genre: Genre | null;
  song_count: number;
  total_duration: number;
  is_favorite: boolean;
  rating: number | null;
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

// database metadata
export const MUSIC_DB_NAME = "freqhole_music";
export const MUSIC_DB_VERSION = 4; // bumped for remotes store

// store names
export const STORE_ARTISTS = "artists";
export const STORE_ALBUMS = "albums";
export const STORE_SONGS = "songs";
export const STORE_GENRES = "genres";
export const STORE_PLAYLISTS = "playlists";
export const STORE_PLAYLIST_SONGS = "playlist_songs";
export const STORE_FAVORITES = "favorites";
export const STORE_RATINGS = "ratings";
export const STORE_REMOTES = "remotes";

// ===== REMOTES TABLE =====
// remote server configurations (no credentials - uses cookies)
export interface Remote {
  remote_id: string; // uuid
  name: string; // user-friendly name (e.g. "home server", "work laptop")
  base_url: string; // server url (e.g. "https://music.example.com")
  is_active: boolean; // currently selected remote
  last_connected_at: number | null; // timestamp of last successful connection
  created_at: number;
  updated_at: number;
}
