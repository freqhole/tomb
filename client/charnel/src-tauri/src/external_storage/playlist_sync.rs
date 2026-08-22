//! phase 3 + 6: `.m3u8` sync-manifest generation (additive-only in v1).
//!
//! writes one `.m3u8` manifest per selected "sync target" into the
//! device's playlists subpath root, referencing songs by their path
//! relative to the music subpath root. a sync target's song list can come
//! from one of three sources (tried in this order):
//!   1. a real grimoire playlist id.
//!   2. the sentinel [`FAVORITES_KEY`] (the user's favorited songs).
//!   3. an `external_storage_filter_setz` id — a named, rule-based
//!      include/exclude filter-set (phase 6). rather than one combined
//!      manifest, this expands into one manifest per include clause via
//!      `grimoire::external_storage::resolve_filter_set_groups` (phase
//!      8) — e.g. two included playlists plus a favorites include plus a
//!      tag include yields four `.m3u8` files, not one merged file.
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
//! file used before phase 6. a filter-set's expanded groups are tracked
//! as `"{filter_set_id}::{group_key}"` manifest ids so each group gets
//! its own row/filename, and a group's clause being removed shows up as
//! that composite id no longer being desired.
//!
//! see docs/removable-storage-sync-plan.md phases 3 and 6.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use serde::Serialize;

use grimoire::media_blobz::get_media_blob;
use grimoire::music::crud::{query_favorites, FavoriteItem};
use grimoire::music::entities::playlists::{get_playlist, get_playlist_songs};
use grimoire::music::entities::songs::{get_song, sort_song_ids_by_album_order};

use crate::app_config::FreqholeAppConfig;

use super::copy_engine::sync_song_to_device;
use super::{disk_usage, is_still_mounted, path_naming};

/// headroom kept back on top of a song's estimated size before a sync
/// will attempt to write it - never trust a free-space reading down to
/// the last byte.
const LOW_DISK_SPACE_SAFETY_MARGIN_BYTES: u64 = 20 * 1024 * 1024;

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
    /// `"{song_id}: {warning}"` for any song whose audio synced fine but
    /// whose id3/vorbis tags failed to write (e.g. a malformed source
    /// frame) - non-fatal, the song is still counted in `song_count` and
    /// listed in the manifest.
    pub tag_warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SyncPlaylistsResult {
    pub synced: Vec<PlaylistSyncOutcome>,
    /// sync target ids (playlist id, `FAVORITES_KEY`, or filter-set id)
    /// whose `.m3u8` was removed because they were no longer in the
    /// requested selection.
    pub removed: Vec<String>,
    /// true if `request_pause` stopped this run before every requested
    /// sync target finished - sync is idempotent/additive (see the plan
    /// doc's never-overwrite invariant), so a later call with the same
    /// `sync_set_ids` just resumes from wherever this one left off.
    pub paused: bool,
    /// true if this run stopped early because the device looked too full
    /// to safely fit the next song (see `LOW_DISK_SPACE_SAFETY_MARGIN_BYTES`).
    /// also sets `paused`, since the resume story is identical: free up
    /// space (or plug in a roomier device) and call sync again.
    pub low_disk_space: bool,
}

/// best-effort estimate of a filter-set/playlist selection's total sync
/// size before actually starting, for a heads-up "this probably won't
/// fit" warning in the ui.
#[derive(Debug, Clone, Serialize)]
pub struct SyncSizeEstimate {
    /// bytes needed for songs not yet on the device (or whose source
    /// audio changed since their last sync) - see
    /// `estimate_pending_song_bytes` for what this does and doesn't
    /// account for.
    pub needed_bytes: u64,
    /// current free space on the device, if it could be determined.
    pub available_bytes: Option<u64>,
    /// how many of the resolved songs `needed_bytes` covers (already-
    /// synced, unchanged songs are excluded - they need no new bytes).
    pub pending_song_count: usize,
}

