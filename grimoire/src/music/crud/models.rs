//! models for compound music operations
//! request/response types for high-level workflows

use crate::Bytes;
use serde::{Deserialize, Serialize};
use zod_gen::ZodSchema as ZodSchemaTrait;
use zod_gen_derive::ZodSchema;

use crate::media_blobz::MediaBlob;
use crate::music::entities::{
    albums::Album,
    artists::Artist,
    genres::{Genre, SubGenre},
    songs::Song,
};
use crate::music::users::models::RatingTarget;

/// request for importing a song with all metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportSongRequest {
    pub media_blob_id: String,
    pub title: String,
    pub artist_name: Option<String>,
    pub album_title: Option<String>,
    pub genre_name: Option<String>,
    pub track_number: i64,
    pub disc_number: i64,
    pub duration: Option<i64>,
    pub year: Option<i64>,
    pub bpm: Option<i64>,
    pub key_signature: Option<String>,
    pub metadata: Option<String>,
    pub lyrics: Option<String>,
    pub created_by: Option<String>,
    pub is_compilation: bool,
}

/// result of importing a song with metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportSongResult {
    pub song: Song,
    pub artist: Option<Artist>,
    pub album: Option<Album>,
    pub genre: Option<Genre>,
    pub created_new_artist: bool,
    pub created_new_album: bool,
    pub created_new_genre: bool,
}

/// request for creating song with guaranteed artist and album
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateSongWithMetadataRequest {
    pub media_blob_id: String,
    pub title: String,
    pub artist_name: String, // required
    pub album_title: String, // required
    pub genre_name: Option<String>,
    pub track_number: i64,
    pub disc_number: i64,
    pub duration: Option<i64>,
    pub year: Option<i64>,
    pub created_by: Option<String>,
}

/// request for creating/updating an artist during import
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArtistImportRequest {
    pub name: String,
    pub created_by: Option<String>,
}

/// request for creating/updating an album during import
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlbumImportRequest {
    pub title: String,
    pub album_type: Option<String>,
    pub release_date: Option<String>,
    pub release_date_precision: Option<String>,
    pub label: Option<String>,
    pub genre_id: Option<String>,
    pub year: Option<i64>,
    pub created_by: Option<String>,
}

/// result of importing an album with metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlbumImportResult {
    pub album: Album,
    pub songs: Vec<Song>,
    pub artist: Option<Artist>,
    pub genre: Option<Genre>,
    pub created_new_artist: bool,
    pub created_new_album: bool,
    pub created_new_genre: bool,
    pub songs_added: usize,
}

/// request for bulk importing multiple songs
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BulkImportRequest {
    pub songs: Vec<ImportSongRequest>,
    pub continue_on_error: bool,
    pub created_by: Option<String>,
}

/// result of bulk importing songs
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BulkImportResult {
    pub successful_imports: Vec<ImportSongResult>,
    pub failed_imports: Vec<SongImportError>,
    pub summary: BulkImportSummary,
}

/// summary statistics for bulk import
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BulkImportSummary {
    pub total_songs: usize,
    pub successful_songs: usize,
    pub failed_songs: usize,
    pub new_artists_created: usize,
    pub new_albums_created: usize,
    pub new_genres_created: usize,
    pub duration_ms: u64,
}

/// errors that can occur during song import
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SongImportError {
    pub request: ImportSongRequest,
    pub error: String,
    pub error_type: SongImportErrorType,
}

/// categories of import errors
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SongImportErrorType {
    MediaBlobNotFound,
    DuplicateSong,
    ArtistCreationFailed,
    AlbumCreationFailed,
    GenreCreationFailed,
    SongCreationFailed,
    RelationshipCreationFailed,
    ValidationError,
    DatabaseError,
}

/// unified query parameters for all entity queries
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, clap::Parser)]
pub struct QueryParams {
    /// Full-text search query
    #[arg(long)]
    pub q: Option<String>,

    /// Which fields to search (comma-separated: title,artist,album)
    #[arg(long, value_delimiter = ',')]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub search_fields: Option<Vec<String>>,

    /// Flexible filters as JSON (not exposed as CLI arg - use specific filters instead)
    #[arg(skip)]
    #[serde(default)]
    pub filters: std::collections::HashMap<String, serde_json::Value>,

    /// Sort field name
    #[arg(long)]
    pub sort_by: Option<String>,

    /// Sort direction (asc or desc)
    #[arg(long)]
    pub sort_direction: Option<String>,

    /// Maximum number of results
    #[arg(long, default_value = "50")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<u32>,

