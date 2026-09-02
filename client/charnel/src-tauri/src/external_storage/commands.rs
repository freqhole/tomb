//! tauri command surface for the removable-storage sync feature.
//!
//! see docs/removable-storage-sync-plan.md. kept isolated from
//! `commands.rs` (already huge) and from `external_storage::mod` (which
//! only holds platform-specific volume/eject helpers, no tauri/config
//! glue). a single `external_storage_command` entrypoint dispatches on
//! `action` rather than registering a separate tauri command per
//! operation.

use std::collections::HashSet;
use std::sync::{LazyLock, Mutex};

use super::{disk_usage, eject_device, is_still_mounted, path_naming, resolve_volume_info};
use crate::app_config::{ExternalStorageDevice, FreqholeAppConfig};
use serde::{Deserialize, Serialize};

/// last set of mounted device ids seen by *any* window's `ListMounted`
/// call - lets that call detect when it's the first to notice a change
/// (e.g. the wizard's storage view was opened before the os-level watcher
/// fired, or before a device was even configured) so it can nudge every
/// other window rather than leaving them stale until the next watcher
/// event. compared by value (not just "did the watcher already tell us"),
/// so this converges after at most one extra round-trip instead of
/// looping: a `ListMounted` call triggered BY a `notify_...` listener
/// will see no further diff against the set it just wrote, and stop.
static LAST_MOUNTED_IDS: LazyLock<Mutex<Option<HashSet<String>>>> =
    LazyLock::new(|| Mutex::new(None));

/// global removable-storage sync settings, shared by every configured
/// device (per-device state - which device, its subpath override, etc -
/// lives in `ExternalStorageDevice` instead).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExternalStorageSettings {
    pub default_subpath: String,
    pub playlists_subpath: String,
    pub playlists_sync_enabled: bool,
    pub reencode_enabled: bool,
    pub reencode_args: String,
    pub reencode_extension: String,
}

/// total/free/used space (bytes) on the filesystem a device lives on,
/// for the phase-1 read-only storage overview.
#[derive(Debug, Clone, Serialize)]
pub struct DiskUsageResult {
    pub total_bytes: u64,
    pub free_bytes: u64,
    pub used_bytes: u64,
}

/// a configured device, enriched with stats that live in grimoire's sql
/// db (migration 053) rather than in the toml config alongside the
/// device's own identity fields.
#[derive(Debug, Clone, Serialize)]
pub struct DeviceWithStats {
    #[serde(flatten)]
    pub device: ExternalStorageDevice,
    /// unix ms timestamp of the last completed sync to this device, if any.
    pub last_synced_at: Option<i64>,
    /// real write-access probe (not just "does the path exist") - catches
    /// a stale flatpak document-portal grant (permission revoked) that
    /// still resolves as a readable/existing path but can no longer be
    /// written through. see docs/flatpak-filesystem-access-plan.md phase C4.
    pub path_writable: bool,
}

async fn with_stats(device: ExternalStorageDevice) -> DeviceWithStats {
    let last_synced_at = grimoire::external_storage::get_device_last_synced_at(&device.id)
        .await
        .unwrap_or(None);
    let path_writable = crate::commands::check_dir_writable(device.path.clone());
    DeviceWithStats {
        device,
        last_synced_at,
        path_writable,
    }
}

async fn with_stats_many(devices: Vec<ExternalStorageDevice>) -> Vec<DeviceWithStats> {
    let mut out = Vec::with_capacity(devices.len());
    for device in devices {
        out.push(with_stats(device).await);
    }
    out
}

/// one group's contribution to a filter-set projection - named the same
/// as the `.m3u8` a real sync would write for it (see
/// `FilterSetProjection`).
#[derive(Debug, Clone, Serialize)]
pub struct FilterSetGroupCount {
    pub name: String,
    pub song_count: usize,
}

