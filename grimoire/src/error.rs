//! error handling for grimoire

use serde::{Deserialize, Serialize};
use thiserror::Error;
use zod_gen_derive::ZodSchema;

/// setup wizard step identifiers
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum SetupStep {
    Directories,
    Config,
    Database,
    Wordlist,
    User,
    ApiKey,
    InviteCode,
    Scan,
}

impl std::fmt::Display for SetupStep {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SetupStep::Directories => write!(f, "directories"),
            SetupStep::Config => write!(f, "config"),
            SetupStep::Database => write!(f, "database"),
            SetupStep::Wordlist => write!(f, "wordlist"),
            SetupStep::User => write!(f, "user"),
            SetupStep::ApiKey => write!(f, "api_key"),
            SetupStep::InviteCode => write!(f, "invite_code"),
            SetupStep::Scan => write!(f, "scan"),
        }
    }
}

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

    #[error("setup failed at {step}: {message}")]
    SetupFailed { step: SetupStep, message: String },

    #[error("duplicate song: {blob_id}")]
    DuplicateSong { blob_id: String },

    #[error("file not found: {path}")]
    FileNotFound { path: String },

    // federation errors
    #[error("federation auth failed: {message}")]
    FederationAuthFailed { message: String },

    #[error("federation token refresh failed: {message}")]
    FederationTokenRefreshFailed { message: String },

    #[error("federation api error: {message}")]
    FederationApiError { message: String },

    #[error("federation not configured")]
    FederationNotConfigured,

    #[error("federation credentials not found")]
    FederationCredentialsNotFound,

    #[error("federation credentials invalid: {message}")]
    FederationCredentialsInvalid { message: String },

    #[error("knock request not found: {id}")]
    KnockNotFound { id: String },

    #[error("knock already processed: {id}")]
    KnockAlreadyProcessed { id: String },
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
            .unwrap_or(&debug_str)
            .trim();

        to_snake_case(variant_name)
    }

    /// check if this error type should trigger a retry
    ///
    /// deterministic errors (duplicate, not found, validation) should not retry.
    /// transient errors (database timeout, network) may succeed on retry.
    pub fn is_retryable(&self) -> bool {
        match self {
            // deterministic errors - will always fail
            GrimoireError::DuplicateSong { .. } => false,
            GrimoireError::FileNotFound { .. } => false,
            GrimoireError::FileExists { .. } => false,
            GrimoireError::SongNotFound { .. } => false,
            GrimoireError::MediaBlobNotFound { .. } => false,
            GrimoireError::AlbumNotFound { .. } => false,
            GrimoireError::ArtistNotFound { .. } => false,
            GrimoireError::PlaylistNotFound { .. } => false,
            GrimoireError::SongNotInPlaylist { .. } => false,
            GrimoireError::GenreNotFound { .. } => false,
            GrimoireError::SubGenreNotFound { .. } => false,
            GrimoireError::TagNotFound { .. } => false,
            GrimoireError::DatabaseNotFound(_) => false,
            GrimoireError::Validation { .. } => false,
            GrimoireError::InvalidSha256 { .. } => false,
            GrimoireError::InvalidFormat { .. } => false,
            GrimoireError::InvalidEventType(_) => false,
            GrimoireError::InvalidEventData(_) => false,
            GrimoireError::ConfigError(_) => false,
            GrimoireError::Migration(_) => false, // schema issues are deterministic
            GrimoireError::Serialization(_) => false,
            GrimoireError::MetadataExtraction { .. } => false,
            GrimoireError::ThumbnailGeneration { .. } => false,
            GrimoireError::SetupFailed { .. } => false,
            GrimoireError::MusicBrainzConfig(_) => false,
            GrimoireError::MusicBrainzNoResults => false,
            // transient errors - might succeed on retry
            GrimoireError::Database(_) => true,
            GrimoireError::Io(_) => true,
            GrimoireError::HttpRequest(_) => true,
            GrimoireError::MusicBrainzApi(_) => true,
            GrimoireError::MusicBrainzRateLimit => true,
            GrimoireError::MusicBrainzTimeout => true,
            GrimoireError::Analytics(_) => true,
            GrimoireError::ProcessingFailed { .. } => true, // generic, assume transient
            // federation errors
            GrimoireError::FederationAuthFailed { .. } => false, // bad credentials
            GrimoireError::FederationTokenRefreshFailed { .. } => true, // token may have expired
            GrimoireError::FederationApiError { .. } => true,    // network issues
            GrimoireError::FederationNotConfigured => false,
            GrimoireError::FederationCredentialsNotFound => false,
            GrimoireError::FederationCredentialsInvalid { .. } => false,
            // knock errors
            GrimoireError::KnockNotFound { .. } => false,
            GrimoireError::KnockAlreadyProcessed { .. } => false,
        }
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

// ============================================================================
// Error Details (RFC 9457 style)
// ============================================================================

/// RFC 9457-style error object for structured error responses
///
/// this is the standard error structure used across all API responses and job failures.
/// the `error_type` field is a snake_case identifier that clients can use for programmatic
/// error handling (e.g., "duplicate_song", "file_not_found", "validation_error").
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ZodSchema)]
pub struct ErrorDetail {
    /// error type identifier (snake_case, e.g., "duplicate_song", "validation_error")
    /// this is the primary field for programmatic error detection
    pub error_type: String,
    /// short, human-readable summary (title case)
    pub title: String,
    /// specific explanation of this error occurrence
    pub detail: String,
}

