// normalized music storage types matching server schema

// source types for songs
export type MusicSourceType = "local" | "downloaded" | "synced" | "remote";

// image metadata with source-specific fields
export interface ImageMetadata {
  local_blob_id?: string; // for local/downloaded images
  remote_blob_id?: string; // server blob ID (from API)
  remote_url?: string; // for remote images (already includes base URL)
  remote_server_id?: string; // which remote server this image is from (for P2P resolution)
  // raw opfs file path (e.g. "video-posters/id.jpg") for an auto-extracted
  // local video thumbnail — these have no blob-store entry at all (see
  // video/services/opfs/helpers.ts's readVideoPosterFromOPFS), unlike
  // every other local image source above.
  local_opfs_path?: string;
  is_primary: boolean; // primary/featured image
  blob_type: "thumbnail" | "waveform" | "original" | "preview" | "rendition" | "subtitle"; // image type
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

// taxon reference (cross-kind label: genre, label, mood, era, region, ...)
export interface TaxonRef {
  id: string;
  kind_slug: string;
  label: string;
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

  // sync behavior flags
  skip_feed_events?: boolean; // skip album feed events when syncing (e.g., songs from playlist queue)

  // user-specific metadata (from current authenticated user)
  is_favorite?: boolean; // whether user has favorited this song
  user_rating?: number; // user's rating (1-5)
  album_is_favorite?: boolean; // whether user has favorited the album this song belongs to
  album_rating?: number; // user's rating for the album this song belongs to (1-5)
  album_tags?: string[]; // tags applied to the album this song belongs to
  album_taxons?: TaxonRef[]; // every taxon linked to this song's album, across all kinds (filter by kind_slug==='genre' for genres)
  album_images?: ImageMetadata[]; // images associated with the album this song belongs to
  artist_images?: ImageMetadata[]; // images associated with the artist this song belongs to

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

  // analytics: total play events recorded server-side (null when unknown / local-only)
  play_count?: number | null;

  // queue tracking - assigned when song is added to queue (for progress tracking)
  queue_entry_id?: string;
  // max progress reached (0-1) for visual fill in queue sidebar
  queue_max_progress?: number;

  // playlist item tracking - only set when returned from a playlist's
  // song listing, reflects this song's shared position/added_at in that
  // playlist's playlist_itemz row (comparable across song AND video
  // items in the same playlist, for merge-sorted interleaved ordering)
  playlist_item_position?: number;
  playlist_item_added_at?: number;
}

// song before insertion (no id - will be auto-generated by IDB)
export type NewSong = Omit<Song, "id">;

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
  // user-specific fields (from query views)
  is_favorite?: boolean;
  user_rating?: number;
  // analytics: total initiated plays for this playlist
  play_count?: number | null;
  // total song count (denormalized from queries)
  song_count?: number;
  // total video count (denormalized; undefined when the source doesn't report it)
  video_count?: number;
}

// ===== PLAYLIST_ITEMS TABLE (junction, unified across entity types) =====
// local-storage counterpart to the server's generic `playlist_itemz`
// table - one shared position space per playlist across every entity
// type it can hold (song, video, ...), so a playlist's songs and videos
// can be freely interleaved/drag-reordered together, without a remote
// connection. replaces the old split PlaylistSong / PlaylistVideoItem
// stores.
export type PlaylistItemEntityType = "song" | "video";

export interface PlaylistItem {
  playlist_id: string; // FK to playlists
  entity_type: PlaylistItemEntityType;
  entity_id: string; // song sha256 (entity_type=song) or video id (entity_type=video)
  position: number; // shared order across all entity types in the playlist
  added_at: number;
}

// ===== USER DATA TABLES =====

// user favorites (songs, albums, artists, playlists, videos, video series)
export interface Favorite {
  target_type: "song" | "album" | "artist" | "playlist" | "video" | "video_series";
  target_id: string;
  favorited_at: number;
}