/// a filter-set's actual, per-group resolved song matches - what
/// `sync_playlists_to_device` would actually copy/write if run right
/// now, broken down the same way it breaks manifests down (one entry per
/// include clause's group).
#[derive(Debug, Clone, Serialize)]
pub struct FilterSetProjection {
    pub groups: Vec<FilterSetGroupCount>,
    /// distinct song count across every group combined (the same dedup
    /// `sync_playlists_to_device` does before copying) - the actual
    /// number of song files a sync would end up with.
    pub total_song_count: usize,
}

/// tagged action payload for `external_storage_command`.
#[derive(Debug, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum ExternalStorageAction {
    /// get the global removable-storage sync settings (defaults if unset).
    GetSettings,
    /// save the global removable-storage sync settings.
    SetSettings { settings: ExternalStorageSettings },
    /// all remembered devices (not necessarily mounted right now).
    GetDevices,
    /// of the remembered devices, which ones are currently mounted -
    /// drives playerbar icon visibility and the multi-device picker.
    ListMounted,
    /// the currently-active device, if selected and still mounted.
    GetActive,
    /// add (or re-select) a device from a folder-picker result. upserts
    /// by id (volume uuid, falling back to path) and sets it active.
    /// `subpath` is optional - omit to fall back to the global default.
    AddDevice {
        path: String,
        subpath: Option<String>,
    },
    /// switch which remembered device is "active" in the ui.
    SetActive { id: String },
    /// forget a remembered device (does not touch files already written).
    RemoveDevice { id: String },
    /// ask the os to unmount/eject a device by id.
    EjectDevice { id: String },
    /// total/free space on the filesystem a remembered device lives on.
    DiskUsage { id: String },
    /// copy (or re-encode) one song onto a device, tagging/moving/merging
    /// as needed - see `copy_engine`.
    SyncSong { device_id: String, song_id: String },
    /// resolve the exact selection of sync target ids (real playlist ids,
    /// the synthetic `"favorites"` id, and/or filter-set ids) currently
    /// written to a device's playlists subpath, for pre-checking the
    /// overview view's selection state.
    GetSyncedPlaylistIds { device_id: String },
    /// sync exactly this set of targets (playlist ids, `"favorites"`,
    /// and/or filter-set ids) to a device - see `playlist_sync`.
    SyncPlaylists {
        device_id: String,
        playlist_ids: Vec<String>,
    },
    /// best-effort "would this fit" size estimate for a selection of
    /// sync targets, without actually syncing anything - lets the ui
    /// warn before starting if the device looks too full.
    EstimateSyncSize {
        device_id: String,
        playlist_ids: Vec<String>,
    },
    /// stop the in-progress sync for a device before its next song -
    /// sync is additive/idempotent, so a later `SyncPlaylists` call with
    /// the same targets just resumes from where this paused.
    PauseSync { device_id: String },
    /// list every named sync filter-set (phase 6).
    ListFilterSets,
    /// create a new, empty named sync filter-set.
    CreateFilterSet { name: String },
    /// rename an existing sync filter-set.
    RenameFilterSet { id: String, name: String },
    /// delete a sync filter-set (and its filter clauses, via cascade).
    DeleteFilterSet { id: String },
    /// get (or lazily create) the one default filter-set for a device -
    /// the primary entry point the ui uses today (see
    /// docs/removable-storage-sync-plan.md phase 6).
    GetOrCreateDefaultFilterSet { device_id: String },
    /// list a filter-set's include/exclude filter clauses.
    ListFilterSetFilters { filter_set_id: String },
    /// add one include/exclude filter clause to a filter-set.
    AddFilterSetFilter {
        filter_set_id: String,
        filter_type: String,
        filter_value: String,
        mode: String,
        /// only meaningful for `filter_type` `"favorite"`/`"rating_gte"`/
        /// `"rating_lte"`: `"me"` (default) or `"everyone"`. ignored for
        /// every other type.
        criteria_scope: Option<String>,
    },
    /// remove one filter clause by its own id.
    RemoveFilterSetFilter { filter_id: String },
    /// resolve a filter-set into its actual per-group song matches, for
    /// previewing what a sync would write before running it - mirrors
    /// `sync_playlists_to_device`'s per-group `.m3u8` expansion exactly
    /// (one group per include clause), unlike the old single
    /// all-clauses-intersected `ResolveFilterSet` preview this replaced.
    GetFilterSetProjection { filter_set_id: String },
    /// count of distinct songs already copied onto a device - the
    /// "actual" half of the overview view's actual-vs-projected songs
    /// display.
    GetSyncedSongCount { device_id: String },
}

