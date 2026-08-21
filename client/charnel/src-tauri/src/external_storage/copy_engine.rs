//! phase 2 copy engine: syncs a single song from grimoire's local library
//! onto a configured removable-storage device.
//!
//! handles three cases against grimoire's sql-backed sync state (moved off
//! a per-device `.freqhole.db.json` file in migration 053 — see
//! `grimoire::external_storage`):
//! - never synced before -> copy (or ffmpeg re-encode), tag-fill only
//!   fields missing from the source file (respects a pre-tagged source).
//! - already synced, audio + metadata unchanged -> no-op.
//! - already synced, freqhole's metadata (artist/album/title/track/disc)
//!   changed since last sync -> move the existing file to its new path
//!   (merging into a shared album/artist dir is fine; only ever refuses
//!   to overwrite a *different* song at the destination) and force-write
//!   the now-stale tag fields, since this file is freqhole-owned. if the
//!   source audio itself changed (different sha256), re-copy fresh bytes
//!   at the new path instead of just moving.
//!
//! see docs/removable-storage-sync-plan.md phase 2 and phase 6.

use std::collections::hash_map::DefaultHasher;
use std::collections::HashSet;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

use lofty::{Accessor, Probe, Tag, TagExt, TaggedFileExt};
use serde::Serialize;

use grimoire::media_blobz::{get_media_blob_stream_source, BlobStreamSource, MediaBlob};
use grimoire::music::crud::create_or_update::{get_current_album_for_song, get_current_artist_for_song};
use grimoire::music::entities::songs::get_song;

use crate::app_config::FreqholeAppConfig;

use super::{is_still_mounted, path_naming};

#[derive(Debug, Clone, Serialize)]
pub struct SyncSongResult {
    pub relative_path: String,
    /// true when the song was already fully up to date and nothing was written.
    pub skipped: bool,
    /// true when an existing file was moved to a new path (metadata changed).
    pub moved: bool,
}

pub async fn sync_song_to_device(
    app_handle: &tauri::AppHandle,
    device_id: &str,
    song_id: &str,
) -> Result<SyncSongResult, String> {
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

    let subpath = device
        .subpath
        .clone()
        .unwrap_or_else(|| config.external_storage_default_subpath.clone());
    let music_root = Path::new(&device.path).join(&subpath);

    let song_response = get_song(song_id).await;
    let song = song_response.data.ok_or(song_response.message)?;

    let artist = get_current_artist_for_song(song_id)
        .await
        .map_err(|e| e.to_string())?;
    let album = get_current_album_for_song(song_id)
        .await
        .map_err(|e| e.to_string())?;

    let artist_name = song
        .track_artist
        .clone()
        .filter(|s| !s.is_empty())
        .or_else(|| artist.map(|a| a.name))
        .unwrap_or_else(|| "unknown artist".to_string());
    let album_title = album
        .map(|a| a.title)
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "unknown album".to_string());

    let (blob, source) = get_media_blob_stream_source(&song.media_blob_id)
        .await
        .map_err(|e| e.to_string())?;

    let ext = resolve_extension(&blob);
    let base_relative = path_naming::compute_relative_path(
        &artist_name,
        &album_title,
        song.disc_number,
        song.track_number,
        &song.title,
        &ext,
    );
    let tag_hash = compute_tag_hash(
        &song.title,
        &artist_name,
        &album_title,
        song.track_number,
        song.disc_number,
    );

    let existing = grimoire::external_storage::get_synced_song(device_id, song_id)
        .await
        .map_err(|e| e.to_string())?;
    let mut claimed_paths: HashSet<String> =
        grimoire::external_storage::list_claimed_paths(device_id)
            .await
            .map_err(|e| e.to_string())?
            .into_iter()
            .collect();

    // figure out the destination path, and whether an old file needs
    // moving out from under it, before touching the filesystem.
    let mut old_absolute_to_move: Option<PathBuf> = None;
    let relative_path = match &existing {
        Some(existing) => {
            let existing_rel = PathBuf::from(&existing.relative_path);
            let existing_abs = music_root.join(&existing_rel);
            let metadata_unchanged = existing_rel == base_relative;

            if existing.sha256 == blob.sha256
                && metadata_unchanged
                && existing.tag_hash == tag_hash
                && existing_abs.exists()
            {
                return Ok(SyncSongResult {
                    relative_path: existing.relative_path.clone(),
                    skipped: true,
                    moved: false,
                });
            }

            if metadata_unchanged {
                existing_rel
            } else {
                // free the old claim before uniquifying the new path, so a
                // rename doesn't spuriously collide with its own old slot.
                claimed_paths.remove(&existing.relative_path);
                grimoire::external_storage::unclaim_path(device_id, &existing.relative_path)
                    .await
                    .map_err(|e| e.to_string())?;
                if existing_abs.exists() {
                    old_absolute_to_move = Some(existing_abs);
                }
                path_naming::uniquify_path(&base_relative, &claimed_paths)
            }
        }
        None => path_naming::uniquify_path(&base_relative, &claimed_paths),
    };

    let dest_path = music_root.join(&relative_path);
    if let Some(parent) = dest_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create destination directory: {e}"))?;
    }

    let content_unchanged = existing.as_ref().is_some_and(|e| e.sha256 == blob.sha256);
    let mut moved = false;

    if content_unchanged {
        if let Some(old_abs) = &old_absolute_to_move {
            if old_abs != &dest_path {
                move_file(old_abs, &dest_path)?;
                moved = true;
                if let Some(parent) = old_abs.parent() {
                    prune_empty_ancestors(parent.to_path_buf(), &music_root);
                }
            }
        }
        // audio bytes are already correct at dest_path; only the tags
        // (title/artist/album/track/disc) may need refreshing, since this
        // file is freqhole-owned once it has a state entry.
        force_set_tags(&dest_path, &song.title, &artist_name, &album_title, song.track_number, song.disc_number)?;
    } else {
        let grimoire_config = grimoire::config::get_config();
        write_audio(
            &source,
            &dest_path,
            config.external_storage_reencode_enabled,
            &grimoire_config.media.ffmpeg_path,
            &config.external_storage_reencode_args,
        )?;

        if existing.is_some() {
            // re-tagging a previously-tracked (freqhole-owned) file: force
            // the fields we know, since it already carries our own tags.
            force_set_tags(&dest_path, &song.title, &artist_name, &album_title, song.track_number, song.disc_number)?;
        } else {
            // first-ever sync: only fill gaps, respecting a pre-tagged source.
            fill_missing_tags(&dest_path, &song.title, &artist_name, &album_title, song.track_number, song.disc_number)?;
        }

        if let Some(old_abs) = &old_absolute_to_move {
            if old_abs != &dest_path {
                let _ = std::fs::remove_file(old_abs);
                moved = true;
                if let Some(parent) = old_abs.parent() {
                    prune_empty_ancestors(parent.to_path_buf(), &music_root);
                }
            }
        }
    }

    let relative_path_str = relative_path.to_string_lossy().replace('\\', "/");
    grimoire::external_storage::claim_path(device_id, &relative_path_str)
        .await
        .map_err(|e| e.to_string())?;
    grimoire::external_storage::upsert_synced_song(
        device_id,
        song_id,
        &relative_path_str,
        &blob.sha256,
        blob.blake3.as_deref(),
        &tag_hash,
    )
    .await
    .map_err(|e| e.to_string())?;
    grimoire::external_storage::set_device_last_synced_at(
        device_id,
        chrono::Utc::now().timestamp_millis(),
    )
    .await
    .map_err(|e| e.to_string())?;

    Ok(SyncSongResult {
        relative_path: relative_path_str,
        skipped: false,
        moved,
    })
}