    /// Offset for pagination
    #[arg(long, default_value = "0")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset: Option<u32>,

    /// User ID for user-specific data
    #[arg(long)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_id: Option<String>,

    /// Filter to only favorited items (requires user_id)
    #[arg(long)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub favorites_only: Option<bool>,

    /// Filter to only items rated >= this value (requires user_id)
    #[arg(long)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_rating: Option<i32>,
}

impl Default for QueryParams {
    fn default() -> Self {
        Self {
            q: None,
            search_fields: None,
            filters: std::collections::HashMap::new(),
            sort_by: None,
            sort_direction: Some("asc".to_string()),
            limit: Some(50),
            offset: Some(0),
            user_id: None,
            favorites_only: None,
            min_rating: None,
        }
    }
}

/// unified query result with pagination metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryResult<T> {
    pub items: Vec<T>,
    pub total_count: i64,
    pub has_more: bool,
    pub offset: i64,
    pub limit: i64,
    pub query_time_ms: Option<u64>,
}

impl<T> QueryResult<T> {
    pub fn new(items: Vec<T>, total_count: i64, offset: u32, limit: u32) -> Self {
        let has_more = (offset as i64 + limit as i64) < total_count;
        Self {
            items,
            total_count,
            has_more,
            offset: offset as i64,
            limit: limit as i64,
            query_time_ms: None,
        }
    }
}

/// song with optional related data for query results
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct SongQueryResult {
    pub song: Song,
    pub artist: Option<Artist>,
    pub album: Option<Album>,
    pub genre: Option<Genre>,
    pub media_blob: Option<MediaBlob>,
    pub relevance_score: Option<f64>,   // For FTS search results
    pub snippet: Option<String>,        // Highlighted text snippet for FTS
    pub is_favorite: Option<bool>,      // User's favorite status
    pub rating: Option<i32>,            // User's rating (1-5)
    pub favorited_at: Option<i64>,      // When user favorited (unix timestamp)
    pub rating_created_at: Option<i64>, // When user rated (unix timestamp)
    pub artist_total_song_count: Option<i64>, // Total songs by this artist
    pub artist_total_album_count: Option<i64>, // Total albums by this artist
    pub artist_total_duration: Option<i64>, // Total duration of artist's music
}

/// artist with aggregated metadata for query results
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct ArtistQueryResult {
    pub artist: Artist,
    pub song_count: i64,
    pub album_count: i64,
    pub total_duration: Option<i64>,
    pub is_favorite: Option<bool>,      // User's favorite status
    pub rating: Option<i32>,            // User's rating (1-5)
    pub favorited_at: Option<i64>,      // When user favorited (unix timestamp)
    pub rating_created_at: Option<i64>, // When user rated (unix timestamp)
}

/// album with aggregated metadata for query results
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct AlbumQueryResult {
    pub album: Album,
    pub artist: Option<Artist>,
    pub genre: Option<Genre>,
    pub is_favorite: Option<bool>,      // User's favorite status
    pub rating: Option<i32>,            // User's rating (1-5)
    pub favorited_at: Option<i64>,      // When user favorited (unix timestamp)
    pub rating_created_at: Option<i64>, // When user rated (unix timestamp)
}

/// genre with optional aggregated metadata for query results
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct GenreQueryResult {
    pub genre: Genre,
    pub song_count: Option<i64>,   // Could be computed if needed
    pub album_count: Option<i64>,  // Could be computed if needed
    pub is_favorite: Option<bool>, // User's favorite status (no ratings for genres)
    pub favorited_at: Option<i64>, // When user favorited (unix timestamp)
}

/// playlist with optional aggregated metadata for query results
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct PlaylistQueryResult {
    pub playlist: crate::music::Playlist,
    pub song_count: i64,
    pub total_duration: Option<i64>,
    pub is_favorite: Option<bool>, // User's favorite status (no ratings for playlists)
}

/// song within a playlist context, with playlist-specific metadata
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct PlaylistSongResult {
    pub details: SongQueryResult,
    pub position: i64, // Position in playlist (for ordering)
    pub added_at: i64, // When song was added to playlist (unix timestamp)
}

