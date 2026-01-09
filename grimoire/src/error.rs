//! error handling for grimoire

use thiserror::Error;

/// main error type for grimoire operations
#[derive(Error, Debug)]
pub enum GrimoireError {
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),

    #[error("database not found: {0}")]
    DatabaseNotFound(String),

    #[error("configuration error: {0}")]
    ConfigError(#[from] crate::config::ConfigError),

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

    #[error("song {song_id} not found in playlist {playlist_id}")]
    SongNotInPlaylist {
        song_id: String,
        playlist_id: String,
    },

    #[error("genre not found: {id}")]
    GenreNotFound { id: String },

    #[error("sub-genre not found: {id}")]
    SubGenreNotFound { id: String },

    #[error("tag not found: {id}")]
    TagNotFound { id: String },

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

    #[error("validation error: {field} - {message}")]
    Validation { field: String, message: String },

    #[error("processing failed: {message}")]
    ProcessingFailed { message: String },

    #[error("musicbrainz api error: {0}")]
    MusicBrainzApi(String),

    #[error("musicbrainz rate limit exceeded")]
    MusicBrainzRateLimit,

    #[error("musicbrainz configuration error: {0}")]
    MusicBrainzConfig(String),

    #[error("musicbrainz timeout")]
    MusicBrainzTimeout,

    #[error("musicbrainz no results found")]
    MusicBrainzNoResults,

    #[error("http request failed: {0}")]
    HttpRequest(String),

    #[error("analytics error: {0}")]
    Analytics(String),

    #[error("invalid event type: {0}")]
    InvalidEventType(String),

    #[error("invalid event data: {0}")]
    InvalidEventData(String),
}

/// result type alias for grimoire operations
pub type GrimoireResult<T> = Result<T, GrimoireError>;

impl GrimoireError {
    /// Get the error type identifier for RFC 9457 compatibility
    /// Auto-derives from variant name (e.g., DatabaseNotFound -> database_not_found)
    pub fn error_type(&self) -> String {
        // Use Debug formatting to get variant name, then convert to snake_case
        let debug_str = format!("{:?}", self);
        let variant_name = debug_str
            .split(|c| c == '(' || c == '{')
            .next()
            .unwrap_or(&debug_str);

        to_snake_case(variant_name)
    }
}

/// Convert PascalCase/camelCase to snake_case
fn to_snake_case(s: &str) -> String {
    let mut result = String::new();
    let mut chars = s.chars().peekable();

    while let Some(ch) = chars.next() {
        if ch.is_uppercase() {
            if !result.is_empty() {
                result.push('_');
            }
            result.push(ch.to_ascii_lowercase());
        } else {
            result.push(ch);
        }
    }

    result
}

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

impl From<reqwest::Error> for GrimoireError {
    fn from(err: reqwest::Error) -> Self {
        GrimoireError::HttpRequest(err.to_string())
    }
}
