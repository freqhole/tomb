//! app-wide storage overview for spume's storage settings view.
//!
//! **why**: spume's `StorageSettingsView` previously only knew about
//! `navigator.storage.estimate()` - the webview's own sandboxed origin
//! storage quota. that excludes everything the tauri host itself writes
//! to disk directly outside the webview (grimoire's own sqlite
//! databases, p2p-synced media blobs, the fetch/local-library
//! directory, generated artwork/transcode renditions, etc), so the
//! number shown was always a significant undercount for any tauri build
//! - badly so on mobile, where most of a user's actual storage usage is
//! exactly the stuff this module measures.
//!
//! reuses rather than reimplements: `external_storage::disk_usage` (the
//! same statvfs/`fsutil` primitive the removable-storage-sync feature
//! already uses for its own per-device disk-space readout, now exposed
//! cross-platform - see that function's own doc comment) and
//! `external_storage::commands::DiskUsageResult` (identical
//! total/free/used shape, no reason for a second one). only the
//! `data_dir` breakdown walk below is new.

use std::path::{Path, PathBuf};

use serde::Serialize;
use walkdir::WalkDir;

use crate::external_storage::{commands::DiskUsageResult, disk_usage};

/// one top-level category's contribution to `AppStorageBreakdown`.
#[derive(Debug, Clone, Default, Serialize)]
pub struct StorageCategory {
    pub bytes: u64,
    pub file_count: u64,
}

impl StorageCategory {
    fn add_file(&mut self, len: u64) {
        self.bytes += len;
        self.file_count += 1;
    }

    fn add(&mut self, other: &StorageCategory) {
        self.bytes += other.bytes;
        self.file_count += other.file_count;
    }
}

/// breakdown of everything under grimoire's own `data_dir`, categorized
/// by top-level child name so the ui can show a meaningful breakdown
/// instead of one opaque total. `total` is always the sum of every
/// other category - computed from the same single top-level scan, so it
/// can never drift out of sync with the categories below it.
#[derive(Debug, Clone, Default, Serialize)]
pub struct AppStorageBreakdown {
    /// grimoire.db/reliquary.db/haruspex.db (+ their sqlite -wal/-shm
    /// sidecars), plus the legacy blob_data database if still present
    /// on disk (matched generically by ".db" anywhere in the filename,
    /// so this also folds in any future per-domain sqlite db without
    /// needing to list them by exact name here).
    pub databases: StorageCategory,
    /// the iroh-blobs verified-streaming store (`freqhole-blobz/`) -
    /// p2p-synced/received media content. usually the single biggest
    /// contributor on a p2p-heavy install.
    pub media_blobs: StorageCategory,
    /// the configured fetch/local-library directory, when it lives
    /// under `data_dir` (mobile's `sync_queue_to_local` downloads
    /// always do; a desktop `fetch_music.output_dir` left at its
    /// default location does too) - see `external_library` on the
    /// containing `AppStorageInfo` for when it's configured elsewhere.
    pub fetch_library: StorageCategory,
    /// generated artwork/transcode renditions (`renditions/`).
    pub renditions: StorageCategory,
    /// everything else directly under `data_dir` not already counted
    /// above (temp files, the wordlist, federation credentials, logs,
    /// future additions) - a catch-all so `total` stays accurate even
    /// as new subsystems add their own files later.
    pub other: StorageCategory,
    /// sum of every category above.
    pub total: StorageCategory,
}

/// full storage overview returned to spume: the `data_dir` breakdown,
/// the external library path's own size (only present when configured
/// AND not already a subdirectory of `data_dir` - see `fetch_library`
/// above), and disk total/free/used for the filesystem `data_dir` lives
/// on (`None` on a platform `disk_usage` can't resolve - should not
/// happen on any currently-supported target, but the ui should treat it
/// as "disk space unknown" rather than assuming zero).
#[derive(Debug, Clone, Serialize)]
pub struct AppStorageInfo {
    pub data_dir: String,
    pub breakdown: AppStorageBreakdown,
    pub external_library: Option<StorageCategory>,
    pub disk: Option<DiskUsageResult>,
}

/// recursively sum file sizes under `path`. metadata-only (never reads
/// file contents) - unreadable entries are silently skipped rather than
/// failing the whole scan, matching `walkdir`'s own fault-tolerant
/// iteration style already used elsewhere in grimoire (the music
/// scanner).
fn walk_dir_size(path: &Path) -> StorageCategory {
    let mut category = StorageCategory::default();
    if !path.is_dir() {
        return category;
    }
    for entry in WalkDir::new(path).into_iter().filter_map(|e| e.ok()) {
        if entry.file_type().is_file() {
            if let Ok(meta) = entry.metadata() {
                category.add_file(meta.len());
            }
        }
    }
    category
}

