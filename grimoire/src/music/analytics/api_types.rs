//! api request types for analytics endpoints

use serde::{Deserialize, Serialize};
use zod_gen_derive::ZodSchema;

/// request to record a play event
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct RecordPlayRequest {
    /// media blob id being played
    pub media_blob_id: String,
    /// song id being played
    pub song_id: String,
    /// session id for grouping plays
    pub session_id: Option<String>,
    /// additional event data (position, progress, etc.)
    pub event_data: Option<serde_json::Value>,
}

/// request to get listening history
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct ListeningHistoryRequest {
    /// user id (optional, defaults to authenticated user)
    pub user_id: Option<String>,
    /// number of items to return
    pub limit: Option<i64>,
    /// offset for pagination
    pub offset: Option<i64>,
}

/// response with listening history and total count
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct ListeningHistoryResponse {
    /// history items
    pub items: Vec<super::ListeningHistoryItem>,
    /// total count for pagination
    pub total: i64,
}

/// request to get song play analytics
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct SongAnalyticsRequest {
    /// song id to get analytics for
    pub song_id: String,
}

/// request to get top songs
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct TopSongsRequest {
    /// number of songs to return
    pub limit: Option<i64>,
    /// optional time window in days
    pub days: Option<i64>,
}

/// request to get top albums
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct TopAlbumsRequest {
    /// number of albums to return
    pub limit: Option<i64>,
    /// optional time window in days
    pub days: Option<i64>,
}

/// request to get top artists
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct TopArtistsRequest {
    /// number of artists to return
    pub limit: Option<i64>,
    /// optional time window in days
    pub days: Option<i64>,
}

/// request to get activity feed
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct FeedRequest {
    /// number of items to return
    pub limit: Option<i64>,
    /// offset for pagination
    pub offset: Option<i64>,
}

/// response with feed items and total count
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct FeedResponse {
    /// feed items
    pub items: Vec<super::FeedItem>,
    /// total count for pagination
    pub total: i64,
}
