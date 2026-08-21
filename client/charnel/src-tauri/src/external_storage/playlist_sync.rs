//! phase 3 + 6: `.m3u8` sync-manifest generation (additive-only in v1).
//!
//! writes one `.m3u8` manifest per selected "sync target" into the
//! device's playlists subpath root, referencing songs by their path
//! relative to the music subpath root. a sync target's song list can come
//! from one of three sources (tried in this order):
//!   1. a real grimoire playlist id.
//!   2. the sentinel [`FAVORITES_KEY`] (the user's favorited songs).
//!   3. an `external_storage_filter_setz` id — a named, rule-based
//!      include/exclude filter-set (phase 6), resolved via
//!      `grimoire::external_storage::resolve_filter_set`.
//!
//! song files themselves are always synced first via
//! `copy_engine::sync_song_to_device` - this module only ever writes/
//! removes `.m3u8` manifest files, never touches a song file directly.
//!
//! v1 never deletes a song file here; deselecting a sync target only
//! removes its `.m3u8` manifest (song files it referenced may still be
//! shared by other synced targets, or simply left in place - see the plan
//! doc's "sync is additive-only" invariant).
//!
//! manifest bookkeeping (which sync targets are selected, and their
//! `.m3u8` filenames) lives in grimoire's `external_storage_sync_manifestz`
//! table (migration 053) — moved off the per-device `.freqhole.db.json`
//! file used before phase 6.
//!
//! see docs/removable-storage-sync-plan.md phases 3 and 6.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde::Serialize;

use grimoire::music::crud::{query_favorites, FavoriteItem};
use grimoire::music::entities::playlists::{get_playlist, get_playlist_songs};

use crate::app_config::FreqholeAppConfig;

use super::copy_engine::sync_song_to_device;
use super::{is_still_mounted, path_naming};

/// sentinel id (in grimoire's manifest table and in the ui) for the
/// synthetic "favorites" sync target - not a real grimoire playlist id.
pub const FAVORITES_KEY: &str = "favorites";

