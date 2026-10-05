//! library image repair: backfill missing song waveforms / album thumbnails,
//! and clean up directory-sourced images that got over-applied across
//! multiple unrelated albums during import (see docs/backlog3.md #19/#20).
//!
//! directory-image application at import time (`file_processor.rs`) has no
//! visibility into how many OTHER songs/albums share that same directory -
//! it just applies whatever folder.jpg/cover.jpg it finds to every song it
//! processes. for a well-organized library (one album per directory) that's
//! correct. for a directory of randomly-collected songs with no real album
//! structure, it means every one of those unrelated albums gets the same
//! stray image as its cover - the actual reported bug this file fixes.
//!
//! this runs as an after-the-fact repair pass (not a live import-pipeline
//! change - that would need a bigger two-phase refactor of file_processor.rs
//! to classify a whole directory's albums before processing any single file,
//! which is its own, separate project) over whatever's already imported:
//!
//! 1. backfill a waveform for any song that doesn't have one yet.
//! 2. for albums missing a thumbnail, and for existing directory-sourced
//!    thumbnails that look wrong, apply a directory-grouping heuristic:
//!    - group songs by their file's parent directory.
//!    - count songs per album within that directory; an album with only a
//!      single song there is treated as a stray outlier, not unless every
//!      album in the directory is a singleton (then they're all treated
//!      equally, which correctly falls through to the "too scattered"
//!      case below for a directory with many 1-song "albums").
//!    - ONE dominant album in the directory: safe case, backfill its
//!      thumbnail normally (embedded art first, directory image otherwise).
//!    - a HANDFUL (2-4) of dominant albums: only apply a directory image to
//!      an album whose title has a confident fuzzy match against the
//!      image's filename - an album with no match is left without a
//!      directory-sourced thumbnail rather than guessed at.
//!    - MORE than a handful of dominant albums: this is the "random
//!      collection of songs, no real directory structure" case - no new
//!      directory-sourced thumbnail is applied to anything here, and any
//!      album that already has one (from a past import) gets it removed.
//!
//! deliberately conservative: an album that already has ANY primary
//! thumbnail (whatever its source) is left alone in the backfill cases -
//! this only fills in genuinely missing images or removes a specifically
//! identified over-application, never overrides an existing choice.
//!
//! both parts run in small batches (not one pass over the whole library)
//! so the job driving this (`jobs::music::repair_library_images_processor`)
//! can chain batch-sized jobs instead of one long-running one - a batch job
//! finishes quickly and is individually cancelable (the chain just stops -
//! no further batch gets enqueued), and restarting is just re-running the
//! whole thing from the top, which is cheap and safe since every check
//! here is itself idempotent (already-fixed songs/albums are skipped).

use crate::database;
use crate::error::ErrorDetail;
use crate::response::GrimoireResponse;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use zod_gen_derive::ZodSchema;

/// an album with fewer than this many songs in a given directory is a
/// stray outlier there, not a "real" grouping, when counting how many
/// distinct albums a directory actually represents.
const DOMINANT_ALBUM_MIN_SONGS: i64 = 2;
/// once a directory has more dominant albums than this, a shared
/// directory image is treated as "randomly collected songs" rather than
/// attempted to apply anywhere.
const MAX_DOMINANT_ALBUMS_FOR_FUZZY_MATCH: usize = 4;
/// minimum token-overlap score (see `fuzzy_match_score`) between an image
/// filename and an album title to count as a confident match.
const FUZZY_MATCH_MIN_SCORE: f64 = 0.5;
const DIRECTORY_IMAGE_ART_TYPE_PREFIX: &str = "directory_image_";
/// songs processed per waveform-phase batch (used by both the job-chain
/// processor and the synchronous all-in-one entry point below).
pub const WAVEFORM_BATCH_SIZE: i64 = 200;
/// directories processed per directory-phase batch. smaller than the
/// waveform batch since each directory can involve ffmpeg art-extraction
/// work across several songs/albums.
pub const DIRECTORY_BATCH_SIZE: i64 = 50;

