//! models for compound music operations
//! request/response types for high-level workflows

use serde::{Deserialize, Serialize};

use crate::music::{Album, Artist, Genre, Song};

/// request for importing a song with all metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportSongRequest {
    pub media_blob_id: String,
    pub title: String,
    pub artist_name: Option<String>,
    pub album_title: Option<String>,
    pub genre_name: Option<String>,
    pub track_number: Option<i64>,
    pub disc_number: Option<i64>,
    pub duration: Option<i64>,
    pub year: Option<i64>,
    pub bpm: Option<i64>,
    pub key_signature: Option<String>,
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
