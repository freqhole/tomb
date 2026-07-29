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

/// one filter clause attached to a station.
///
/// reference-type clauses (artist/album/taxon/tag/track/playlist)
/// reference a real record id via exactly one of the FK columns
/// (`artist_id` / `album_id` / `taxon_id` / `tag_id` / `song_id` /
/// `playlist_id`), matching `filter_type`. the wire shape exposes
/// `filter_value` as the chosen FK id so existing ui code keeps
/// working — the picker no longer falls back to name lookups.
///
/// criteria-type clauses (favorite/rating/play_count/duration/
/// added_days) carry a plain numeric threshold in `criteria_value`
/// instead — see `StationFilterType` for the full list. `filter_value`
/// surfaces that threshold as a string for these (empty for
/// `favorite`, which needs no value at all).
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, FromRow, PartialEq)]
pub struct StationFilter {
    pub id: String,
    pub station_id: String,
    /// see `StationFilterType` for every accepted value.
    pub filter_type: String,
    /// the FK id matching `filter_type` for reference types, or the
    /// numeric threshold (as a string) for criteria types. empty for
    /// `favorite`, which has no value.
    pub filter_value: String,
    /// human-readable label for `filter_value` (artist name, album
    /// title, taxon label, tag name, song title). populated by the
    /// repository via a left-join so the UI can render names without a
    /// second round-trip. empty for criteria types (no referenced
    /// record) or if the referenced row was deleted out from under the
    /// filter.
    #[serde(default)]
    pub filter_label: String,
    /// 'include' | 'exclude'
    pub mode: String,
    pub created_at: i64,
}

/// known filter-type values. wire form is the lowercase string.
///
/// note: `Taxon` replaced `Genre` in migration 038. the underlying FK
/// (`taxon_id`) targets `taxonz(id)` of any kind — genre, label, mood,
/// era, region, ... — so a single station can mix kinds in its seed
/// filters. legacy `"genre"` strings are accepted on input as an alias
/// for `"taxon"`.
///
/// migration 051 added nine "criteria" types alongside the six
/// reference types above. these carry a plain numeric threshold in
/// `criteria_value` (or no value at all, for `favorite`) instead of an
/// FK id — see `StationFilter` and `repository::song_ids_for_clause`
/// for resolution details.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum StationFilterType {
    Artist,
    Album,
    Taxon,
    Tag,
    Track,
    Playlist,
    /// song is favorited, or belongs to a favorited album/artist/
    /// playlist — any user, existential (see repository.rs). no value.
    Favorite,
    /// any user rated the song (or its album/artist, or a playlist
    /// containing it) at least this many stars (1-5).
    RatingGte,
    /// any user rated the song (or its album/artist, or a playlist
    /// containing it) at most this many stars (1-5).
    RatingLte,
    PlayCountGte,
    PlayCountLte,
    /// song duration in seconds, inclusive lower bound.
    DurationGte,
    /// song duration in seconds, inclusive upper bound.
    DurationLte,
    /// added at least this many days ago (i.e. older than the cutoff —
    /// see repository.rs for the days-ago-vs-timestamp inversion).
    AddedDaysGte,
    /// added at most this many days ago (i.e. more recent than the
    /// cutoff).
    AddedDaysLte,
}

impl StationFilterType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Artist => "artist",
            Self::Album => "album",
            Self::Taxon => "taxon",
            Self::Tag => "tag",
            Self::Track => "track",
            Self::Playlist => "playlist",
            Self::Favorite => "favorite",
            Self::RatingGte => "rating_gte",
            Self::RatingLte => "rating_lte",
            Self::PlayCountGte => "play_count_gte",
            Self::PlayCountLte => "play_count_lte",
            Self::DurationGte => "duration_gte",
            Self::DurationLte => "duration_lte",
            Self::AddedDaysGte => "added_days_gte",
            Self::AddedDaysLte => "added_days_lte",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s.trim().to_ascii_lowercase().as_str() {
            "artist" => Some(Self::Artist),
            "album" => Some(Self::Album),
            // accept legacy "genre" string from cached payloads / older clients
            "taxon" | "genre" => Some(Self::Taxon),
            "tag" => Some(Self::Tag),
            "track" => Some(Self::Track),
            "playlist" => Some(Self::Playlist),
            "favorite" => Some(Self::Favorite),
            "rating_gte" => Some(Self::RatingGte),
            "rating_lte" => Some(Self::RatingLte),
            "play_count_gte" => Some(Self::PlayCountGte),
            "play_count_lte" => Some(Self::PlayCountLte),
            "duration_gte" => Some(Self::DurationGte),
            "duration_lte" => Some(Self::DurationLte),
            "added_days_gte" => Some(Self::AddedDaysGte),
            "added_days_lte" => Some(Self::AddedDaysLte),
            _ => None,
        }
    }

    /// true for the nine criteria types added in migration 051 (numeric
    /// threshold or no value, as opposed to an FK reference id).
    pub fn is_criteria(self) -> bool {
        !matches!(
            self,
            Self::Artist | Self::Album | Self::Taxon | Self::Tag | Self::Track | Self::Playlist
        )
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
