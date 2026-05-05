//! radio station entities — db-backed per-channel configuration.
//!
//! see migrations/023_radio_stationz.sql for the schema. each row in
//! `radio_stationz` is one "channel" the broadcaster can run; the
//! broadcaster registry (added in a later slice) maps station_id →
//! `Channel`. for now this module just owns the persistence + playlist
//! resolution; multi-station broadcasting is wired in 2a-iii.

pub mod models;
pub mod repository;

pub use models::{
    CreateStationRequest, PlayHistoryEntry, RadioStation, StationFilter, StationFilterMode,
    StationFilterType, UpdateStationRequest,
};
pub use repository::{
    add_filter, create_station, delete_station, finish_play, get_station, list_filters,
    list_play_history, list_stations, record_play, remove_filter, resolve_playlist, update_station,
};