#[derive(Debug, Clone, Serialize)]
pub struct PlaylistSyncOutcome {
    pub playlist_id: String,
    pub title: String,
    pub filename: String,
    pub song_count: usize,
    /// `"{song_id}: {error}"` for any song that failed to sync - the
    /// manifest is still written with whichever songs succeeded.
    pub failed_songs: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SyncPlaylistsResult {
    pub synced: Vec<PlaylistSyncOutcome>,
    /// sync target ids (playlist id, `FAVORITES_KEY`, or filter-set id)
    /// whose `.m3u8` was removed because they were no longer in the
    /// requested selection.
    pub removed: Vec<String>,
}

/// currently-selected sync target ids for a device (drives the overview
/// view's selection state), read from grimoire's manifest table.
pub async fn get_synced_playlist_ids(device_id: &str) -> Result<Vec<String>, String> {
    let manifests = grimoire::external_storage::list_manifests(device_id)
        .await
        .map_err(|e| e.to_string())?;
    Ok(manifests.into_iter().map(|m| m.sync_set_id).collect())
}

/// resolve one sync target id to `(title, song_ids)` — tries a real
/// playlist first, then the favorites sentinel, then a filter-set.
async fn resolve_sync_target(
    app_handle: &tauri::AppHandle,
    id: &str,
) -> Result<(String, Vec<String>), String> {
    if id == FAVORITES_KEY {
        let favorites = query_favorites(&local_user_id(app_handle)?, Some("song"), u32::MAX, 0).await;
        let favorites = favorites.data.ok_or("failed to load favorites".to_string())?;
        let song_ids = favorites
            .into_iter()
            .filter_map(|item| match item {
                FavoriteItem::Song(f) => Some(f.song.song.id),
                _ => None,
            })
            .collect::<Vec<_>>();
        return Ok(("favorites".to_string(), song_ids));
    }

    let playlist_response = get_playlist(id).await;
    if let Some(playlist) = playlist_response.data {
        let songs_response = get_playlist_songs(id).await;
        let songs = songs_response.data.ok_or(songs_response.message)?;
        return Ok((
            playlist.title,
            songs.into_iter().map(|s| s.song_id).collect::<Vec<_>>(),
        ));
    }

    // not a real playlist - try it as a filter-set.
    let filter_set = grimoire::external_storage::get_filter_set(id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("sync target not found (not a playlist, favorites, or filter-set): {id}"))?;
    let song_ids = grimoire::external_storage::resolve_filter_set(id)
        .await
        .map_err(|e| e.to_string())?;
    Ok((filter_set.name, song_ids))
}

/// sync exactly the given set of targets (playlist ids, `FAVORITES_KEY`,
/// and/or filter-set ids) to the device: any previously-synced target
/// missing from `sync_set_ids` has its `.m3u8` removed, and every id in
/// `sync_set_ids` gets its songs synced (add-missing only) and its
/// `.m3u8` regenerated.
pub async fn sync_playlists_to_device(
    app_handle: &tauri::AppHandle,
    device_id: &str,
    sync_set_ids: &[String],
) -> Result<SyncPlaylistsResult, String> {
    let config = FreqholeAppConfig::load(app_handle).unwrap_or_default();
    let device = config
        .external_storage_devices
        .iter()
        .find(|d| d.id == device_id)
        .cloned()
        .ok_or_else(|| "device not found".to_string())?;
    if !is_still_mounted(&device) {
        return Err("device is not mounted".to_string());
    }

    let music_subpath = device
        .subpath
        .clone()
        .unwrap_or_else(|| config.external_storage_default_subpath.clone());
    let playlists_subpath = config.external_storage_playlists_subpath.clone();
    let playlists_root = Path::new(&device.path).join(&playlists_subpath);
    std::fs::create_dir_all(&playlists_root)
        .map_err(|e| format!("failed to create playlists directory: {e}"))?;

    let existing_manifests = grimoire::external_storage::list_manifests(device_id)
        .await
        .map_err(|e| e.to_string())?;

    let desired: HashSet<String> = sync_set_ids.iter().cloned().collect();

    // remove manifests for anything the user deselected - song files
    // themselves are never touched here.
    let mut removed = Vec::new();
    for entry in &existing_manifests {
        if !desired.contains(&entry.sync_set_id) {
            let _ = std::fs::remove_file(playlists_root.join(&entry.filename));
            grimoire::external_storage::remove_manifest(device_id, &entry.sync_set_id)
                .await
                .map_err(|e| e.to_string())?;
            removed.push(entry.sync_set_id.clone());
        }
    }

    // how many `../` steps get from the playlists root back to the
    // device root - the manifest always lives directly under it.
    let up_prefix = "../".repeat(Path::new(&playlists_subpath).components().count());
    let mut used_names: HashSet<String> = HashSet::new();
    let mut synced = Vec::new();

    for id in sync_set_ids {
        let (title, song_ids) = resolve_sync_target(app_handle, id).await?;

        let mut lines = vec!["#EXTM3U".to_string()];
        let mut failed_songs = Vec::new();
        for song_id in &song_ids {
            match sync_song_to_device(app_handle, device_id, song_id).await {
                Ok(result) => lines.push(format!("{up_prefix}{music_subpath}/{}", result.relative_path)),
                Err(e) => failed_songs.push(format!("{song_id}: {e}")),
            }
        }

        let base_filename = if id == FAVORITES_KEY {
            PathBuf::from("favorites.m3u8")
        } else {
            PathBuf::from(format!("{}.m3u8", path_naming::sanitize_segment(&title)))
        };
        let unique = path_naming::uniquify_path(&base_filename, &used_names);
        let filename = unique.to_string_lossy().to_string();
        used_names.insert(filename.clone());

        std::fs::write(playlists_root.join(&filename), lines.join("\n") + "\n")
            .map_err(|e| format!("failed to write playlist \"{title}\": {e}"))?;

        // a title rename can change the filename - the old manifest (if
        // different) is stale now that we've written its replacement.
        if let Some(previous) = existing_manifests.iter().find(|m| m.sync_set_id == *id) {
            if previous.filename != filename {
                let _ = std::fs::remove_file(playlists_root.join(&previous.filename));
            }
        }

        let song_count = song_ids.len() - failed_songs.len();
        grimoire::external_storage::upsert_manifest(device_id, id, &filename)
            .await
            .map_err(|e| e.to_string())?;
        synced.push(PlaylistSyncOutcome {
            playlist_id: id.clone(),
            title,
            filename,
            song_count,
            failed_songs,
        });
    }

    Ok(SyncPlaylistsResult { synced, removed })
}

/// local (single-owner desktop) admin user id, resolved the same way the
/// in-process admin dispatch does.
fn local_user_id(app_handle: &tauri::AppHandle) -> Result<String, String> {
    Ok(crate::commands::get_caller_from_app_config(app_handle)?.user_id)
}