impl ErrorDetail {
    /// Create a new error detail
    pub fn new(
        error_type: impl Into<String>,
        title: impl Into<String>,
        detail: impl Into<String>,
    ) -> Self {
        Self {
            error_type: error_type.into(),
            title: title.into(),
            detail: detail.into(),
        }
    }
}

impl From<&GrimoireError> for ErrorDetail {
    fn from(err: &GrimoireError) -> Self {
        let error_type = err.error_type();
        let title = error_type_to_title(&error_type);
        let detail = err.to_string();

        Self {
            error_type,
            title,
            detail,
        }
    }
}

impl From<GrimoireError> for ErrorDetail {
    fn from(err: GrimoireError) -> Self {
        Self::from(&err)
    }
}

impl From<sqlx::Error> for ErrorDetail {
    fn from(err: sqlx::Error) -> Self {
        ErrorDetail {
            error_type: "database_error".to_string(),
            title: "Database Error".to_string(),
            detail: err.to_string(),
        }
    }
}

impl From<crate::jobs::JobError> for ErrorDetail {
    fn from(err: crate::jobs::JobError) -> Self {
        let error_type = err.error_type();
        let title = error_type_to_title(&error_type);
        ErrorDetail {
            error_type,
            title,
            detail: err.to_string(),
        }
    }
}

impl From<serde_json::Error> for ErrorDetail {
    fn from(err: serde_json::Error) -> Self {
        ErrorDetail {
            error_type: "serialization_error".to_string(),
            title: "Serialization Error".to_string(),
            detail: err.to_string(),
        }
    }
}

impl From<crate::wordlist::ManagementWordlistError> for ErrorDetail {
    fn from(err: crate::wordlist::ManagementWordlistError) -> Self {
        ErrorDetail {
            error_type: "wordlist_error".to_string(),
            title: "Wordlist Error".to_string(),
            detail: err.to_string(),
        }
    }
}

impl From<image::ImageError> for ErrorDetail {
    fn from(err: image::ImageError) -> Self {
        ErrorDetail {
            error_type: "image_error".to_string(),
            title: "Image Error".to_string(),
            detail: err.to_string(),
        }
    }
}

/// Convert error_type (snake_case) to Title Case
/// Example: "database_not_found" -> "Database Not Found"
fn error_type_to_title(error_type: &str) -> String {
    error_type
        .split('_')
        .map(|word| {
            let mut chars = word.chars();
            match chars.next() {
                None => String::new(),
                Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}