/// prefer the source blob's real filename extension; fall back to a mime
/// guess, then to mp3 as a last resort.
fn resolve_extension(blob: &MediaBlob) -> String {
    if let Some(filename) = &blob.filename {
        if let Some(ext) = Path::new(filename).extension().and_then(|e| e.to_str()) {
            if !ext.is_empty() {
                return ext.to_lowercase();
            }
        }
    }
    match blob.mime.as_deref() {
        Some("audio/mpeg") => "mp3",
        Some("audio/flac") | Some("audio/x-flac") => "flac",
        Some("audio/mp4") | Some("audio/x-m4a") => "m4a",
        Some("audio/ogg") | Some("audio/vorbis") => "ogg",
        Some("audio/wav") | Some("audio/x-wav") | Some("audio/vnd.wave") => "wav",
        Some("audio/aac") => "aac",
        _ => "mp3",
    }
    .to_string()
}

fn compute_tag_hash(title: &str, artist: &str, album: &str, track: i64, disc: i64) -> String {
    let mut hasher = DefaultHasher::new();
    title.hash(&mut hasher);
    artist.hash(&mut hasher);
    album.hash(&mut hasher);
    track.hash(&mut hasher);
    disc.hash(&mut hasher);
    format!("{:x}", hasher.finish())
}

/// rename when possible (same volume - cheap, atomic); fall back to
/// copy+delete only if the rename fails (e.g. a genuine cross-filesystem
/// move, which shouldn't normally happen within one device's music root).
fn move_file(from: &Path, to: &Path) -> Result<(), String> {
    if std::fs::rename(from, to).is_ok() {
        return Ok(());
    }
    std::fs::copy(from, to).map_err(|e| format!("failed to move file: {e}"))?;
    std::fs::remove_file(from).map_err(|e| format!("failed to remove old file after move: {e}"))?;
    Ok(())
}

/// best-effort cleanup: remove now-empty directories a moved file left
/// behind, stopping at (and never removing) the device's music root.
fn prune_empty_ancestors(mut dir: PathBuf, stop_at: &Path) {
    while dir != *stop_at && dir.starts_with(stop_at) {
        match std::fs::read_dir(&dir) {
            Ok(mut entries) => {
                if entries.next().is_some() {
                    break;
                }
            }
            Err(_) => break,
        }
        if std::fs::remove_dir(&dir).is_err() {
            break;
        }
        match dir.parent() {
            Some(parent) => dir = parent.to_path_buf(),
            None => break,
        }
    }
}