/// one concrete `.m3u8` target after expanding filter-sets into their
/// per-clause groups - a playlist or `FAVORITES_KEY` target resolves to
/// exactly one of these, a filter-set to zero or more.
struct ResolvedTarget {
    /// manifest table key - the raw id for a playlist/favorites target,
    /// or `"{filter_set_id}::{group_key}"` for a filter-set group.
    manifest_id: String,
    title: String,
    song_ids: Vec<String>,
}

static CANCEL_FLAGS: OnceLock<Mutex<std::collections::HashMap<String, Arc<AtomicBool>>>> =
    OnceLock::new();

fn cancel_flag_for(device_id: &str) -> Arc<AtomicBool> {
    let map = CANCEL_FLAGS.get_or_init(|| Mutex::new(std::collections::HashMap::new()));
    let mut map = map.lock().unwrap_or_else(|p| p.into_inner());
    map.entry(device_id.to_string())
        .or_insert_with(|| Arc::new(AtomicBool::new(false)))
        .clone()
}

/// request the sync currently running for `device_id` (if any) to stop
/// before its next song - see `SyncPlaylistsResult::paused`.
pub fn request_pause(device_id: &str) {
    cancel_flag_for(device_id).store(true, Ordering::SeqCst);
}

/// currently-selected sync target ids for a device (drives the overview
/// view's selection state), read from grimoire's manifest table.
pub async fn get_synced_playlist_ids(device_id: &str) -> Result<Vec<String>, String> {
    let manifests = grimoire::external_storage::list_manifests(device_id)
        .await
        .map_err(|e| e.to_string())?;
    Ok(manifests.into_iter().map(|m| m.sync_set_id).collect())
}

/// resolve one requested sync target id into its concrete `.m3u8`
/// targets - tries a real playlist first, then the favorites sentinel,
/// then a filter-set (which expands into one target per include clause;
/// see the module doc comment).
async fn resolve_sync_targets(
    app_handle: &tauri::AppHandle,
    id: &str,
) -> Result<Vec<ResolvedTarget>, String> {
    if id == FAVORITES_KEY {
        let favorites =
            query_favorites(&local_user_id(app_handle)?, Some("song"), u32::MAX, 0).await;
        let favorites = favorites
            .data
            .ok_or("failed to load favorites".to_string())?;
        let song_ids = favorites
            .into_iter()
            .filter_map(|item| match item {
                FavoriteItem::Song(f) => Some(f.song.song.id),
                _ => None,
            })
            .collect::<Vec<_>>();
        // favorites have no inherent listening order - group by
        // artist/album and play albums straight through rather than
        // whatever order they happened to be favorited in.
        let song_ids = sort_song_ids_by_album_order(&song_ids)
            .await
            .map_err(|e| e.to_string())?;
        return Ok(vec![ResolvedTarget {
            manifest_id: id.to_string(),
            title: "favorites".to_string(),
            song_ids,
        }]);
    }

    let playlist_response = get_playlist(id).await;
    if let Some(playlist) = playlist_response.data {
        let songs_response = get_playlist_songs(id).await;
        let songs = songs_response.data.ok_or(songs_response.message)?;
        return Ok(vec![ResolvedTarget {
            manifest_id: id.to_string(),
            title: playlist.title,
            song_ids: songs.into_iter().map(|s| s.song_id).collect::<Vec<_>>(),
        }]);
    }

    // not a real playlist - try it as a filter-set.
    let filter_set = grimoire::external_storage::get_filter_set(id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| {
            format!("sync target not found (not a playlist, favorites, or filter-set): {id}")
        })?;
    let groups =
        grimoire::external_storage::resolve_filter_set_groups(id, &local_user_id(app_handle)?)
            .await
            .map_err(|e| e.to_string())?;
    if groups.is_empty() {
        // no clauses configured yet - nothing to sync, but keep behaving
        // like a single (empty) target rather than silently vanishing.
        return Ok(vec![ResolvedTarget {
            manifest_id: id.to_string(),
            title: filter_set.name,
            song_ids: Vec::new(),
        }]);
    }
    // a filter-set group is a rule match (favorite/taxon/tag/artist/
    // album/playlist-membership/etc.), never a hand-curated order - group
    // by artist/album and play albums straight through instead of
    // whatever order the match query happened to return.
    let mut targets = Vec::with_capacity(groups.len());
    for group in groups {
        let song_ids = sort_song_ids_by_album_order(&group.song_ids)
            .await
            .map_err(|e| e.to_string())?;
        targets.push(ResolvedTarget {
            manifest_id: format!("{id}::{}", group.key),
            title: group.name,
            song_ids,
        });
    }
    Ok(targets)
}