/// request for querying playlist songs with metadata
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct QueryPlaylistSongsRequest {
    pub playlist_id: String,
    pub q: Option<String>,
    pub sort_by: Option<String>,
    pub sort_direction: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

/// concrete wrapper for QueryResult<PlaylistQueryResult> for zod codegen
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct PlaylistsQueryResult {
    pub items: Vec<PlaylistQueryResult>,
    pub total_count: i64,
    pub has_more: bool,
    pub offset: i64,
    pub limit: i64,
    pub query_time_ms: Option<u64>,
}

impl From<QueryResult<PlaylistQueryResult>> for PlaylistsQueryResult {
    fn from(qr: QueryResult<PlaylistQueryResult>) -> Self {
        Self {
            items: qr.items,
            total_count: qr.total_count,
            has_more: qr.has_more,
            offset: qr.offset,
            limit: qr.limit,
            query_time_ms: qr.query_time_ms,
        }
    }
}

/// concrete wrapper for QueryResult<PlaylistSongResult> for zod codegen
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct PlaylistSongsQueryResult {
    pub items: Vec<PlaylistSongResult>,
    pub total_count: i64,
    pub has_more: bool,
    pub offset: i64,
    pub limit: i64,
    pub query_time_ms: Option<u64>,
}

impl From<QueryResult<PlaylistSongResult>> for PlaylistSongsQueryResult {
    fn from(qr: QueryResult<PlaylistSongResult>) -> Self {
        Self {
            items: qr.items,
            total_count: qr.total_count,
            has_more: qr.has_more,
            offset: qr.offset,
            limit: qr.limit,
            query_time_ms: qr.query_time_ms,
        }
    }
}

// ============================================================================
// Update Operations - Request/Response Types
// ============================================================================

/// request for updating songs
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, clap::Parser)]
pub struct UpdateSongsRequest {
    /// Song IDs to update
    #[arg(long, value_delimiter = ',')]
    pub song_ids: Vec<String>,

    /// User performing the update (updated_by defaults to this)
    #[arg(long)]
    pub user_id: Option<String>,

    /// Updated by (defaults to user_id)
    #[arg(long)]
    pub updated_by: Option<String>,

    // direct song fields (all optional)
    /// New title
    #[arg(long)]
    pub title: Option<String>,

    #[arg(long)]
    pub track_number: Option<i64>,

    #[arg(long)]
    pub disc_number: Option<i64>,

    #[arg(long)]
    pub duration: Option<i64>,

    #[arg(long)]
    pub year: Option<i64>,

    #[arg(long)]
    pub bpm: Option<i64>,

    #[arg(long)]
    pub key_signature: Option<String>,

    #[arg(long)]
    pub lyrics: Option<String>,

    #[arg(skip)]
    pub metadata: Option<String>,

    // relationship updates
    #[arg(skip)]
    pub artist: Option<UpdateArtistRequest>,

    /// Artist name
    #[arg(long)]
    pub artist_name: Option<String>,

    #[arg(skip)]
    pub album: Option<UpdateAlbumRequest>,

    /// Album title
    #[arg(long)]
    pub album_title: Option<String>,

    #[arg(long)]
    pub album_type: Option<String>,

    #[arg(long)]
    pub release_date: Option<String>,

    #[arg(long)]
    pub label: Option<String>,

    #[arg(long)]
    pub genre: Option<String>,

    #[arg(long)]
    pub sub_genre: Option<String>,

    // thumbnail handling (for songs)
    #[arg(long)]
    pub thumbnail_blob_id: Option<String>,

    #[arg(long)]
    pub thumbnail_from_file: Option<String>,

    #[arg(skip)]
    pub thumbnail_from_bytes: Option<Bytes>,

    // tag operations (album-level)
    /// Tags to add (comma-separated)
    #[arg(long, value_delimiter = ',')]
    pub add_tags: Option<Vec<String>>,

    /// Tags to remove (comma-separated)
    #[arg(long, value_delimiter = ',')]
    pub remove_tags: Option<Vec<String>>,

    /// Replace all tags (comma-separated)
    #[arg(long, value_delimiter = ',')]
    pub replace_tags: Option<Vec<String>>,

    // user-specific operations
    #[arg(skip)]
    pub set_favorite: Option<SetFavoriteRequest>,

    /// Favorite the song
    #[arg(long)]
    pub favorite_song: bool,

    /// Favorite the artist
    #[arg(long)]
    pub favorite_artist: bool,

    /// Favorite the album
    #[arg(long)]
    pub favorite_album: bool,

    #[arg(skip)]
    pub set_rating: Option<SetRatingRequest>,

    /// Rate the song (1-5)
    #[arg(long)]
    pub rate_song: Option<i32>,

    /// Rate the artist (1-5)
    #[arg(long)]
    pub rate_artist: Option<i32>,

    /// Rate the album (1-5)
    #[arg(long)]
    pub rate_album: Option<i32>,
}