/// which half (or both) of the repair pass a job-chain batch is
/// currently on - internal bookkeeping for
/// `jobs::music::repair_library_images_processor`'s per-batch state, not
/// a user-facing "only run this phase" selector (see
/// `RepairLibraryImagesOptions` for the user-facing granularity).
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq, ZodSchema)]
#[serde(rename_all = "snake_case")]
pub enum RepairLibraryImagesPhase {
    #[default]
    Waveforms,
    Directories,
}

fn default_true() -> bool {
    true
}

/// per-sub-action toggles for a repair run - lets a caller (CLI flags,
/// rathole slash-command flags, or the charnel wizard's checklist UI)
/// enable/disable each of the repair's independent sub-jobs. the three
/// backfill actions are purely additive (never remove anything) and
/// default on; `remove_overapplied` deletes existing album-image
/// associations and defaults OFF since it's the one destructive action.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, ZodSchema)]
pub struct RepairLibraryImagesOptions {
    /// regenerate a waveform for any song that doesn't have one yet.
    #[serde(default = "default_true")]
    pub backfill_waveforms: bool,
    /// apply a song file's own embedded art (id3/vorbis cover) as an
    /// album's thumbnail when missing - always unambiguous, never
    /// shared across albums.
    #[serde(default = "default_true")]
    pub backfill_embedded_art: bool,
    /// apply a directory-level image (folder.jpg/cover.jpg/etc) as an
    /// album's thumbnail when missing, per the dominant-album/fuzzy-match
    /// heuristic described above.
    #[serde(default = "default_true")]
    pub backfill_directory_art: bool,
    /// destructive: remove a directory-sourced thumbnail that's been
    /// identified as over-applied (shared across too many unrelated
    /// albums in the same directory).
    #[serde(default)]
    pub remove_overapplied: bool,
}

impl Default for RepairLibraryImagesOptions {
    fn default() -> Self {
        Self {
            backfill_waveforms: true,
            backfill_embedded_art: true,
            backfill_directory_art: true,
            remove_overapplied: false,
        }
    }
}

impl RepairLibraryImagesOptions {
    /// true if any directory-phase sub-action is enabled - lets a caller
    /// skip the whole directory-phase batch loop when none are.
    pub fn any_directory_action(&self) -> bool {
        self.backfill_embedded_art || self.backfill_directory_art || self.remove_overapplied
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, ZodSchema)]
pub struct RepairLibraryImagesResult {
    pub songs_waveforms_backfilled: u32,
    pub albums_thumbnails_backfilled: u32,
    pub albums_thumbnails_removed_overapplied: u32,
    /// albums left without a directory-sourced thumbnail because the
    /// directory had multiple candidate albums and no confident filename
    /// match was found - not an error, just visibility into what this
    /// pass deliberately declined to guess at.
    pub albums_left_ambiguous: u32,
    pub errors: Vec<ErrorDetail>,
}

impl RepairLibraryImagesResult {
    /// fold another batch's counts into this running total - used to
    /// carry totals forward across a chain of batch jobs.
    pub fn merge(&mut self, other: RepairLibraryImagesResult) {
        self.songs_waveforms_backfilled += other.songs_waveforms_backfilled;
        self.albums_thumbnails_backfilled += other.albums_thumbnails_backfilled;
        self.albums_thumbnails_removed_overapplied += other.albums_thumbnails_removed_overapplied;
        self.albums_left_ambiguous += other.albums_left_ambiguous;
        self.errors.extend(other.errors);
    }
}

/// outcome of one `repair_waveforms_batch` call.
pub struct WaveformBatchOutcome {
    pub result: RepairLibraryImagesResult,
    /// true if this batch was full (there may be more songs still
    /// missing a waveform) - the waveform candidate set shrinks as songs
    /// get fixed, so the next batch always re-queries from the top
    /// rather than tracking an offset into it.
    pub more_remaining: bool,
}

