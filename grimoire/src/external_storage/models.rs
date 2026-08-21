//! removable-storage sync state types — see
//! migrations/053_external_storage_sync_state.sql and
//! docs/removable-storage-sync-plan.md (tomb repo) phase 6.

use serde::{Deserialize, Serialize};

/// one song already synced to a device — mirrors the old
/// `SyncedSongEntry` that used to live in a per-device json file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncedSong {
    pub song_id: String,
    pub relative_path: String,
    pub sha256: String,
    pub blake3: Option<String>,
    pub tag_hash: String,
    pub synced_at: i64,
}

/// one `.m3u8` manifest already synced to a device. `sync_set_id` is one
/// of three id-spaces: a real `playlistz.id`, the literal string
/// `"favorites"`, or an `external_storage_filter_setz.id`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncManifest {
    pub sync_set_id: String,
    pub filename: String,
    pub synced_at: i64,
}

/// a named, reusable set of include/exclude filter clauses — "what to
/// sync to removable storage". structurally parallel to a radio
/// station, but with no broadcast machinery attached. `device_id` is
/// `None` only for pre-migration-054 rows; every set created via
/// `get_or_create_default_filter_set` has it set, and it's unique across
/// the table (one default filter-set per device for now - see
/// docs/removable-storage-sync-plan.md phase 6).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilterSet {
    pub id: String,
    pub name: String,
    pub device_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// one clause in a filter-set — same wire shape as
/// `radio::stations::models::StationFilter`, scoped to a filter_set_id
/// instead of a station_id.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilterSetFilter {
    pub id: String,
    pub filter_set_id: String,
    pub filter_type: String,
    pub filter_value: String,
    pub filter_label: String,
    pub mode: String,
    pub created_at: i64,
}