impl UpdateSongsRequest {
    /// Normalize CLI fields into nested structures (for use after clap parsing)
    pub fn normalize(mut self) -> Self {
        // Convert artist_name to artist
        if self.artist.is_none() && self.artist_name.is_some() {
            self.artist = self
                .artist_name
                .take()
                .map(|name| UpdateArtistRequest { name });
        }

        // Convert album fields to album
        if self.album.is_none() && self.album_title.is_some() {
            self.album = Some(UpdateAlbumRequest {
                title: self.album_title.take().unwrap(),
                album_type: self.album_type.take(),
                release_date: self.release_date.take(),
                release_date_precision: None,
                label: self.label.take(),
                year: None,
            });
        }

        // Convert favorite flags to set_favorite
        if self.set_favorite.is_none() {
            if self.favorite_song {
                self.set_favorite = Some(SetFavoriteRequest {
                    target_type: FavoriteTargetType::Song,
                    is_favorite: true,
                });
            } else if self.favorite_artist {
                self.set_favorite = Some(SetFavoriteRequest {
                    target_type: FavoriteTargetType::Artist,
                    is_favorite: true,
                });
            } else if self.favorite_album {
                self.set_favorite = Some(SetFavoriteRequest {
                    target_type: FavoriteTargetType::Album,
                    is_favorite: true,
                });
            }
        }

        // Convert rating flags to set_rating
        if self.set_rating.is_none() {
            if let Some(rating) = self.rate_song {
                self.set_rating = Some(SetRatingRequest {
                    target_type: RatingTargetType::Song,
                    rating,
                });
            } else if let Some(rating) = self.rate_artist {
                self.set_rating = Some(SetRatingRequest {
                    target_type: RatingTargetType::Artist,
                    rating,
                });
            } else if let Some(rating) = self.rate_album {
                self.set_rating = Some(SetRatingRequest {
                    target_type: RatingTargetType::Album,
                    rating,
                });
            }
        }

        self
    }
}

/// artist update request
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct UpdateArtistRequest {
    pub name: String,
}

/// album update request
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct UpdateAlbumRequest {
    pub title: String,
    pub album_type: Option<String>,
    pub release_date: Option<String>,
    pub release_date_precision: Option<String>,
    pub label: Option<String>,
    pub year: Option<i64>,
}

/// favorite update request (polymorphic: song, artist, album)
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct SetFavoriteRequest {
    pub target_type: FavoriteTargetType, // song, artist, or album
    pub is_favorite: bool,
}

/// rating update request (polymorphic: song, artist, album)
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct SetRatingRequest {
    pub target_type: RatingTargetType, // song, artist, or album
    pub rating: i32,                   // 1-5
}

/// favorite target types
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FavoriteTargetType {
    Song,
    Artist,
    Album,
}

impl ZodSchemaTrait for FavoriteTargetType {
    fn zod_schema() -> String {
        r#"z.union([z.literal("song"), z.literal("artist"), z.literal("album")])"#.to_string()
    }
}

impl FavoriteTargetType {
    pub fn as_str(&self) -> &str {
        match self {
            FavoriteTargetType::Song => "song",
            FavoriteTargetType::Artist => "artist",
            FavoriteTargetType::Album => "album",
        }
    }
}

/// rating target types
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RatingTargetType {
    Song,
    Artist,
    Album,
}

impl ZodSchemaTrait for RatingTargetType {
    fn zod_schema() -> String {
        r#"z.union([z.literal("song"), z.literal("artist"), z.literal("album")])"#.to_string()
    }
}

impl RatingTargetType {
    pub fn as_str(&self) -> &str {
        match self {
            RatingTargetType::Song => "song",
            RatingTargetType::Artist => "artist",
            RatingTargetType::Album => "album",
        }
    }
}

/// error information for a failed song update
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct SongUpdateError {
    pub song_id: String,
    pub error_message: String,
}

/// result of update songs operation
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct UpdateSongsResult {
    pub songs_updated: u32,
    pub songs_failed: Vec<SongUpdateError>,
    pub artist: Option<Artist>,
    pub album: Option<Album>,
    pub genre: Option<Genre>,
    pub sub_genre: Option<SubGenre>,
    pub thumbnail_blob_id: Option<String>,
    pub tags_modified: bool,
}

// ============================================================================
// API Request/Response Types
// ============================================================================

/// request for getting recent songs
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct RecentSongsRequest {
    pub limit: Option<u32>,
}

/// request for deleting a song
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct DeleteSongRequest {
    pub id: String,
    pub user_id: String,
}

