//! musicbrainz integration module
//!
//! provides musicbrainz api client, data models, and search functionality
//! for metadata enrichment and cover art retrieval.

pub mod batch;
pub mod client;
pub mod config;
pub mod models;
pub mod queries;
pub mod rate_limiter;
pub mod service;

// re-export commonly used types
pub use client::MusicBrainzClient;
pub use config::MusicBrainzConfig;
pub use models::{
    ArtistCredit, CoverArt, MetadataPreview, MusicBrainzMatch, Recording, Release, ReleaseGroup,
};
pub use queries::{RecordingSearchQuery, ReleaseGroupSearchQuery, ReleaseSearchQuery};
pub use rate_limiter::RateLimiter;
pub use service::MusicBrainzService;

/// musicbrainz api errors
#[derive(Debug, thiserror::Error)]
pub enum MusicBrainzError {
    #[error("http request failed: {0}")]
    HttpError(#[from] reqwest::Error),

    #[error("json parsing failed: {0}")]
    JsonError(#[from] serde_json::Error),

    #[error("rate limit exceeded")]
    RateLimitExceeded,

    #[error("invalid query: {0}")]
    InvalidQuery(String),

    #[error("no results found")]
    NoResults,

    #[error("musicbrainz api error: {status} - {message}")]
    ApiError { status: u16, message: String },

    #[error("configuration error: {0}")]
    ConfigError(String),

    #[error("timeout error")]
    Timeout,
}

pub type Result<T> = std::result::Result<T, MusicBrainzError>;