// user ratings (songs, albums, artists, videos)
export interface Rating {
  target_type: "song" | "album" | "artist" | "video";
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
  taxons?: TaxonRef[];
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
export const MUSIC_DB_VERSION = 18;

// store names
export const STORE_ARTISTS = "artists";
export const STORE_ALBUMS = "albums";
export const STORE_SONGS = "songs";
export const STORE_GENRES = "genres";
export const STORE_PLAYLISTS = "playlists";
export const STORE_PLAYLIST_ITEMS = "playlist_items";
export const STORE_FAVORITES = "favorites";
export const STORE_RATINGS = "ratings";
export const STORE_TAGS = "tags";
export const STORE_ALBUM_TAGS = "album_tags";
export const STORE_TAXONS = "taxons";
export const STORE_ALBUM_TAXONS = "album_taxons";
export const STORE_ENTITY_TAXONS = "entity_taxons";
export const STORE_TAXON_KINDS = "taxon_kinds";

// sentinel `remote_id` used in `taxons` / `album_taxons` rows to mark
// entries that belong to the local indexeddb library. matches
// `LOCAL_REMOTE_ID` in `library/views/graph/CrossRemoteTopNavSearch.tsx`
// and the `"local"` sentinel used by `music/utils/routing.ts::buildRouteFor`.
export const LOCAL_TAXON_REMOTE_ID = "local";

// ===== TAXONS TABLE =====
// a taxon is any cross-kind label attached to an album: genre, mood,
// era, region, label, style, tag, ... each taxon row is scoped to the
// remote that owns it (peer-cached taxons keep their source remote_id
// so we never confuse a peer's "jazz" with a local one).
export interface TaxonRow {
  /** stable id from the source library. for local taxons we generate
   *  a uuid; for peer-cached taxons we use the peer's id verbatim. */
  taxon_id: string;
  /** owning library: `LOCAL_TAXON_REMOTE_ID` for local, otherwise the
   *  remote_id from `Remote.remote_id`. */
  remote_id: string;
  /** kind discriminator (`"genre"`, `"mood"`, `"era"`, ...). */
  kind_slug: string;
  /** human display label. */
  label: string;
  /** url-safe slug of `label` for dedup lookups within
   *  `(remote_id, kind_slug)`. produced via `nodeIds.slug`. */
  slug: string;
  created_at: number;
  updated_at: number;
}

// ===== ALBUM_TAXONS JUNCTION =====
// album <-> taxon many-to-many. `remote_id` is denormalized from the
// taxon for cheap by-remote scans (clearing a peer's mirror, etc.).
export interface AlbumTaxonRow {
  album_id: string;
  taxon_id: string;
  remote_id: string;
  created_at: number;
}

// ===== ENTITY_TAXONS JUNCTION (generic) =====
// entity <-> taxon many-to-many for any entity type (video today; album
// keeps using its own dedicated `AlbumTaxonRow`/`STORE_ALBUM_TAXONS`
// above rather than migrating onto this - this is purely additive so
// album behavior is unaffected). mirrors `STORE_FAVORITES`'s already-
// generic `[target_type, target_id]` keying pattern.
export interface EntityTaxonRow {
  entity_type: string;
  entity_id: string;
  taxon_id: string;
  remote_id: string;
  created_at: number;
}

// ===== TAXON_KINDS TABLE (local, explicit kind creation) =====
// a locally-created taxon kind's own metadata (label/color/etc.), scoped
// by domain so a kind created for "video" doesn't leak into "music"'s
// listing. distinct from a kind_slug merely *appearing* because some
// taxon value already uses it (see `resolveKindSlugsForDomain` in
// `localTaxonomyClient.ts`) - this store exists so a kind can be created
// with real metadata before any value is ever added under it.
export interface TaxonKindRow {
  kind_slug: string;
  domain: string;
  label: string;
  description: string | null;
  color: string | null;
  value_type: string;
  unit: string | null;
  display_order: number;
  created_at: number;
}