/// every distinct song id a selection of sync targets resolves to,
/// deduplicated - shared by the real sync loop and by `estimate_sync_size`.
async fn resolve_unique_song_ids(
    app_handle: &tauri::AppHandle,
    sync_set_ids: &[String],
) -> Result<Vec<String>, String> {
    let mut resolved_targets = Vec::new();
    for id in sync_set_ids {
        resolved_targets.extend(resolve_sync_targets(app_handle, id).await?);
    }
    let mut unique_song_ids: Vec<String> = Vec::new();
    let mut seen_songs: HashSet<String> = HashSet::new();
    for target in &resolved_targets {
        for song_id in &target.song_ids {
            if seen_songs.insert(song_id.clone()) {
                unique_song_ids.push(song_id.clone());
            }
        }
    }
    Ok(unique_song_ids)
}

/// best-effort estimated bytes this song still needs on `device_id` -
/// zero once it's already synced with unchanged source audio *and* the
/// synced file is actually still sitting at its recorded path under
/// `music_root` (a later rename/retag-only re-sync uses `std::fs::rename`
/// on the same filesystem, which costs no meaningful extra space - see
/// `copy_engine::sync_song_to_device`). if the recorded file is missing
/// (deleted directly on-device, or the device's music subpath changed
/// since the last sync), the full size is needed again, since
/// `sync_song_to_device` will now re-write it rather than assume it's
/// already there. only an estimate: it's the *source* file's size, so a
/// re-encode (`external_storage_reencode_enabled`) producing a
/// differently-sized output isn't reflected - good enough for a heads-up
/// warning and a stop-before-writing safety check, not an exact
/// accounting.
async fn estimate_pending_song_bytes(device_id: &str, song_id: &str, music_root: &Path) -> u64 {
    let Some(song) = get_song(song_id).await.data else {
        return 0;
    };
    let Ok(blob) = get_media_blob(&song.media_blob_id).await else {
        return 0;
    };
    let Some(size) = blob.size.filter(|s| *s > 0).map(|s| s as u64) else {
        return 0;
    };
    match grimoire::external_storage::get_synced_song(device_id, song_id).await {
        Ok(Some(existing)) if existing.sha256 == blob.sha256 => {
            if music_root.join(&existing.relative_path).exists() {
                0
            } else {
                size
            }
        }
        _ => size,
    }
}