/// outcome of one `repair_directories_batch` call.
pub struct DirectoryBatchOutcome {
    pub result: RepairLibraryImagesResult,
    /// true if there are more directories past this batch's slice.
    pub more_remaining: bool,
    /// offset the next batch should resume from.
    pub next_offset: i64,
}

struct SongDirRow {
    media_blob_id: String,
    local_path: String,
    album_id: String,
    album_title: String,
}

#[derive(sqlx::FromRow)]
struct SongDirRowRaw {
    media_blob_id: String,
    local_path: String,
    album_id: String,
    album_title: String,
}

/// backfill a waveform for up to `limit` songs that don't have one yet.
/// `dry_run` counts what WOULD change without writing anything.
/// `scan_directory`, when set, restricts candidates to songs whose file
/// lives at or under that directory (exact scan-root match, or anywhere
/// in its subtree) - lets a caller scope a run to one tracked directory
/// instead of the whole library.
/// `created_by` is the admin user triggering this, used for feed-event
/// attribution on newly-added images (same as every other image-adding
/// path).
pub async fn repair_waveforms_batch(
    dry_run: bool,
    limit: i64,
    scan_directory: Option<&str>,
    created_by: Option<(String, String)>,
) -> GrimoireResponse<WaveformBatchOutcome> {
    let mut result = RepairLibraryImagesResult::default();
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("failed to connect to database", vec![e.into()])
        }
    };
    let config = crate::config::get_config();
    let created_by_pair = created_by
        .as_ref()
        .map(|(id, name)| (id.as_str(), name.as_str()));
    let created_by_string = created_by.as_ref().map(|(id, _)| id.clone());

    let like_prefix = scan_directory_pattern(scan_directory);

    // the candidate set shrinks as songs get fixed (NOT EXISTS a
    // waveform), so no offset is needed here - each batch just takes the
    // next `limit` songs still missing one.
    let waveform_candidates = sqlx::query!(
        r#"
        SELECT s.id as "song_id!", s.media_blob_id as "media_blob_id!", mb.local_path as "local_path!"
        FROM songz s
        JOIN media_blobz mb ON mb.id = s.media_blob_id
        WHERE s.deleted_at IS NULL
          AND mb.local_path IS NOT NULL
          AND (?1 IS NULL OR mb.local_path LIKE ?1 ESCAPE '\')
          AND NOT EXISTS (
            SELECT 1 FROM song_imagez si
            JOIN media_blobz wmb ON wmb.id = si.media_blob_id
            WHERE si.song_id = s.id AND wmb.blob_type = 'waveform' AND wmb.deleted_at IS NULL
          )
        LIMIT ?2
        "#,
        like_prefix,
        limit
    )
    .fetch_all(&pool)
    .await;

    let rows = match waveform_candidates {
        Ok(rows) => rows,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to query waveform candidates",
                vec![ErrorDetail::from(crate::error::GrimoireError::from(e))],
            )
        }
    };
    let more_remaining = rows.len() as i64 == limit;

    for row in rows {
        if dry_run {
            result.songs_waveforms_backfilled += 1;
            continue;
        }
        let waveform = crate::blob_data::create_audio_waveform_blob(
            &row.media_blob_id,
            &row.local_path,
            &config,
            created_by_string.clone(),
        )
        .await;
        let Some(blob_id) = waveform.data else {
            result.errors.push(ErrorDetail::new(
                "waveform_backfill_failed",
                "Waveform Backfill Failed",
                format!("song {}: {}", row.song_id, waveform.message),
            ));
            continue;
        };
        let link = crate::music::entities::songs::add_song_image(
            &row.song_id,
            &blob_id,
            false,
            created_by_pair,
        )
        .await;
        if link.success {
            result.songs_waveforms_backfilled += 1;
        } else {
            result.errors.push(ErrorDetail::new(
                "waveform_link_failed",
                "Waveform Link Failed",
                format!("song {}: {}", row.song_id, link.message),
            ));
        }
    }

    GrimoireResponse::success(
        "waveform batch complete",
        WaveformBatchOutcome {
            result,
            more_remaining,
        },
    )
}

