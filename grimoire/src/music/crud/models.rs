//! models for compound music operations
//! request/response types for high-level workflows

use serde::{Deserialize, Serialize};

use crate::media_blobz::MediaBlob;
use crate::music::{Album, Artist, Genre, Song};

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
    pub lyrics: Option<String>,
    pub created_by: Option<String>,
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
    pub track_number: Option<i64>,
    pub disc_number: Option<i64>,
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
    pub genre_rowid: Option<i64>,
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
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryParams {
    pub q: Option<String>,                  // Full-text search query (FTS5)
    pub search_fields: Option<Vec<String>>, // Which fields to search: ["title", "artist", "album"]
    pub filters: std::collections::HashMap<String, serde_json::Value>, // Flexible filters (year_min, genre, etc.)
    pub sort_by: Option<String>,                                       // Field name
    pub sort_direction: Option<String>,                                // "asc" | "desc"
    pub limit: Option<u32>,                                            // Page size (default: 50)
    pub offset: Option<u32>,                                           // Page offset (default: 0)
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
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SongQueryResult {
    pub song: Song,
    pub artist: Option<Artist>,
    pub album: Option<Album>,
    pub genre: Option<Genre>,
    pub media_blob: Option<MediaBlob>,
    pub relevance_score: Option<f64>, // For FTS search results
    pub snippet: Option<String>,      // Highlighted text snippet for FTS
}

/// artist with aggregated metadata for query results
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArtistQueryResult {
    pub artist: Artist,
    pub song_count: i64,
    pub album_count: i64,
    pub total_duration: Option<i64>,
    pub rating: Option<f64>, // Future implementation
}

/// album with aggregated metadata for query results
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlbumQueryResult {
    pub album: Album,
    pub artist: Option<Artist>,
    pub genre: Option<Genre>,
    pub rating: Option<f64>,       // Future implementation
    pub is_favorite: Option<bool>, // Future implementation
}

/// genre with optional aggregated metadata for query results
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenreQueryResult {
    pub genre: Genre,
    pub song_count: Option<i64>,  // Could be computed if needed
    pub album_count: Option<i64>, // Could be computed if needed
}