/// best-effort "would this batch fit" check, run before a sync starts so
/// the ui can warn about likely-insufficient free space. this is only a
/// snapshot - the actual sync (`sync_playlists_to_device`) re-checks as
/// it goes and stops early rather than trusting this estimate for an
/// entire run.
pub async fn estimate_sync_size(
    app_handle: &tauri::AppHandle,
    device_id: &str,
    sync_set_ids: &[String],
) -> Result<SyncSizeEstimate, String> {
    let config = FreqholeAppConfig::load(app_handle).unwrap_or_default();
    let device = config
        .external_storage_devices
        .iter()
        .find(|d| d.id == device_id)
        .cloned()
        .ok_or_else(|| "device not found".to_string())?;

    let unique_song_ids = resolve_unique_song_ids(app_handle, sync_set_ids).await?;

    let music_subpath = device
        .subpath
        .clone()
        .unwrap_or_else(|| config.external_storage_default_subpath.clone());
    let music_root = Path::new(&device.path).join(&music_subpath);

    let mut needed_bytes: u64 = 0;
    let mut pending_song_count = 0usize;
    for song_id in &unique_song_ids {
        let bytes = estimate_pending_song_bytes(device_id, song_id, &music_root).await;
        if bytes > 0 {
            needed_bytes += bytes;
            pending_song_count += 1;
        }
    }

    let available_bytes = disk_usage(&device.path).map(|(_, free)| free);

    Ok(SyncSizeEstimate {
        needed_bytes,
        available_bytes,
        pending_song_count,
    })
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
    let music_root = Path::new(&device.path).join(&music_subpath);
    let playlists_enabled = !config.external_storage_playlists_sync_disabled;
    let playlists_subpath = config.external_storage_playlists_subpath.clone();
    let playlists_root = Path::new(&device.path).join(&playlists_subpath);
    if playlists_enabled {
        std::fs::create_dir_all(&playlists_root)
            .map_err(|e| format!("failed to create playlists directory: {e}"))?;
    }

    let existing_manifests = if playlists_enabled {
        grimoire::external_storage::list_manifests(device_id)
            .await
            .map_err(|e| e.to_string())?
    } else {
        Vec::new()
    };

    let mut resolved_targets = Vec::new();
    for id in sync_set_ids {
        resolved_targets.extend(resolve_sync_targets(app_handle, id).await?);
    }
    let desired: HashSet<String> = resolved_targets
        .iter()
        .map(|t| t.manifest_id.clone())
        .collect();

    // remove manifests for anything the user deselected - song files
    // themselves are never touched here. nothing to do here when
    // playlist syncing is disabled - `existing_manifests` is empty.
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

    let cancel_flag = cancel_flag_for(device_id);
    cancel_flag.store(false, Ordering::SeqCst);
    let mut paused = false;

    // sync every distinct song referenced by any target exactly once -
    // the same song commonly shows up in several groups at once (e.g.
    // favorited *and* on an included playlist), and `sync_song_to_device`
    // is not free to call redundantly (hashing/re-encoding/tag writes per
    // call), so resolve it once here and look results up per manifest
    // below instead of re-syncing it once per group it belongs to.
    let mut unique_song_ids: Vec<String> = Vec::new();
    let mut seen_songs: HashSet<String> = HashSet::new();
    for target in &resolved_targets {
        for song_id in &target.song_ids {
            if seen_songs.insert(song_id.clone()) {
                unique_song_ids.push(song_id.clone());
            }
        }
    }

    let mut song_results: std::collections::HashMap<
        String,
        Result<(String, Option<String>), String>,
    > = std::collections::HashMap::new();
    let total = unique_song_ids.len() as u32;

    // running free-space estimate: read it once here rather than re-
    // shelling `df` per song (see `disk_usage`), then decrement it by
    // each song's estimated size as we go - only meant to stop *before*
    // a write that looks certain to fail, not as an exact guarantee (see
    // `estimate_pending_song_bytes`'s caveats).
    let mut remaining_free_bytes = disk_usage(&device.path).map(|(_, free)| free);
    let mut low_disk_space = false;

    for (idx, song_id) in unique_song_ids.iter().enumerate() {
        if cancel_flag.load(Ordering::SeqCst) {
            paused = true;
            break;
        }

        let estimated_bytes = estimate_pending_song_bytes(device_id, song_id, &music_root).await;
        if let Some(free) = remaining_free_bytes {
            if estimated_bytes.saturating_add(LOW_DISK_SPACE_SAFETY_MARGIN_BYTES) > free {
                // not enough room left for this song (or its safety
                // margin) - stop here rather than risk a half-written
                // file. everything synced so far, and every manifest, is
                // already complete and safe to leave as-is (the sync's
                // additive-only invariant).
                low_disk_space = true;
                paused = true;
                break;
            }
        }

        let _ = crate::spume_bridge::notify_external_storage_sync_progress(
            app_handle,
            device_id,
            "songs",
            (idx + 1) as u32,
            total,
        );
        let outcome = match sync_song_to_device(app_handle, device_id, song_id).await {
            Ok(result) => Ok((result.relative_path, result.tag_warning)),
            Err(e) => Err(format!("{song_id}: {e}")),
        };
        if let Some(free) = remaining_free_bytes.as_mut() {
            *free = free.saturating_sub(estimated_bytes);
        }
        song_results.insert(song_id.clone(), outcome);
    }

    // every target still gets its manifest (re)written with whichever
    // songs were synced so far, even on a paused run - a song this target
    // references that wasn't reached this run falls back to its
    // already-on-device path from an earlier sync (see the `None` arm
    // below), so a low-disk-space/cancelled run never clobbers a
    // previously-complete manifest down to only the songs it happened to
    // touch this time.
    for target in &resolved_targets {
        let title = &target.title;

        let mut lines = vec!["#EXTM3U".to_string()];
        let mut failed_songs = Vec::new();
        let mut tag_warnings = Vec::new();
        let mut synced_count = 0usize;
        for song_id in &target.song_ids {
            match song_results.get(song_id) {
                Some(Ok((relative_path, tag_warning))) => {
                    lines.push(format!("{up_prefix}{music_subpath}/{relative_path}"));
                    synced_count += 1;
                    if let Some(warning) = tag_warning {
                        tag_warnings.push(format!("{song_id}: {warning}"));
                    }
                }
                Some(Err(e)) => failed_songs.push(e.clone()),
                None => {
                    // this run paused (disk-full/cancelled) before ever
                    // reaching this song - if it's already on the device
                    // from an earlier sync, keep it in the manifest
                    // rather than silently dropping it just because this
                    // run didn't re-touch it.
                    if let Ok(Some(existing)) =
                        grimoire::external_storage::get_synced_song(device_id, song_id).await
                    {
                        lines.push(format!(
                            "{up_prefix}{music_subpath}/{}",
                            existing.relative_path
                        ));
                        synced_count += 1;
                    }
                }
            }
        }

        let filename = if playlists_enabled {
            let base_filename =
                PathBuf::from(format!("{}.m3u8", path_naming::sanitize_segment(title)));
            let unique = path_naming::uniquify_path(&base_filename, &used_names);
            let filename = unique.to_string_lossy().to_string();
            used_names.insert(filename.clone());

            std::fs::write(playlists_root.join(&filename), lines.join("\n") + "\n")
                .map_err(|e| format!("failed to write playlist \"{title}\": {e}"))?;

            // a title rename can change the filename - the old manifest (if
            // different) is stale now that we've written its replacement.
            if let Some(previous) = existing_manifests
                .iter()
                .find(|m| m.sync_set_id == target.manifest_id)
            {
                if previous.filename != filename {
                    let _ = std::fs::remove_file(playlists_root.join(&previous.filename));
                }
            }

            grimoire::external_storage::upsert_manifest(device_id, &target.manifest_id, &filename)
                .await
                .map_err(|e| e.to_string())?;
            filename
        } else {
            String::new()
        };
        synced.push(PlaylistSyncOutcome {
            playlist_id: target.manifest_id.clone(),
            title: title.clone(),
            filename,
            song_count: synced_count,
            failed_songs,
            tag_warnings,
        });
    }

    Ok(SyncPlaylistsResult {
        synced,
        removed,
        paused,
        low_disk_space,
    })
}

/// local (single-owner desktop) admin user id, resolved the same way the
/// in-process admin dispatch does.
fn local_user_id(app_handle: &tauri::AppHandle) -> Result<String, String> {
    Ok(crate::commands::get_caller_from_app_config(app_handle)?.user_id)
}