/// process directory-grouped album thumbnail backfill + over-application
/// cleanup for the `[offset, offset + limit)` slice of the library's
/// distinct song directories (sorted by path, so pages are stable across
/// calls as long as no directories are added/removed mid-run).
///
/// unlike the waveform batch, this candidate set (directories) doesn't
/// shrink as work completes - fixing an album's thumbnail doesn't remove
/// its directory from the list - so plain offset pagination is correct
/// here, unlike the waveform batch above.
///
/// `scan_directory`, when set, restricts the distinct-directory list to
/// paths at or under that directory before paginating (see
/// `repair_waveforms_batch`'s doc comment for the same scoping idea).
/// `options` gates which of the three directory-phase sub-actions
/// (embedded-art backfill, directory-image backfill, over-applied-image
/// removal) actually run - `backfill_waveforms` is ignored here.
pub async fn repair_directories_batch(
    dry_run: bool,
    offset: i64,
    limit: i64,
    scan_directory: Option<&str>,
    options: RepairLibraryImagesOptions,
    created_by: Option<(String, String)>,
) -> GrimoireResponse<DirectoryBatchOutcome> {
    let mut result = RepairLibraryImagesResult::default();
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("failed to connect to database", vec![e.into()])
        }
    };
    let config = crate::config::get_config();
    let created_by_pair = created_by
        .as_ref()
        .map(|(id, name)| (id.as_str(), name.as_str()));
    let created_by_string = created_by.as_ref().map(|(id, _)| id.clone());

    // cheap pass: just song id + local_path, no joins - sqlite has no
    // dirname(), so the stable sorted distinct-directory list this batch
    // slices into is computed in rust instead. still much lighter than
    // the old single-pass whole-library join this replaces.
    let path_rows = sqlx::query!(
        r#"
        SELECT s.id as "song_id!", mb.local_path as "local_path!"
        FROM songz s
        JOIN media_blobz mb ON mb.id = s.media_blob_id
        WHERE s.deleted_at IS NULL AND mb.local_path IS NOT NULL
        "#
    )
    .fetch_all(&pool)
    .await;

    let path_rows = match path_rows {
        Ok(rows) => rows,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to query song directories",
                vec![ErrorDetail::from(crate::error::GrimoireError::from(e))],
            )
        }
    };

    let mut by_dir: HashMap<String, Vec<String>> = HashMap::new();
    for row in &path_rows {
        if !path_in_scope(&row.local_path, scan_directory) {
            continue;
        }
        let dir = match std::path::Path::new(&row.local_path).parent() {
            Some(p) => p.to_string_lossy().to_string(),
            None => continue,
        };
        by_dir.entry(dir).or_default().push(row.song_id.clone());
    }
    let mut dirs: Vec<&String> = by_dir.keys().collect();
    dirs.sort();
    let total_dirs = dirs.len() as i64;
    let start = offset.clamp(0, total_dirs) as usize;
    let end = (offset + limit).clamp(0, total_dirs) as usize;
    let page_dirs = &dirs[start..end];
    let more_remaining = offset + limit < total_dirs;
    let next_offset = offset + limit;

    if page_dirs.is_empty() {
        return GrimoireResponse::success(
            "directory batch complete (no directories in range)",
            DirectoryBatchOutcome {
                result,
                more_remaining,
                next_offset,
            },
        );
    }

    let song_ids: Vec<&String> = page_dirs.iter().flat_map(|d| &by_dir[*d]).collect();

    // heavier pass: album join, restricted to just this batch's songs.
    let mut qb = sqlx::QueryBuilder::<sqlx::Sqlite>::new(
        r#"
        SELECT s.media_blob_id as media_blob_id, mb.local_path as local_path,
               a.id as album_id, a.title as album_title
        FROM songz s
        JOIN media_blobz mb ON mb.id = s.media_blob_id
        JOIN album_songz asz ON asz.song_id = s.id
        JOIN albumz a ON a.id = asz.album_id
        WHERE a.deleted_at IS NULL AND s.id IN (
        "#,
    );
    {
        let mut sep = qb.separated(", ");
        for id in &song_ids {
            sep.push_bind(id.as_str());
        }
    }
    qb.push(")");
    let song_rows = qb.build_query_as::<SongDirRowRaw>().fetch_all(&pool).await;

    let song_rows = match song_rows {
        Ok(rows) => rows
            .into_iter()
            .map(|r| SongDirRow {
                media_blob_id: r.media_blob_id,
                local_path: r.local_path,
                album_id: r.album_id,
                album_title: r.album_title,
            })
            .collect::<Vec<_>>(),
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to query directory batch's albums",
                vec![ErrorDetail::from(crate::error::GrimoireError::from(e))],
            )
        }
    };

    let mut by_dir_rows: HashMap<String, Vec<&SongDirRow>> = HashMap::new();
    for row in &song_rows {
        let dir = match std::path::Path::new(&row.local_path).parent() {
            Some(p) => p.to_string_lossy().to_string(),
            None => continue,
        };
        by_dir_rows.entry(dir).or_default().push(row);
    }

    for (_dir, rows) in by_dir_rows {
        let mut album_counts: HashMap<&str, (i64, &str, &SongDirRow)> = HashMap::new();
        for row in &rows {
            let entry = album_counts.entry(row.album_id.as_str()).or_insert((
                0,
                row.album_title.as_str(),
                row,
            ));
            entry.0 += 1;
        }

        let mut dominant: Vec<(&str, &str, &SongDirRow)> = album_counts
            .values()
            .filter(|(count, _, _)| *count >= DOMINANT_ALBUM_MIN_SONGS)
            .map(|(_, title, rep)| (rep.album_id.as_str(), *title, *rep))
            .collect();
        if dominant.is_empty() {
            // every album here is a 1-song singleton - none is more of an
            // outlier than any other, so they're all "dominant" (a
            // directory full of these naturally falls into the
            // too-scattered branch below once there are more than a
            // handful of them).
            dominant = album_counts
                .values()
                .map(|(_, title, rep)| (rep.album_id.as_str(), *title, *rep))
                .collect();
        }

        if dominant.len() == 1 {
            if options.backfill_embedded_art || options.backfill_directory_art {
                let (album_id, _title, rep) = dominant[0];
                backfill_album_thumbnail_if_missing(
                    &pool,
                    album_id,
                    rep,
                    &config,
                    dry_run,
                    options,
                    created_by_pair,
                    created_by_string.clone(),
                    &mut result,
                )
                .await;
            }
        } else if dominant.len() <= MAX_DOMINANT_ALBUMS_FOR_FUZZY_MATCH {
            if options.backfill_embedded_art || options.backfill_directory_art {
                for (album_id, title, rep) in &dominant {
                    if album_has_primary_thumbnail(&pool, album_id).await {
                        continue;
                    }
                    let images = crate::blob_data::collect_song_images(
                        &rep.media_blob_id,
                        &rep.local_path,
                        &config,
                        None,
                        created_by_string.clone(),
                    )
                    .await;
                    let Some(collected) = images.data else {
                        continue;
                    };
                    if options.backfill_embedded_art {
                        if let Some(embedded_id) = &collected.embedded_art_blob_id {
                            // embedded art is specific to this exact file/album -
                            // always safe, no ambiguity to resolve.
                            link_album_thumbnail(
                                album_id,
                                embedded_id,
                                created_by_pair,
                                dry_run,
                                &mut result,
                            )
                            .await;
                            continue;
                        }
                    }
                    if !options.backfill_directory_art {
                        continue;
                    }
                    let mut matched = false;
                    for blob_id in &collected.directory_image_blob_ids {
                        let Some(filename) = directory_image_filename(&pool, blob_id).await else {
                            continue;
                        };
                        let stem = std::path::Path::new(&filename)
                            .file_stem()
                            .map(|s| s.to_string_lossy().to_string())
                            .unwrap_or(filename);
                        if fuzzy_match_score(&stem, title) >= FUZZY_MATCH_MIN_SCORE {
                            link_album_thumbnail(
                                album_id,
                                blob_id,
                                created_by_pair,
                                dry_run,
                                &mut result,
                            )
                            .await;
                            matched = true;
                            break;
                        }
                    }
                    if !matched {
                        result.albums_left_ambiguous += 1;
                    }
                }
            }
        } else if options.remove_overapplied {
            // too many distinct albums sharing this directory - a stray
            // image here shouldn't be anyone's cover. remove it from any
            // album that already has one, rather than leave a wrong cover
            // in place.
            for (album_id, _title, _rep) in &dominant {
                remove_overapplied_thumbnail_if_any(&pool, album_id, dry_run, &mut result).await;
            }
        }
    }

    GrimoireResponse::success(
        "directory batch complete",
        DirectoryBatchOutcome {
            result,
            more_remaining,
            next_offset,
        },
    )
}

