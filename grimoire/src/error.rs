//! error handling for grimoire

use thiserror::Error;

/// main error type for grimoire operations
#[derive(Error, Debug)]
pub enum GrimoireError {
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),

    #[error("migration error: {0}")]
    Migration(#[from] sqlx::migrate::MigrateError),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("media blob not found: {id}")]
    MediaBlobNotFound { id: String },

    #[error("song not found: {id}")]
    SongNotFound { id: String },

    #[error("artist not found: {id}")]
    ArtistNotFound { id: String },

    #[error("album not found: {id}")]
    AlbumNotFound { id: String },

    #[error("playlist not found: {id}")]
    PlaylistNotFound { id: String },

    #[error("genre not found: {id}")]
    GenreNotFound { id: String },

    #[error("sub-genre not found: {id}")]
    SubGenreNotFound { id: String },

    #[error("invalid sha256 hash: {hash}")]
    InvalidSha256 { hash: String },

    #[error("file already exists: {path}")]
    FileExists { path: String },

    #[error("invalid file format: {reason}")]
    InvalidFormat { reason: String },

    #[error("metadata extraction failed: {reason}")]
    MetadataExtraction { reason: String },

    #[error("thumbnail generation failed: {reason}")]
    ThumbnailGeneration { reason: String },

    #[error("configuration error: {message}")]
    Config { message: String },

    #[error("validation error: {field} - {message}")]
    Validation { field: String, message: String },
}

/// result type alias for grimoire operations
pub type GrimoireResult<T> = Result<T, GrimoireError>;

impl From<lofty::LoftyError> for GrimoireError {
    fn from(err: lofty::LoftyError) -> Self {
        GrimoireError::MetadataExtraction {
            reason: err.to_string(),
        }
    }
}

impl From<image::ImageError> for GrimoireError {
    fn from(err: image::ImageError) -> Self {
        GrimoireError::ThumbnailGeneration {
            reason: err.to_string(),
        }
    }
}