fn write_audio(
    source: &BlobStreamSource,
    dest: &Path,
    reencode: bool,
    ffmpeg_path: &str,
    reencode_args: &str,
) -> Result<(), String> {
    if !reencode {
        return match source {
            BlobStreamSource::File { path, .. } => {
                std::fs::copy(path, dest).map_err(|e| format!("failed to copy audio: {e}"))?;
                Ok(())
            }
            BlobStreamSource::Memory(bytes) => {
                std::fs::write(dest, bytes).map_err(|e| format!("failed to write audio: {e}"))
            }
        };
    }

    // ffmpeg needs a real input file path - stage in-memory bytes to a
    // temp file first, cleaning it up afterward either way.
    let (input_path, temp_input) = match source {
        BlobStreamSource::File { path, .. } => (path.clone(), None),
        BlobStreamSource::Memory(bytes) => {
            let temp = std::env::temp_dir().join(temp_file_name("tmp"));
            std::fs::write(&temp, bytes)
                .map_err(|e| format!("failed to stage audio for re-encode: {e}"))?;
            (temp.clone(), Some(temp))
        }
    };

    let result = run_ffmpeg(ffmpeg_path, reencode_args, &input_path, dest);
    if let Some(temp) = temp_input {
        let _ = std::fs::remove_file(temp);
    }
    result
}

fn temp_file_name(ext: &str) -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("freqhole-sync-{}-{nanos}.{ext}", std::process::id())
}

/// splits `args_template` shell-word-style (matches the convention used by
/// grimoire's `extract_album_art_args`), substitutes `{input}`/`{output}`,
/// then runs it.
fn run_ffmpeg(ffmpeg_path: &str, args_template: &str, input: &Path, output: &Path) -> Result<(), String> {
    let mut args = shell_words::split(args_template)
        .map_err(|e| format!("failed to parse ffmpeg args: {e}"))?;
    for arg in args.iter_mut() {
        if arg.contains("{input}") {
            *arg = arg.replace("{input}", &input.to_string_lossy());
        }
        if arg.contains("{output}") {
            *arg = arg.replace("{output}", &output.to_string_lossy());
        }
    }
    let result = std::process::Command::new(ffmpeg_path)
        .args(&args)
        .output()
        .map_err(|e| format!("failed to run ffmpeg: {e}"))?;
    if !result.status.success() {
        return Err(format!(
            "ffmpeg failed: {}",
            String::from_utf8_lossy(&result.stderr)
        ));
    }
    Ok(())
}

/// only fills fields the source file doesn't already have set - used for a
/// song's very first sync, so a nicely pre-tagged file is left alone.
fn fill_missing_tags(
    path: &Path,
    title: &str,
    artist: &str,
    album: &str,
    track: i64,
    disc: i64,
) -> Result<(), String> {
    let mut tagged_file = Probe::open(path)
        .and_then(|p| p.read())
        .map_err(|e| format!("failed to read tags: {e}"))?;
    let tag_type = tagged_file.primary_tag_type();
    if tagged_file.primary_tag().is_none() {
        tagged_file.insert_tag(Tag::new(tag_type));
    }
    let tag = tagged_file
        .primary_tag_mut()
        .expect("tag was just inserted if missing");

    if tag.title().is_none() {
        tag.set_title(title.to_string());
    }
    if tag.artist().is_none() {
        tag.set_artist(artist.to_string());
    }
    if tag.album().is_none() {
        tag.set_album(album.to_string());
    }
    if tag.track().is_none() && track > 0 {
        tag.set_track(track as u32);
    }
    if tag.disk().is_none() && disc > 0 {
        tag.set_disk(disc as u32);
    }
    tag.save_to_path(path).map_err(|e| format!("failed to write tags: {e}"))
}

/// unconditionally overwrites title/artist/album/track/disc - used when
/// re-syncing a file freqhole already owns (tracked in `.freqhole.db.json`),
/// so a rename in freqhole's metadata actually takes effect on disk.
fn force_set_tags(
    path: &Path,
    title: &str,
    artist: &str,
    album: &str,
    track: i64,
    disc: i64,
) -> Result<(), String> {
    let mut tagged_file = Probe::open(path)
        .and_then(|p| p.read())
        .map_err(|e| format!("failed to read tags: {e}"))?;
    let tag_type = tagged_file.primary_tag_type();
    if tagged_file.primary_tag().is_none() {
        tagged_file.insert_tag(Tag::new(tag_type));
    }
    let tag = tagged_file
        .primary_tag_mut()
        .expect("tag was just inserted if missing");

    tag.set_title(title.to_string());
    tag.set_artist(artist.to_string());
    tag.set_album(album.to_string());
    if track > 0 {
        tag.set_track(track as u32);
    }
    if disc > 0 {
        tag.set_disk(disc as u32);
    }
    tag.save_to_path(path).map_err(|e| format!("failed to write tags: {e}"))
}