/// serialize a response value, mapping serde errors to the plain `String`
/// error type every tauri command in this module returns.
fn to_value<T: Serialize>(v: T) -> Result<serde_json::Value, String> {
    serde_json::to_value(v).map_err(|e| e.to_string())
}

fn nonempty_or_default(value: String, fallback: &str) -> String {
    if value.trim().is_empty() {
        fallback.to_string()
    } else {
        value
    }
}

/// single tauri command entrypoint for all removable-storage sync
/// operations.
#[tauri::command]
pub async fn external_storage_command(
    app_handle: tauri::AppHandle,
    action: ExternalStorageAction,
) -> Result<serde_json::Value, String> {
    match action {
        ExternalStorageAction::GetSettings => {
            let mut config = FreqholeAppConfig::load(&app_handle).unwrap_or_default();
            let default_subpath =
                nonempty_or_default(config.external_storage_default_subpath.clone(), "Music");
            let playlists_subpath = nonempty_or_default(
                config.external_storage_playlists_subpath.clone(),
                "Playlists",
            );
            // Persist the repair so copy_engine sees the default too, rather
            // than merely making the settings field look correct.
            if config.external_storage_default_subpath != default_subpath
                || config.external_storage_playlists_subpath != playlists_subpath
            {
                config.external_storage_default_subpath = default_subpath.clone();
                config.external_storage_playlists_subpath = playlists_subpath.clone();
                config.save(&app_handle)?;
            }
            to_value(ExternalStorageSettings {
                // Older config files can contain an explicit empty string,
                // which bypasses serde's missing-field default and made the
                // device music root silently become its mount root.
                default_subpath,
                playlists_subpath,
                playlists_sync_enabled: !config.external_storage_playlists_sync_disabled,
                reencode_enabled: config.external_storage_reencode_enabled,
                reencode_args: config.external_storage_reencode_args,
                reencode_extension: config.external_storage_reencode_extension,
            })
        }

        ExternalStorageAction::SetSettings { settings } => {
            let mut config = FreqholeAppConfig::load(&app_handle).unwrap_or_default();
            config.external_storage_default_subpath = nonempty_or_default(
                path_naming::sanitize_subpath(&settings.default_subpath),
                "Music",
            );
            config.external_storage_playlists_subpath = nonempty_or_default(
                path_naming::sanitize_subpath(&settings.playlists_subpath),
                "Playlists",
            );
            config.external_storage_playlists_sync_disabled = !settings.playlists_sync_enabled;
            config.external_storage_reencode_enabled = settings.reencode_enabled;
            config.external_storage_reencode_args = settings.reencode_args;
            config.external_storage_reencode_extension = settings.reencode_extension;
            config.save(&app_handle)?;
            to_value(())
        }

        ExternalStorageAction::GetDevices => {
            let devices = FreqholeAppConfig::load(&app_handle)
                .map(|c| c.external_storage_devices)
                .unwrap_or_default();
            to_value(with_stats_many(devices).await)
        }

        ExternalStorageAction::ListMounted => {
            let config = FreqholeAppConfig::load(&app_handle).unwrap_or_default();
            let mounted: Vec<ExternalStorageDevice> = config
                .external_storage_devices
                .into_iter()
                .filter(is_still_mounted)
                .collect();
            let current_ids: HashSet<String> = mounted.iter().map(|d| d.id.clone()).collect();
            let changed = {
                let mut last = LAST_MOUNTED_IDS.lock().unwrap_or_else(|p| p.into_inner());
                let changed = last.as_ref() != Some(&current_ids);
                if changed {
                    *last = Some(current_ids);
                }
                changed
            };
            if changed {
                let _ = crate::spume_bridge::notify_external_storage_mounted_changed(&app_handle);
            }
            to_value(with_stats_many(mounted).await)
        }

        ExternalStorageAction::GetActive => {
            let config = FreqholeAppConfig::load(&app_handle).unwrap_or_default();
            let active = config
                .active_external_storage_device_id
                .as_ref()
                .and_then(|active_id| {
                    config
                        .external_storage_devices
                        .iter()
                        .find(|d| &d.id == active_id)
                        .cloned()
                })
                .filter(is_still_mounted);
            match active {
                Some(device) => to_value(Some(with_stats(device).await)),
                None => to_value(Option::<DeviceWithStats>::None),
            }
        }

        ExternalStorageAction::AddDevice { path, subpath } => {
            let resolved_path = grimoire::paths::canonical_path_string(&path);
            let (volume_name, volume_uuid) = resolve_volume_info(&resolved_path);
            let id = volume_uuid.clone().unwrap_or_else(|| resolved_path.clone());
            let subpath = subpath
                .map(|s| path_naming::sanitize_subpath(&s))
                .filter(|s| !s.is_empty());

            let mut config = FreqholeAppConfig::load(&app_handle).unwrap_or_default();

            let device = if let Some(existing) = config
                .external_storage_devices
                .iter_mut()
                .find(|d| d.id == id)
            {
                existing.path = resolved_path;
                existing.volume_name = volume_name;
                existing.volume_uuid = volume_uuid;
                if subpath.is_some() {
                    existing.subpath = subpath;
                }
                existing.clone()
            } else {
                let device = ExternalStorageDevice {
                    id: id.clone(),
                    path: resolved_path,
                    volume_name,
                    volume_uuid,
                    subpath,
                };
                config.external_storage_devices.push(device.clone());
                device
            };

            config.active_external_storage_device_id = Some(id);
            config.save(&app_handle)?;
            // first device just got configured - safe to start the mount
            // watcher now (no-op if it's already running).
            super::watcher::ensure_started(app_handle.clone());
            to_value(with_stats(device).await)
        }

        ExternalStorageAction::SetActive { id } => {
            let mut config = FreqholeAppConfig::load(&app_handle).unwrap_or_default();
            config.active_external_storage_device_id = Some(id);
            config.save(&app_handle)?;
            to_value(())
        }

        ExternalStorageAction::RemoveDevice { id } => {
            let mut config = FreqholeAppConfig::load(&app_handle).unwrap_or_default();
            config.external_storage_devices.retain(|d| d.id != id);
            if config.active_external_storage_device_id.as_deref() == Some(id.as_str()) {
                config.active_external_storage_device_id = None;
            }
            config.save(&app_handle)?;
            to_value(())
        }

        ExternalStorageAction::EjectDevice { id } => {
            let config = FreqholeAppConfig::load(&app_handle).unwrap_or_default();
            let device = config
                .external_storage_devices
                .iter()
                .find(|d| d.id == id)
                .ok_or_else(|| "device not found".to_string())?;
            eject_device(&device.path)?;
            to_value(())
        }

        ExternalStorageAction::DiskUsage { id } => {
            let config = FreqholeAppConfig::load(&app_handle).unwrap_or_default();
            let device = config
                .external_storage_devices
                .iter()
                .find(|d| d.id == id)
                .ok_or_else(|| "device not found".to_string())?;
            let (total_bytes, free_bytes) =
                disk_usage(&device.path).ok_or_else(|| "failed to read disk usage".to_string())?;
            to_value(DiskUsageResult {
                total_bytes,
                free_bytes,
                used_bytes: total_bytes.saturating_sub(free_bytes),
            })
        }

        ExternalStorageAction::SyncSong { device_id, song_id } => {
            let result =
                super::copy_engine::sync_song_to_device(&app_handle, &device_id, &song_id).await?;
            to_value(result)
        }

        ExternalStorageAction::GetSyncedPlaylistIds { device_id } => {
            let ids = super::playlist_sync::get_synced_playlist_ids(&device_id).await?;
            to_value(ids)
        }

        ExternalStorageAction::SyncPlaylists {
            device_id,
            playlist_ids,
        } => {
            let result = super::playlist_sync::sync_playlists_to_device(
                &app_handle,
                &device_id,
                &playlist_ids,
            )
            .await?;
            to_value(result)
        }

        ExternalStorageAction::EstimateSyncSize {
            device_id,
            playlist_ids,
        } => {
            let estimate =
                super::playlist_sync::estimate_sync_size(&app_handle, &device_id, &playlist_ids)
                    .await?;
            to_value(estimate)
        }

        ExternalStorageAction::PauseSync { device_id } => {
            super::playlist_sync::request_pause(&device_id);
            to_value(())
        }

        ExternalStorageAction::ListFilterSets => {
            let sets = grimoire::external_storage::list_filter_sets()
                .await
                .map_err(|e| e.to_string())?;
            to_value(sets)
        }

        ExternalStorageAction::CreateFilterSet { name } => {
            let set = grimoire::external_storage::create_filter_set(&name)
                .await
                .map_err(|e| e.to_string())?;
            to_value(set)
        }

        ExternalStorageAction::RenameFilterSet { id, name } => {
            let set = grimoire::external_storage::rename_filter_set(&id, &name)
                .await
                .map_err(|e| e.to_string())?;
            to_value(set)
        }

        ExternalStorageAction::DeleteFilterSet { id } => {
            grimoire::external_storage::delete_filter_set(&id)
                .await
                .map_err(|e| e.to_string())?;
            to_value(())
        }

        ExternalStorageAction::GetOrCreateDefaultFilterSet { device_id } => {
            let set = grimoire::external_storage::get_or_create_default_filter_set(&device_id)
                .await
                .map_err(|e| e.to_string())?;
            to_value(set)
        }

        ExternalStorageAction::ListFilterSetFilters { filter_set_id } => {
            let filters = grimoire::external_storage::list_filter_set_filters(&filter_set_id)
                .await
                .map_err(|e| e.to_string())?;
            to_value(filters)
        }

        ExternalStorageAction::AddFilterSetFilter {
            filter_set_id,
            filter_type,
            filter_value,
            mode,
            criteria_scope,
        } => {
            let filter = grimoire::external_storage::add_filter_set_filter(
                &filter_set_id,
                &filter_type,
                &filter_value,
                &mode,
                criteria_scope.as_deref(),
            )
            .await
            .map_err(|e| e.to_string())?;
            to_value(filter)
        }

        ExternalStorageAction::RemoveFilterSetFilter { filter_id } => {
            grimoire::external_storage::remove_filter_set_filter(&filter_id)
                .await
                .map_err(|e| e.to_string())?;
            to_value(())
        }

        ExternalStorageAction::GetFilterSetProjection { filter_set_id } => {
            let user_id = crate::commands::get_caller_from_app_config(&app_handle)?.user_id;
            let groups =
                grimoire::external_storage::resolve_filter_set_groups(&filter_set_id, &user_id)
                    .await
                    .map_err(|e| e.to_string())?;
            let mut distinct: std::collections::HashSet<String> = std::collections::HashSet::new();
            let groups: Vec<FilterSetGroupCount> = groups
                .iter()
                .map(|g| {
                    distinct.extend(g.song_ids.iter().cloned());
                    FilterSetGroupCount {
                        name: g.name.clone(),
                        song_count: g.song_ids.len(),
                    }
                })
                .collect();
            to_value(FilterSetProjection {
                groups,
                total_song_count: distinct.len(),
            })
        }

        ExternalStorageAction::GetSyncedSongCount { device_id } => {
            let songs = grimoire::external_storage::list_synced_songs(&device_id)
                .await
                .map_err(|e| e.to_string())?;
            to_value(songs.len())
        }
    }
}
