//! removable-storage sync state — db-backed bookkeeping for what's been
//! synced to a removable (usb/sd) device, plus a filter-set model for
//! rule-based bulk sync selection.
//!
//! see migrations/053_external_storage_sync_state.sql and
//! docs/removable-storage-sync-plan.md (tomb repo) phase 6 for the full
//! design and the rationale for moving this off a per-device json file
//! and out of charnel's local toml config.

pub mod models;
pub mod repository;

pub use models::{FilterSet, FilterSetFilter, SyncManifest, SyncedSong};
pub use repository::{
    add_filter_set_filter, claim_path, create_filter_set, delete_filter_set,
    get_device_last_synced_at, get_filter_set, get_manifest, get_or_create_default_filter_set,
    get_synced_song, is_path_claimed, list_claimed_paths, list_filter_set_filters,
    list_filter_sets, list_manifests, list_synced_songs, remove_filter_set_filter, remove_manifest,
    remove_synced_song, rename_filter_set, resolve_filter_set, set_device_last_synced_at,
    unclaim_path, upsert_manifest, upsert_synced_song,
};
