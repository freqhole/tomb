//! typed radio admin command envelopes.
//!
//! response shapes:
//! - `radio_stations_list`  -> `Vec<RadioStation>`
//! - `radio_stations_get`   -> `RadioStation`
//! - `radio_stations_create` -> `RadioStation`
//! - `radio_stations_update` -> `RadioStation`
//! - `radio_stations_delete` -> `EmptyResponse`
//! - `radio_filters_list`   -> `Vec<StationFilter>`
//! - `radio_filters_add`    -> `StationFilter`
//! - `radio_filters_remove` -> `EmptyResponse`
//!
//! per-track inclusion is expressed via `radio_filters_add` with
//! `filter_type = "track"` (the FK column is `song_id`).

use serde::{Deserialize, Serialize};
use zod_gen_derive::ZodSchema;

/// request for `radio_stations_get` and `radio_stations_delete`.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct RadioStationsByIdRequest {
    pub id: String,
}

/// request for `radio_filters_list`.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct RadioStationByStationIdRequest {
    pub station_id: String,
}

/// request for `radio_filters_add`.
///
/// `filter_value` is always the FK id of the referenced record — an
/// artist id when `filter_type = "artist"`, an album id for `"album"`,
/// a song id for `"track"`, a playlist id for `"playlist"`, etc. the
/// server no longer matches by name.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct RadioFiltersAddRequest {
    pub station_id: String,
    /// `"artist"` | `"album"` | `"genre"` | `"tag"` | `"track"` | `"playlist"`
    pub filter_type: String,
    /// FK id (artist id / album id / genre id / tag id / song id / playlist id).
    pub filter_value: String,
    /// `"include"` or `"exclude"`
    pub mode: String,
}

/// request for `radio_filters_remove`.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct RadioFiltersRemoveRequest {
    pub filter_id: String,
}

/// request for `radio_seed_suggest`. powers the wizard's autocomplete
/// helpers — the dispatch layer maps `kind` to the right repository
/// search and returns up to `limit` matches.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct RadioSeedSuggestRequest {
    /// one of `"tag"`, `"genre"`, `"artist"`, `"album"`, `"song"`, `"playlist"`
    pub kind: String,
    /// search prefix; empty string returns top results when supported
    pub query: String,
    /// max suggestions to return (server caps at 50)
    #[serde(default)]
    pub limit: Option<u32>,
}

/// single suggestion row returned by `radio_seed_suggest`.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct RadioSeedSuggestion {
    /// stable id (uuid) — always required.
    pub id: String,
    /// human-readable label (tag name, genre name, artist name,
    /// "title — artist" for songs).
    pub name: String,
    /// secondary line, when meaningful (artist for albums, album for songs).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subtitle: Option<String>,
}

/// node-wide `[radio]` config block. mirrors `RadioConfig` for codegen.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct RadioConfigPayload {
    /// main switch — when false, the broadcaster doesn't start at boot
    /// and `freqhole radio serve` refuses to run.
    pub enabled: bool,
    /// ffmpeg encoder template (`{input}` placeholder, output to `pipe:1`).
    pub encode_args: String,
    /// true when ffmpeg is available on this node.
    #[serde(default)]
    pub ffmpeg_available: bool,
}

// ---------- supervisor (start/stop/restart) ----------------------------

/// snapshot of one station's broadcaster lifecycle status.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct RadioStationSupervisorStatus {
    pub station_id: String,
    pub name: String,
    pub is_enabled: bool,
    pub is_running: bool,
    pub listener_count: u32,
    pub current_seq: u32,
    /// id of the song currently playing, if any.
    pub current_song_id: Option<String>,
    pub current_title: Option<String>,
    /// true when this is the broadcaster the server hands out for tunes
    /// that omit a station id.
    pub is_default: bool,
}

/// response for `radio_supervisor_status` — one row per station in the
/// db (running or not), plus the global `enabled` flag.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct RadioSupervisorStatusResponse {
    /// node-wide `[radio].enabled`. when false, the supervisor refuses to
    /// start any new broadcasters until flipped through `radio_config_set`.
    pub radio_enabled: bool,
    pub stations: Vec<RadioStationSupervisorStatus>,
}

/// request for `radio_supervisor_start`, `_stop`, and `_restart`.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct RadioSupervisorStationRequest {
    pub station_id: String,
}

// ---------- bumpers (DJ drops / station IDs) ---------------------------

/// one bumper row. references a `songz` row so uploads / metadata /
/// art reuse the existing music pipeline.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct RadioBumper {
    pub id: String,
    pub station_id: String,
    pub song_id: String,
    pub label: String,
    pub weight: i64,
    pub created_at: i64,
}

/// request for `radio_bumpers_list`.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct RadioBumpersListRequest {
    pub station_id: String,
}

/// request for `radio_bumpers_add`.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct RadioBumpersAddRequest {
    pub station_id: String,
    pub song_id: String,
    pub label: String,
    /// optional weight (default 1). higher = picked more often.
    #[serde(default)]
    pub weight: Option<i64>,
}

/// request for `radio_bumpers_remove`.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct RadioBumpersRemoveRequest {
    pub bumper_id: String,
}

/// request for `radio_bumpers_set_frequency`. sets the per-station
/// `bumper_frequency_seconds` (null = bumpers off).
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct RadioBumpersSetFrequencyRequest {
    pub station_id: String,
    /// seconds between bumper plays. `None` disables bumpers.
    pub frequency_seconds: Option<i64>,
}
