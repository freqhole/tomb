//! Music domain types (simplified from grimoire)

use serde::{Deserialize, Serialize};
use zod_gen_derive::ZodSchema;

#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
#[serde(rename_all = "camelCase")]
pub struct QueryParams {
    pub q: Option<String>,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
#[serde(rename_all = "camelCase")]
pub struct Playlist {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistQueryResult {
    pub playlist: Playlist,
    pub song_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
#[serde(rename_all = "camelCase")]
pub struct Song {
    pub id: String,
    pub title: String,
    pub artist_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
#[serde(rename_all = "camelCase")]
pub struct Album {
    pub id: String,
    pub title: String,
    pub artist_name: String,
    pub year: Option<i32>,
}
