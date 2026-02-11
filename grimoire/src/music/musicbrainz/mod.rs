//! MusicBrainz integration module
//!
//! Provides MusicBrainz API client, data models, and search functionality
//! for metadata enrichment and cover art retrieval.
//!
//! This module is focused on **search and retrieval** operations only.
//! All metadata application is handled by the web UI using the existing
//! `grimoire::music::crud::update_songs()` API.

pub mod api_types;
pub mod client;
pub mod models;
pub mod queries;
pub mod rate_limiter;

// Re-export commonly used types
pub use client::MusicBrainzClient;
pub use models::{
    ArtistCredit, CoverArt, CoverArtThumbnails, MusicBrainzMatch, Recording, Release, ReleaseGroup,
    SearchResult,
};
pub use queries::{RecordingSearchQuery, ReleaseGroupSearchQuery, ReleaseSearchQuery};
pub use rate_limiter::RateLimiter;

// Re-export API types
pub use api_types::{
    GetCoverArtRequest, GetRecordingRequest, GetReleaseRequest, MbArtistCreditEntry,
    MbCoverArtImage, MbCoverArtThumbnails, MbMediumDetail, MbReleaseDetail, MbReleaseListItem,
    MbSearchReleasesResponse, MbTrackDetail, SearchRecordingsRequest, SearchReleasesRequest,
};