/// run the full repair pass synchronously (no job queue/batch chaining) -
/// used by the CLI and admin_dispatch (rathole/charnel), which run to
/// completion in one call rather than needing the job-chain's
/// cancel-between-batches behavior the offal/remote-dispatch path wants.
/// `options` selects which sub-jobs actually run (waveform backfill,
/// embedded-art backfill, directory-image backfill, over-applied-image
/// removal) - this is what backs the charnel wizard's repair checklist
/// and the CLI/rathole's per-sub-job flags/presets.
pub async fn repair_library_images_sync(
    dry_run: bool,
    scan_directory: Option<String>,
    options: RepairLibraryImagesOptions,
    created_by: Option<(String, String)>,
) -> GrimoireResponse<RepairLibraryImagesResult> {
    let mut totals = RepairLibraryImagesResult::default();

    if options.backfill_waveforms {
        loop {
            let resp = repair_waveforms_batch(
                dry_run,
                WAVEFORM_BATCH_SIZE,
                scan_directory.as_deref(),
                created_by.clone(),
            )
            .await;
            let Some(outcome) = resp.data else {
                return GrimoireResponse::failure(resp.message, resp.errors);
            };
            let more_remaining = outcome.more_remaining;
            totals.merge(outcome.result);
            if !more_remaining {
                break;
            }
        }
    }

    if options.any_directory_action() {
        let mut offset = 0i64;
        loop {
            let resp = repair_directories_batch(
                dry_run,
                offset,
                DIRECTORY_BATCH_SIZE,
                scan_directory.as_deref(),
                options,
                created_by.clone(),
            )
            .await;
            let Some(outcome) = resp.data else {
                return GrimoireResponse::failure(resp.message, resp.errors);
            };
            let more_remaining = outcome.more_remaining;
            offset = outcome.next_offset;
            totals.merge(outcome.result);
            if !more_remaining {
                break;
            }
        }
    }

    GrimoireResponse::success("library image repair complete", totals)
}

