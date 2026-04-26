//! radio station models.
//!
//! these mirror the schema in `migrations/023_radio_stationz.sql` 1:1.
//! `is_*` columns come back as `i64` (sqlite booleans); helpers convert.

use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use zod_gen_derive::ZodSchema;

/// one radio "channel" the broadcaster can run.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, FromRow, PartialEq)]
pub struct RadioStation {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub is_public: i64,
    pub is_enabled: i64,
    /// per-station ffmpeg override; null = use toml `[radio].encode_args`.
    pub encode_args: Option<String>,
    pub codec: String,
    /// 'shuffle' | 'album'
    pub play_mode: String,
    /// when non-zero the broadcaster skips the audio uni stream entirely;
    /// all listeners use timeline/queue-mode playback.
    pub timeline_only_mode: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

/// create a new station. all fields except `name` are optional and use
/// the schema defaults (private, enabled, default codec, shuffle).
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct CreateStationRequest {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub is_public: Option<bool>,
    #[serde(default)]
    pub is_enabled: Option<bool>,
    #[serde(default)]
    pub encode_args: Option<String>,
    #[serde(default)]
    pub codec: Option<String>,
    #[serde(default)]
    pub play_mode: Option<String>,
    /// when true the broadcaster will suppress the audio uni stream for
    /// this station and serve only timeline control messages.
    #[serde(default)]
    pub timeline_only_mode: Option<bool>,
}

/// partial update — only present fields are written.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, Default)]
pub struct UpdateStationRequest {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub is_public: Option<bool>,
    #[serde(default)]
    pub is_enabled: Option<bool>,
    #[serde(default)]
    pub encode_args: Option<String>,
    #[serde(default)]
    pub codec: Option<String>,
    #[serde(default)]
    pub play_mode: Option<String>,
    /// when true the broadcaster will suppress the audio uni stream for
    /// this station and serve only timeline control messages.
    #[serde(default)]
    pub timeline_only_mode: Option<bool>,
}

/// station ↔ song explicit-include row.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, FromRow, PartialEq)]
pub struct StationSong {
    pub station_id: String,
    pub song_id: String,
    pub sort_order: i64,
    pub added_at: i64,
}

/// one filter clause attached to a station.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, FromRow, PartialEq)]
pub struct StationFilter {
    pub id: String,
    pub station_id: String,
    pub filter_type: String,
    pub filter_value: String,
    pub mode: String,
    pub created_at: i64,
}

/// known filter-type values (free-form strings on the wire so the ui can
/// add new types without a migration; this enum is just for typed
/// callers in rust).
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StationFilterType {
    Tag,
    Genre,
    Artist,
    Album,
    YearRange,
    RatingMin,
    RatingMax,
}

impl StationFilterType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Tag => "tag",
            Self::Genre => "genre",
            Self::Artist => "artist",
            Self::Album => "album",
            Self::YearRange => "year_range",
            Self::RatingMin => "rating_min",
            Self::RatingMax => "rating_max",
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StationFilterMode {
    Include,
    Exclude,
}

impl StationFilterMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Include => "include",
            Self::Exclude => "exclude",
        }
    }
}

/// one row of `radio_play_historyz`.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, FromRow, PartialEq)]
pub struct PlayHistoryEntry {
    pub id: String,
    pub station_id: String,
    pub song_id: String,
    pub started_at: i64,
    pub duration_ms: Option<i64>,
    pub listener_count: i64,
}
