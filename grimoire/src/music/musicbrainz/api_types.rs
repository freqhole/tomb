//! api request types for musicbrainz endpoints

use serde::{Deserialize, Serialize};
use zod_gen_derive::ZodSchema;

/// request to search releases (albums)
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct SearchReleasesRequest {
    /// search query string
    pub query: String,
    /// artist name filter
    pub artist: Option<String>,
    /// release title filter
    pub release: Option<String>,
    /// limit results
    pub limit: Option<u32>,
    /// offset for pagination
    pub offset: Option<u32>,
}

/// request to get a specific release by mbid
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct GetReleaseRequest {
    /// musicbrainz id
    pub mbid: String,
}

/// request to search recordings (songs/tracks)
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct SearchRecordingsRequest {
    /// search query string
    pub query: String,
    /// artist name filter
    pub artist: Option<String>,
    /// recording title filter
    pub recording: Option<String>,
    /// limit results
    pub limit: Option<u32>,
    /// offset for pagination
    pub offset: Option<u32>,
}

/// request to get a specific recording by mbid
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct GetRecordingRequest {
    /// musicbrainz id
    pub mbid: String,
}

/// request to get cover art for a release
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct GetCoverArtRequest {
    /// musicbrainz release id
    pub mbid: String,
}