/// normalize a scan-directory scope into a sqlite LIKE pattern matching
/// any file at or under that directory - metacharacters in the path
/// itself (`%`/`_`) are escaped so a directory literally named e.g.
/// `100%_mixes` can't be misread as a wildcard.
fn scan_directory_pattern(scan_directory: Option<&str>) -> Option<String> {
    let dir = scan_directory?;
    let normalized = dir.trim_end_matches('/');
    let escaped = escape_sql_like(normalized);
    Some(format!("{escaped}/%"))
}

fn escape_sql_like(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

/// rust-side equivalent of `scan_directory_patterns`'s filter, for the
/// directory batch's already-in-memory path list.
fn path_in_scope(local_path: &str, scan_directory: Option<&str>) -> bool {
    let Some(dir) = scan_directory else {
        return true;
    };
    let normalized = dir.trim_end_matches('/');
    local_path.starts_with(&format!("{normalized}/"))
}

async fn album_has_primary_thumbnail(pool: &sqlx::SqlitePool, album_id: &str) -> bool {
    sqlx::query_scalar!(
        "SELECT COUNT(*) FROM album_imagez WHERE album_id = ? AND is_primary = 1",
        album_id
    )
    .fetch_one(pool)
    .await
    .map(|c| c > 0)
    .unwrap_or(false)
}

/// recover a directory-sourced image blob's original on-disk filename -
/// not stored in `media_blobz.filename` (always NULL for generated art
/// blobs), only in `metadata ->> '$.art_type'` as
/// `"directory_image_<filename>"` (see `blob_data::helpers::collect_song_images`).
async fn directory_image_filename(pool: &sqlx::SqlitePool, blob_id: &str) -> Option<String> {
    let art_type: Option<String> = sqlx::query_scalar!(
        r#"SELECT metadata ->> '$.art_type' as "art_type: String" FROM media_blobz WHERE id = ?"#,
        blob_id
    )
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()
    .flatten();
    art_type.and_then(|t| {
        t.strip_prefix(DIRECTORY_IMAGE_ART_TYPE_PREFIX)
            .map(String::from)
    })
}

#[allow(clippy::too_many_arguments)]
async fn backfill_album_thumbnail_if_missing(
    pool: &sqlx::SqlitePool,
    album_id: &str,
    rep: &SongDirRow,
    config: &crate::config::GrimoireConfig,
    dry_run: bool,
    options: RepairLibraryImagesOptions,
    created_by_pair: Option<(&str, &str)>,
    created_by_string: Option<String>,
    result: &mut RepairLibraryImagesResult,
) {
    if album_has_primary_thumbnail(pool, album_id).await {
        return;
    }
    let images = crate::blob_data::collect_song_images(
        &rep.media_blob_id,
        &rep.local_path,
        config,
        None,
        created_by_string,
    )
    .await;
    let Some(collected) = images.data else { return };
    let chosen = options
        .backfill_embedded_art
        .then(|| collected.embedded_art_blob_id.clone())
        .flatten()
        .or_else(|| {
            options
                .backfill_directory_art
                .then(|| collected.directory_image_blob_ids.first().cloned())
                .flatten()
        });
    if let Some(blob_id) = chosen {
        link_album_thumbnail(album_id, &blob_id, created_by_pair, dry_run, result).await;
    }
}

async fn link_album_thumbnail(
    album_id: &str,
    blob_id: &str,
    created_by_pair: Option<(&str, &str)>,
    dry_run: bool,
    result: &mut RepairLibraryImagesResult,
) {
    if dry_run {
        result.albums_thumbnails_backfilled += 1;
        return;
    }
    let link =
        crate::music::entities::albums::add_album_image(album_id, blob_id, true, created_by_pair)
            .await;
    if link.success {
        result.albums_thumbnails_backfilled += 1;
    } else {
        result.errors.push(ErrorDetail::new(
            "album_thumbnail_link_failed",
            "Album Thumbnail Link Failed",
            format!("album {}: {}", album_id, link.message),
        ));
    }
}

async fn remove_overapplied_thumbnail_if_any(
    pool: &sqlx::SqlitePool,
    album_id: &str,
    dry_run: bool,
    result: &mut RepairLibraryImagesResult,
) {
    let current: Option<(String, Option<String>)> = sqlx::query!(
        r#"
        SELECT ai.media_blob_id as "media_blob_id!", mb.metadata ->> '$.art_type' as "art_type: String"
        FROM album_imagez ai
        JOIN media_blobz mb ON mb.id = ai.media_blob_id
        WHERE ai.album_id = ? AND ai.is_primary = 1
        "#,
        album_id
    )
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()
    .map(|r| (r.media_blob_id, r.art_type));

    let Some((blob_id, art_type)) = current else {
        return;
    };
    let is_directory_sourced = art_type
        .map(|t| t.starts_with(DIRECTORY_IMAGE_ART_TYPE_PREFIX))
        .unwrap_or(false);
    if !is_directory_sourced {
        return;
    }
    if dry_run {
        result.albums_thumbnails_removed_overapplied += 1;
        return;
    }
    let removed = crate::music::entities::albums::remove_album_image(album_id, &blob_id).await;
    if removed.success {
        result.albums_thumbnails_removed_overapplied += 1;
    } else {
        result.errors.push(ErrorDetail::new(
            "album_thumbnail_removal_failed",
            "Album Thumbnail Removal Failed",
            format!("album {}: {}", album_id, removed.message),
        ));
    }
}

fn normalize_for_match(s: &str) -> Vec<String> {
    s.to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .filter(|w| w.len() > 1)
        .map(|w| w.to_string())
        .collect()
}

/// crude token-overlap fuzzy match (no new crate dependency needed for
/// this) - the fraction of the album title's significant words that also
/// appear in the image filename. a generic filename like "folder"/"cover"
/// naturally scores ~0 against any real album title, which is exactly the
/// desired behavior (don't guess based on a generic name).
fn fuzzy_match_score(filename_stem: &str, album_title: &str) -> f64 {
    let title_tokens = normalize_for_match(album_title);
    if title_tokens.is_empty() {
        return 0.0;
    }
    let name_tokens: std::collections::HashSet<String> =
        normalize_for_match(filename_stem).into_iter().collect();
    let matched = title_tokens
        .iter()
        .filter(|t| name_tokens.contains(*t))
        .count();
    matched as f64 / title_tokens.len() as f64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fuzzy_match_scores_real_overlap_highly() {
        assert!(fuzzy_match_score("Kid A", "Kid A") >= FUZZY_MATCH_MIN_SCORE);
        assert!(fuzzy_match_score("OK_Computer_Cover", "OK Computer") >= FUZZY_MATCH_MIN_SCORE);
    }

    #[test]
    fn fuzzy_match_rejects_generic_filenames() {
        assert!(fuzzy_match_score("folder", "Kid A") < FUZZY_MATCH_MIN_SCORE);
        assert!(fuzzy_match_score("cover", "OK Computer") < FUZZY_MATCH_MIN_SCORE);
        assert!(fuzzy_match_score("art", "Random Access Memories") < FUZZY_MATCH_MIN_SCORE);
    }

    #[test]
    fn fuzzy_match_rejects_unrelated_titles() {
        assert!(fuzzy_match_score("some_other_band_name", "Kid A") < FUZZY_MATCH_MIN_SCORE);
    }

    #[test]
    fn merge_sums_counts_and_concatenates_errors() {
        let mut total = RepairLibraryImagesResult {
            songs_waveforms_backfilled: 2,
            albums_thumbnails_backfilled: 1,
            ..Default::default()
        };
        let batch = RepairLibraryImagesResult {
            songs_waveforms_backfilled: 3,
            albums_thumbnails_removed_overapplied: 1,
            errors: vec![ErrorDetail::new("x", "X", "detail")],
            ..Default::default()
        };
        total.merge(batch);
        assert_eq!(total.songs_waveforms_backfilled, 5);
        assert_eq!(total.albums_thumbnails_backfilled, 1);
        assert_eq!(total.albums_thumbnails_removed_overapplied, 1);
        assert_eq!(total.errors.len(), 1);
    }

    #[test]
    fn path_in_scope_matches_subtree_but_not_siblings() {
        assert!(path_in_scope(
            "/music/Radiohead/Kid A/01.flac",
            Some("/music/Radiohead")
        ));
        assert!(!path_in_scope(
            "/music/Radiohead2/01.flac",
            Some("/music/Radiohead")
        ));
        assert!(path_in_scope("/music/anything/01.flac", None));
    }

    #[test]
    fn path_in_scope_handles_trailing_slash_in_scope() {
        assert!(path_in_scope(
            "/music/Radiohead/01.flac",
            Some("/music/Radiohead/")
        ));
    }

    #[test]
    fn scan_directory_pattern_escapes_like_metacharacters() {
        let pattern = scan_directory_pattern(Some("/music/100%_mixes")).unwrap();
        assert_eq!(pattern, "/music/100\\%\\_mixes/%");
    }
}