/// categorize `data_dir`'s direct children into the breakdown above.
/// only descends into a child directory's own subtree once, via
/// `walk_dir_size` - no redundant re-walking of the same files.
fn compute_breakdown(data_dir: &Path) -> AppStorageBreakdown {
    let mut breakdown = AppStorageBreakdown::default();
    let Ok(entries) = std::fs::read_dir(data_dir) else {
        return breakdown;
    };

    for entry in entries.flatten() {
        let Ok(meta) = entry.metadata() else { continue };
        let name = entry.file_name();
        let name = name.to_string_lossy();

        if meta.is_dir() {
            let size = walk_dir_size(&entry.path());
            match name.as_ref() {
                "freqhole-blobz" => breakdown.media_blobs.add(&size),
                "renditions" => breakdown.renditions.add(&size),
                "fetch" => breakdown.fetch_library.add(&size),
                _ => breakdown.other.add(&size),
            }
        } else if meta.is_file() {
            // sqlite db files and their -wal/-shm sidecars all contain
            // ".db" somewhere in the filename (grimoire.db, grimoire.db-
            // wal, grimoire.db-shm, reliquary.db, haruspex.db, the
            // legacy grimoire-blobdata.db, ...).
            if name.contains(".db") {
                breakdown.databases.add_file(meta.len());
            } else {
                breakdown.other.add_file(meta.len());
            }
        }
    }

    breakdown.total.add(&breakdown.databases);
    breakdown.total.add(&breakdown.media_blobs);
    breakdown.total.add(&breakdown.fetch_library);
    breakdown.total.add(&breakdown.renditions);
    breakdown.total.add(&breakdown.other);
    breakdown
}

/// get the full app storage overview: the categorized `data_dir`
/// breakdown, the external library's own size (if configured outside
/// `data_dir`), and disk total/free/used for `data_dir`'s filesystem.
#[tauri::command]
pub fn get_app_storage_info() -> AppStorageInfo {
    let config = grimoire::config::get_config();
    let data_dir = config.data_dir.clone();

    let breakdown = compute_breakdown(&data_dir);

    // the user's configured fetch/library directory is usually `fetch`
    // directly under `data_dir` (mobile always, desktop by default) -
    // already folded into `breakdown.fetch_library` above in that case.
    // only measure it separately here when it's been pointed somewhere
    // else entirely, so it's never silently missing from (or double-
    // counted into) the breakdown.
    let fetch_dir_setting: Option<PathBuf> = config
        .server
        .as_ref()
        .and_then(|s| s.fetch_music.as_ref())
        .and_then(|f| f.output_dir.as_ref())
        .map(PathBuf::from);
    let external_library = fetch_dir_setting
        .filter(|dir| !dir.starts_with(&data_dir))
        .map(|dir| walk_dir_size(&dir));

    let disk = disk_usage(&data_dir.display().to_string()).map(|(total_bytes, free_bytes)| {
        DiskUsageResult {
            total_bytes,
            free_bytes,
            used_bytes: total_bytes.saturating_sub(free_bytes),
        }
    });

    AppStorageInfo {
        data_dir: data_dir.display().to_string(),
        breakdown,
        external_library,
        disk,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn get_app_storage_info_does_not_panic_and_reports_sane_values() {
        grimoire::config::init_config_for_tests();
        let config = grimoire::config::get_config();
        std::fs::create_dir_all(&config.data_dir).expect("create test data_dir");
        std::fs::write(config.data_dir.join("grimoire.db"), b"fake db bytes")
            .expect("write fake db file");
        std::fs::create_dir_all(config.data_dir.join("freqhole-blobz")).expect("create blobz dir");
        std::fs::write(
            config.data_dir.join("freqhole-blobz").join("blob1"),
            b"fake blob bytes",
        )
        .expect("write fake blob file");

        let info = get_app_storage_info();

        assert_eq!(info.data_dir, config.data_dir.display().to_string());
        assert!(
            info.breakdown.databases.bytes >= "fake db bytes".len() as u64,
            "databases category should include grimoire.db's bytes: {:?}",
            info.breakdown.databases
        );
        assert!(
            info.breakdown.media_blobs.bytes >= "fake blob bytes".len() as u64,
            "media_blobs category should include freqhole-blobz/'s bytes: {:?}",
            info.breakdown.media_blobs
        );
        assert_eq!(
            info.breakdown.total.bytes,
            info.breakdown.databases.bytes
                + info.breakdown.media_blobs.bytes
                + info.breakdown.fetch_library.bytes
                + info.breakdown.renditions.bytes
                + info.breakdown.other.bytes,
            "total must always equal the sum of every category"
        );
        // disk_usage should resolve for a real, existing path on every
        // platform this crate builds for.
        assert!(info.disk.is_some(), "disk usage should resolve for a real path: {info:?}");
        let disk = info.disk.unwrap();
        assert!(disk.total_bytes > 0);
        assert!(disk.total_bytes >= disk.free_bytes);
    }
}
