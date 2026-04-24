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
//! - `radio_songs_list`     -> `Vec<StationSong>`
//! - `radio_songs_add`      -> `EmptyResponse`
//! - `radio_songs_remove`   -> `EmptyResponse`

use serde::{Deserialize, Serialize};
use zod_gen_derive::ZodSchema;

/// request for `radio_stations_get` and `radio_stations_delete`.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct RadioStationsByIdRequest {
    pub id: String,
}

/// request for `radio_filters_list` and `radio_songs_list`.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct RadioStationByStationIdRequest {
    pub station_id: String,
}

/// request for `radio_filters_add`.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct RadioFiltersAddRequest {
    pub station_id: String,
    /// e.g. `"tag"`, `"genre"`, `"artist"`, `"album"`
    pub filter_type: String,
    pub filter_value: String,
    /// `"include"` or `"exclude"`
    pub mode: String,
}

/// request for `radio_filters_remove`.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct RadioFiltersRemoveRequest {
    pub filter_id: String,
}

/// request for `radio_songs_add`.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct RadioSongsAddRequest {
    pub station_id: String,
    pub song_id: String,
    #[serde(default)]
    pub sort_order: Option<i64>,
}

/// request for `radio_songs_remove`.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct RadioSongsRemoveRequest {
    pub station_id: String,
    pub song_id: String,
}