/// response for song deletion
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct DeleteSongResponse {
    pub success: bool,
    pub message: String,
}

/// concrete query result type for songs
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct SongsQueryResult {
    pub items: Vec<SongQueryResult>,
    pub total_count: i64,
    pub has_more: bool,
    pub offset: i64,
    pub limit: i64,
    pub query_time_ms: Option<u64>,
}

impl From<QueryResult<SongQueryResult>> for SongsQueryResult {
    fn from(qr: QueryResult<SongQueryResult>) -> Self {
        Self {
            items: qr.items,
            total_count: qr.total_count,
            has_more: qr.has_more,
            offset: qr.offset,
            limit: qr.limit,
            query_time_ms: qr.query_time_ms,
        }
    }
}

/// concrete query result type for artists
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct ArtistsQueryResult {
    pub items: Vec<ArtistQueryResult>,
    pub total_count: i64,
    pub has_more: bool,
    pub offset: i64,
    pub limit: i64,
    pub query_time_ms: Option<u64>,
}

impl From<QueryResult<ArtistQueryResult>> for ArtistsQueryResult {
    fn from(qr: QueryResult<ArtistQueryResult>) -> Self {
        Self {
            items: qr.items,
            total_count: qr.total_count,
            has_more: qr.has_more,
            offset: qr.offset,
            limit: qr.limit,
            query_time_ms: qr.query_time_ms,
        }
    }
}

/// request for getting an artist
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct GetArtistRequest {
    pub id: String,
}

/// request for deleting an artist
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct DeleteArtistRequest {
    pub id: String,
    pub user_id: String,
}

/// response for artist deletion
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct DeleteArtistResponse {
    pub success: bool,
    pub message: String,
}

/// concrete query result type for albums
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct AlbumsQueryResult {
    pub items: Vec<AlbumQueryResult>,
    pub total_count: i64,
    pub has_more: bool,
    pub offset: i64,
    pub limit: i64,
    pub query_time_ms: Option<u64>,
}

impl From<QueryResult<AlbumQueryResult>> for AlbumsQueryResult {
    fn from(qr: QueryResult<AlbumQueryResult>) -> Self {
        Self {
            items: qr.items,
            total_count: qr.total_count,
            has_more: qr.has_more,
            offset: qr.offset,
            limit: qr.limit,
            query_time_ms: qr.query_time_ms,
        }
    }
}

/// request for getting an album
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct GetAlbumRequest {
    pub id: String,
}

/// request for deleting an album
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct DeleteAlbumRequest {
    pub id: String,
    pub user_id: String,
}

/// response for album deletion
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct DeleteAlbumResponse {
    pub success: bool,
    pub message: String,
}

// ============================================================================
// Favorites API Types
// ============================================================================

/// request for listing user favorites
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct ListFavoritesRequest {
    pub user_id: String,
    pub target_type: Option<String>,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

/// response for setting a favorite
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct SetFavoriteResponse {
    pub success: bool,
    pub message: String,
}

/// response for listing favorites
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct ListFavoritesResponse {
    pub favorites: Vec<serde_json::Value>,
}

// ============================================================================
// Ratings API Types
// ============================================================================

/// request for removing a rating
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct RemoveRatingRequest {
    pub user_id: String,
    pub target_type: RatingTarget,
    pub target_id: String,
}

/// request for getting rating stats
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct GetRatingStatsRequest {
    pub target_type: RatingTarget,
    pub target_id: String,
}

/// response for setting a rating
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct SetRatingResponse {
    pub success: bool,
    pub message: String,
}

/// response for removing a rating
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct RemoveRatingResponse {
    pub success: bool,
    pub message: String,
}

/// rating statistics
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct RatingStats {
    pub average_rating: f64,
    pub total_ratings: u64,
}

/// concrete query result type for genres
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct GenresQueryResult {
    pub items: Vec<GenreQueryResult>,
    pub total_count: i64,
    pub has_more: bool,
    pub offset: i64,
    pub limit: i64,
    pub query_time_ms: Option<u64>,
}

impl From<QueryResult<GenreQueryResult>> for GenresQueryResult {
    fn from(qr: QueryResult<GenreQueryResult>) -> Self {
        Self {
            items: qr.items,
            total_count: qr.total_count,
            has_more: qr.has_more,
            offset: qr.offset,
            limit: qr.limit,
            query_time_ms: qr.query_time_ms,
        }
    }
}

/// request for getting a genre
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct GetGenreRequest {
    pub id: String,
}
