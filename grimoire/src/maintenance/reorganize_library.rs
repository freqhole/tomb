//! moves fetched/randomly-named music + video files into a user-chosen
//! directory under a human-readable layout (Artist/Album for songs,
//! Series/Movie for videos) - shares the same path-naming/collision-
//! avoidance primitives as removable-storage sync
//! (`external_storage::path_naming`/`file_ops`), but MOVES rather than
//! copies (no 2x disk usage required) and additionally embeds id3/
//! vorbis/etc tags + cover art into whichever audio file formats
//! actually support writing them (anything lofty can't parse or save to
//! is silently skipped - not every format supports embedded metadata,
//! and that's fine).
//!
//! see migrations/093_library_reorganize_claimed_pathz.sql for the
//! collision-avoidance table this shares across every batch/worker of a
//! run - its PRIMARY KEY is what guarantees two different songs that
//! sanitize to the same path (e.g. both missing artist/album tags) can
//! never be moved to the same destination, even under concurrent batch
//! jobs. jobs of this type are intentionally NOT serialized against each
//! other (see `jobs::runner::conflict_key_for`'s fallthrough `_ => None`),
//! since each batch job processes its own fixed, disjoint list of
//! song/video ids computed up front by the enqueue step, so there's no
//! shared mutable pagination cursor to race on.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use zod_gen_derive::ZodSchema;

use crate::database;
use crate::error::{ErrorDetail, GrimoireError};
use crate::external_storage::{file_ops, path_naming};
use crate::media_blobz::BlobStreamSource;
use crate::response::GrimoireResponse;

/// songs/videos processed per batch job - kept modest since each item
/// involves a filesystem move and (for songs, when enabled) an i/o-bound
/// tag rewrite; see `jobs::music::reorganize_library_processor`.
pub const REORGANIZE_BATCH_SIZE: i64 = 150;

#[derive(Debug, Clone, Default, Serialize, Deserialize, ZodSchema)]
pub struct ReorganizeLibraryResult {
    pub songs_moved: u32,
    /// already under `target_directory` from an earlier run of this same
    /// job - not re-moved, not an error.
    pub songs_already_done: u32,
    pub videos_moved: u32,
    pub videos_already_done: u32,
    pub tags_embedded: u32,
    /// lofty couldn't parse the moved file, or the format doesn't
    /// support saving tags - the move itself still succeeded.
    pub tags_skipped_unsupported_format: u32,
    pub errors: Vec<ErrorDetail>,
}

impl ReorganizeLibraryResult {
    pub fn merge(&mut self, other: ReorganizeLibraryResult) {
        self.songs_moved += other.songs_moved;
        self.songs_already_done += other.songs_already_done;
        self.videos_moved += other.videos_moved;
        self.videos_already_done += other.videos_already_done;
        self.tags_embedded += other.tags_embedded;
        self.tags_skipped_unsupported_format += other.tags_skipped_unsupported_format;
        self.errors.extend(other.errors);
    }
}

/// resolve the default source scope for fetched music when the caller
/// doesn't give an explicit one - mirrors every fetch/upload write
/// path's own output-dir resolution (e.g. `offal::upload::music`).
pub fn default_music_source_dir() -> String {
    let config = crate::config::get_config();
    config
        .server
        .as_ref()
        .and_then(|s| s.fetch_music.as_ref())
        .and_then(|f| f.output_dir.clone())
        .unwrap_or_else(|| config.data_dir.join("fetch").display().to_string())
}

/// same as `default_music_source_dir`, for fetched video.
pub fn default_video_source_dir() -> String {
    let config = crate::config::get_config();
    config
        .server
        .as_ref()
        .and_then(|s| s.fetch_video.as_ref())
        .and_then(|f| f.output_dir.clone())
        .unwrap_or_else(|| config.data_dir.join("fetch").display().to_string())
}

fn like_pattern(dir: &str) -> String {
    let normalized = dir.trim_end_matches('/');
    let escaped = normalized
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_");
    format!("{escaped}/%")
}

/// true if `a` and `b` are the same directory, or one is nested inside
/// the other. `list_candidate_song_ids`/`list_candidate_video_ids`
/// define a "candidate" as "under source, NOT under target" - if source
/// and target overlap at all, every file under source is also under
/// target (or vice versa), so the query returns zero candidates
/// forever. not destructive (nothing gets moved), just a silent,
/// confusing no-op - see `validate_target_directory`, which rejects this
/// up front with an explanation instead of reporting "nothing to do".
fn directories_overlap(a: &str, b: &str) -> bool {
    let a = a.trim_end_matches('/');
    let b = b.trim_end_matches('/');
    if a.is_empty() || b.is_empty() {
        return false;
    }
    a == b || a.starts_with(&format!("{b}/")) || b.starts_with(&format!("{a}/"))
}

/// reject a `target_directory` that's the same as, or nested with,
/// either resolved source directory (whichever domain(s) are in scope) -
/// see `directories_overlap`'s doc comment for why this would otherwise
/// silently move nothing at all. called by `reorganize_library_plan`/
/// `_enqueue` and `reorganize_library_sync` before any candidate query.
pub fn validate_target_directory(
    target_directory: &str,
    source_music: &str,
    source_video: &str,
    include_music: bool,
    include_video: bool,
) -> Result<(), ErrorDetail> {
    if include_music && directories_overlap(target_directory, source_music) {
        return Err(ErrorDetail::new(
            "target_overlaps_source",
            "target directory overlaps the fetch source directory",
            format!(
                "\"{target_directory}\" is the same as, or nested with, the music fetch source directory \"{source_music}\" - reorganize only moves files INTO the target from OUTSIDE it, so an overlapping target would never find anything to move. pick a separate target directory."
            ),
        ));
    }
    if include_video && directories_overlap(target_directory, source_video) {
        return Err(ErrorDetail::new(
            "target_overlaps_source",
            "target directory overlaps the fetch source directory",
            format!(
                "\"{target_directory}\" is the same as, or nested with, the video fetch source directory \"{source_video}\" - reorganize only moves files INTO the target from OUTSIDE it, so an overlapping target would never find anything to move. pick a separate target directory."
            ),
        ));
    }
    Ok(())
}

/// every (non-deleted) song whose file lives under `source_dir` and
/// isn't already under `target_dir` - the candidate set for a fresh
/// enqueue. cheap id-only query; the enqueue step chunks these into
/// fixed-size, disjoint batch-job parameter lists.
pub async fn list_candidate_song_ids(
    source_dir: &str,
    target_dir: &str,
) -> Result<Vec<String>, GrimoireError> {
    let pool = database::connect().await?;
    let source_like = like_pattern(source_dir);
    let target_like = like_pattern(target_dir);
    let rows = sqlx::query!(
        r#"
        SELECT s.id as "id!"
        FROM songz s
        JOIN media_blobz mb ON mb.id = s.media_blob_id
        WHERE s.deleted_at IS NULL
          AND mb.local_path IS NOT NULL
          AND mb.local_path LIKE ?1 ESCAPE '\'
          AND mb.local_path NOT LIKE ?2 ESCAPE '\'
        "#,
        source_like,
        target_like,
    )
    .fetch_all(&pool)
    .await?;
    Ok(rows.into_iter().map(|r| r.id).collect())
}

/// video counterpart of `list_candidate_song_ids`.
pub async fn list_candidate_video_ids(
    source_dir: &str,
    target_dir: &str,
) -> Result<Vec<String>, GrimoireError> {
    let pool = database::connect().await?;
    let source_like = like_pattern(source_dir);
    let target_like = like_pattern(target_dir);
    let rows = sqlx::query!(
        r#"
        SELECT v.id as "id!"
        FROM videoz v
        JOIN media_blobz mb ON mb.id = v.media_blob_id
        WHERE v.deleted_at IS NULL
          AND mb.local_path IS NOT NULL
          AND mb.local_path LIKE ?1 ESCAPE '\'
          AND mb.local_path NOT LIKE ?2 ESCAPE '\'
        "#,
        source_like,
        target_like,
    )
    .fetch_all(&pool)
    .await?;
    Ok(rows.into_iter().map(|r| r.id).collect())
}

/// delete every claimed-path row recorded for `target_root` - call once
/// a run is fully done (both candidate lists above come back empty) so
/// this bookkeeping doesn't pile up forever the way
/// `external_storage_claimed_pathz` deliberately does for an ongoing
/// removable-device sync (this table has no such ongoing-sync concept -
/// it's a one-time, resumable bulk move). safe to call even if the run
/// isn't actually finished - any song/video still outstanding just
/// claims a fresh (possibly differently-suffixed) path next batch,
/// never a lost or overwritten file either way.
pub async fn cleanup_claimed_paths(target_root: &str) -> Result<u64, GrimoireError> {
    let pool = database::connect().await?;
    let result = sqlx::query!(
        "DELETE FROM library_reorganize_claimed_pathz WHERE target_root = ?",
        target_root
    )
    .execute(&pool)
    .await?;
    Ok(result.rows_affected())
}

/// register `target_root` as a tracked scan directory (so it shows up in
/// the regular directory list, and a future `rescan_directories` picks up
/// the reorganized layout going forward) - called after each batch
/// completes. `record_scanned_directory` upserts on path, so repeated
/// calls from multiple parallel batch jobs targeting the same directory
/// are harmless, just slightly redundant.
pub async fn register_target_directory(target_root: &str, created_by: Option<String>) {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(_) => return,
    };
    let like = like_pattern(target_root);
    let count = sqlx::query_scalar!(
        r#"SELECT COUNT(*) as "count!: i64" FROM media_blobz WHERE local_path LIKE ?1 ESCAPE '\'"#,
        like
    )
    .fetch_one(&pool)
    .await
    .unwrap_or(0);
    let _ = crate::jobs::record_scanned_directory(target_root, count, created_by).await;
}

/// checks whether `target_root` is now fully done for BOTH domains (zero
/// remaining candidates under either source dir) and, if so, cleans up
/// its claimed-path bookkeeping. only the caller that enqueues/plans a
/// run knows both source dirs at once (a single song or video batch only
/// knows its own domain's) - call this after a run's last batch
/// completes, or any time re-checking for leftover work (e.g. the
/// wizard's "is this run done yet" refresh).
pub async fn cleanup_if_fully_done(source_music: &str, source_video: &str, target_root: &str) {
    let songs_left = list_candidate_song_ids(source_music, target_root)
        .await
        .map(|v| v.len())
        .unwrap_or(1);
    let videos_left = list_candidate_video_ids(source_video, target_root)
        .await
        .map(|v| v.len())
        .unwrap_or(1);
    if songs_left == 0 && videos_left == 0 {
        if let Err(e) = cleanup_claimed_paths(target_root).await {
            tracing::warn!(
                "failed to clean up library_reorganize_claimed_pathz for {}: {}",
                target_root,
                e
            );
        }
    }
}

async fn find_existing_claim(
    pool: &sqlx::SqlitePool,
    target_root: &str,
    song_id: Option<&str>,
    video_id: Option<&str>,
) -> Option<PathBuf> {
    let row: Option<String> = if let Some(sid) = song_id {
        sqlx::query_scalar!(
            "SELECT relative_path FROM library_reorganize_claimed_pathz WHERE target_root = ? AND song_id = ?",
            target_root,
            sid
        )
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
    } else {
        let vid = video_id?;
        sqlx::query_scalar!(
            "SELECT relative_path FROM library_reorganize_claimed_pathz WHERE target_root = ? AND video_id = ?",
            target_root,
            vid
        )
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
    };
    row.map(PathBuf::from)
}

/// atomically claim a not-yet-taken relative path under `target_root` for
/// this song/video, bumping the numeric suffix (via `path_naming::uniquify_path`)
/// until the `INSERT ... ON CONFLICT DO NOTHING` actually inserts a row -
/// the sqlite PRIMARY KEY on `(target_root, relative_path)` is the real
/// lock here, safe even if another batch job is claiming paths under the
/// same target_root at the same time.
async fn claim_path(
    pool: &sqlx::SqlitePool,
    target_root: &str,
    base_relative: &Path,
    song_id: Option<&str>,
    video_id: Option<&str>,
) -> Result<PathBuf, sqlx::Error> {
    let mut attempted: HashSet<String> = HashSet::new();
    loop {
        let candidate = path_naming::uniquify_path(base_relative, &attempted);
        let candidate_str = candidate.to_string_lossy().replace('\\', "/");
        let result = sqlx::query!(
            "INSERT INTO library_reorganize_claimed_pathz (target_root, relative_path, song_id, video_id)
             VALUES (?, ?, ?, ?)
             ON CONFLICT (target_root, relative_path) DO NOTHING",
            target_root,
            candidate_str,
            song_id,
            video_id
        )
        .execute(pool)
        .await?;
        if result.rows_affected() == 1 {
            return Ok(candidate);
        }
        attempted.insert(candidate_str);
    }
}

// every argument here is meaningfully distinct (not a group that'd
// naturally bundle into one struct without just moving the problem).
#[allow(clippy::too_many_arguments)]
async fn reorganize_one_song(
    pool: &sqlx::SqlitePool,
    song_id: &str,
    target_root: &str,
    source_root: &str,
    dry_run: bool,
    embed_tags: bool,
    created_by: Option<(String, String)>,
    result: &mut ReorganizeLibraryResult,
) {
    let Some(song) = crate::music::entities::songs::get_song(song_id).await.data else {
        result.errors.push(ErrorDetail::new(
            "song_not_found",
            "Song Not Found",
            format!("song {song_id}"),
        ));
        return;
    };
    let blob = match crate::media_blobz::get_media_blob(&song.media_blob_id).await {
        Ok(b) => b,
        Err(e) => {
            result.errors.push(ErrorDetail::new(
                "media_blob_not_found",
                "Media Blob Not Found",
                format!("song {song_id}: {e}"),
            ));
            return;
        }
    };
    let Some(local_path) = blob.local_path.clone() else {
        result.errors.push(ErrorDetail::new(
            "no_local_path",
            "No Local File",
            format!("song {song_id} has no local file to move (remote-only blob)"),
        ));
        return;
    };
    if local_path.starts_with(target_root) {
        result.songs_already_done += 1;
        return;
    }

    let artist = crate::music::crud::create_or_update::get_current_artist_for_song(song_id)
        .await
        .ok()
        .flatten();
    let album = crate::music::crud::create_or_update::get_current_album_for_song(song_id)
        .await
        .ok()
        .flatten();
    let artist_name = song
        .track_artist
        .clone()
        .filter(|s| !s.is_empty())
        .or_else(|| artist.map(|a| a.name))
        .unwrap_or_else(|| "Unknown Artist".to_string());
    let album_title = album
        .as_ref()
        .map(|a| a.title.clone())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "Unknown Album".to_string());
    let album_id = album.map(|a| a.id);

    let ext = file_ops::resolve_extension(&blob);
    let base_relative = path_naming::compute_relative_path(
        &artist_name,
        &album_title,
        song.disc_number,
        song.track_number,
        &song.title,
        &ext,
    );

    let relative_path = match find_existing_claim(pool, target_root, Some(song_id), None).await {
        Some(existing) => existing,
        None if dry_run => base_relative,
        None => match claim_path(pool, target_root, &base_relative, Some(song_id), None).await {
            Ok(p) => p,
            Err(e) => {
                result.errors.push(ErrorDetail::new(
                    "claim_failed",
                    "Path Claim Failed",
                    format!("song {song_id}: {e}"),
                ));
                return;
            }
        },
    };

    if dry_run {
        result.songs_moved += 1;
        return;
    }

    let dest_abs = Path::new(target_root).join(&relative_path);
    if let Some(parent) = dest_abs.parent() {
        if let Err(e) = tokio::fs::create_dir_all(parent).await {
            result.errors.push(ErrorDetail::new(
                "mkdir_failed",
                "Directory Creation Failed",
                format!("song {song_id}: {e}"),
            ));
            return;
        }
    }
    // belt-and-suspenders: the claim above should make this path ours
    // alone, but never call move_file (a bare rename/copy, which
    // silently overwrites on every platform) onto something that's
    // somehow already sitting there - a stale leftover from an
    // interrupted previous run, or any other reason the claim and the
    // filesystem disagree.
    if dest_abs.exists() {
        result.errors.push(ErrorDetail::new(
            "destination_exists",
            "Destination Already Exists",
            format!(
                "song {song_id}: refusing to move onto existing file at {}",
                dest_abs.display()
            ),
        ));
        return;
    }
    let src_abs = PathBuf::from(&local_path);
    if let Err(e) = file_ops::move_file(&src_abs, &dest_abs) {
        result.errors.push(ErrorDetail::new(
            "move_failed",
            "Move Failed",
            format!("song {song_id}: {e}"),
        ));
        return;
    }
    if let Some(old_parent) = src_abs.parent() {
        file_ops::prune_empty_ancestors(old_parent.to_path_buf(), Path::new(source_root));
    }

    let new_path_str = dest_abs.to_string_lossy().to_string();
    let new_size = blob.size.unwrap_or(0);
    if let Err(e) = crate::music::scanner::move_dir::relocate_blob(
        pool,
        &blob.id,
        &new_path_str,
        new_size,
        created_by.as_ref().map(|(id, _)| id.as_str()),
    )
    .await
    {
        // the file itself already moved successfully at this point - a
        // metadata-update failure here is surfaced loudly but doesn't
        // undo the move (undoing risks a second collision of its own).
        result.errors.push(ErrorDetail::new(
            "local_path_update_failed",
            "Local Path Update Failed",
            format!("song {song_id}: {e}"),
        ));
    }
    result.songs_moved += 1;

    if embed_tags {
        match embed_song_tags(&dest_abs, &song, &artist_name, &album_title, album_id).await {
            Ok(true) => result.tags_embedded += 1,
            Ok(false) => result.tags_skipped_unsupported_format += 1,
            Err(e) => result.errors.push(ErrorDetail::new(
                "tag_embed_failed",
                "Tag Embed Failed",
                format!("song {song_id}: {e}"),
            )),
        }
    }
}

/// best-effort: fills in any of title/artist/album/track/disc the file
/// doesn't already carry, and adds a front-cover picture if the file has
/// none yet (never replaces an existing embedded cover - it may already
/// be a deliberate, better choice than this library's own album art).
/// returns `Ok(true)` if tags were written, `Ok(false)` if this file's
/// format can't be parsed or doesn't support saving tags (not an error -
/// plenty of formats genuinely don't support this).
async fn embed_song_tags(
    path: &Path,
    song: &crate::music::entities::songs::Song,
    artist: &str,
    album: &str,
    album_id: Option<String>,
) -> Result<bool, String> {
    use lofty::{Accessor, Probe, Tag, TagExt, TaggedFileExt};

    let mut tagged_file = match Probe::open(path).and_then(|p| p.read()) {
        Ok(f) => f,
        Err(_) => return Ok(false),
    };
    let tag_type = tagged_file.primary_tag_type();
    if tagged_file.primary_tag().is_none() {
        tagged_file.insert_tag(Tag::new(tag_type));
    }
    let tag = tagged_file
        .primary_tag_mut()
        .expect("tag was just inserted if missing");

    if tag.title().is_none() {
        tag.set_title(song.title.clone());
    }
    if tag.artist().is_none() {
        tag.set_artist(artist.to_string());
    }
    if tag.album().is_none() {
        tag.set_album(album.to_string());
    }
    if tag.track().is_none() && song.track_number > 0 {
        tag.set_track(song.track_number as u32);
    }
    if tag.disk().is_none() && song.disc_number > 0 {
        tag.set_disk(song.disc_number as u32);
    }

    if tag.pictures().is_empty() {
        if let Some(album_id) = album_id {
            if let Some(jpeg) = fetch_album_art_jpeg(&album_id).await {
                tag.push_picture(lofty::Picture::new_unchecked(
                    lofty::PictureType::CoverFront,
                    Some(lofty::MimeType::Jpeg),
                    None,
                    jpeg,
                ));
            }
        }
    }

    Ok(tag.save_to_path(path).is_ok())
}

async fn fetch_album_art_jpeg(album_id: &str) -> Option<Vec<u8>> {
    let pool = database::connect().await.ok()?;
    let blob_id: String = sqlx::query_scalar!(
        "SELECT media_blob_id FROM album_imagez WHERE album_id = ? AND is_primary = 1 LIMIT 1",
        album_id
    )
    .fetch_optional(&pool)
    .await
    .ok()
    .flatten()?;
    let (_, source) = crate::media_blobz::get_media_blob_stream_source(&blob_id)
        .await
        .ok()?;
    let bytes = match source {
        BlobStreamSource::File { path, .. } => tokio::fs::read(&path).await.ok()?,
        BlobStreamSource::Memory(bytes) => bytes,
    };
    crate::blob_data::convert_to_jpeg(&bytes).ok()
}

async fn reorganize_one_video(
    pool: &sqlx::SqlitePool,
    video_id: &str,
    target_root: &str,
    source_root: &str,
    dry_run: bool,
    created_by: Option<(String, String)>,
    result: &mut ReorganizeLibraryResult,
) {
    let Some(video) = crate::video::get_video(video_id).await.data else {
        result.errors.push(ErrorDetail::new(
            "video_not_found",
            "Video Not Found",
            format!("video {video_id}"),
        ));
        return;
    };
    let blob = match crate::media_blobz::get_media_blob(&video.media_blob_id).await {
        Ok(b) => b,
        Err(e) => {
            result.errors.push(ErrorDetail::new(
                "media_blob_not_found",
                "Media Blob Not Found",
                format!("video {video_id}: {e}"),
            ));
            return;
        }
    };
    let Some(local_path) = blob.local_path.clone() else {
        result.errors.push(ErrorDetail::new(
            "no_local_path",
            "No Local File",
            format!("video {video_id} has no local file to move (remote-only blob)"),
        ));
        return;
    };
    if local_path.starts_with(target_root) {
        result.videos_already_done += 1;
        return;
    }

    let series_title = match &video.series_id {
        Some(series_id) => crate::video::get_video_series(series_id)
            .await
            .data
            .map(|s| s.title),
        None => None,
    };
    let season_number = match &video.season_id {
        Some(season_id) => crate::video::get_video_season(season_id)
            .await
            .data
            .map(|s| s.season_number),
        None => None,
    };

    let folder = series_title
        .filter(|t| !t.is_empty())
        .unwrap_or_else(|| "Movies".to_string());
    let filename_title = match (season_number, video.episode_number) {
        (Some(season), Some(episode)) => {
            format!(
                "S{:02}E{:02} - {}",
                season.max(0),
                episode.max(0),
                video.title
            )
        }
        _ => video.title.clone(),
    };
    let ext = file_ops::resolve_extension(&blob);
    let base_relative = PathBuf::from(path_naming::sanitize_segment(&folder)).join(format!(
        "{}.{}",
        path_naming::sanitize_segment(&filename_title),
        ext
    ));

    let relative_path = match find_existing_claim(pool, target_root, None, Some(video_id)).await {
        Some(existing) => existing,
        None if dry_run => base_relative,
        None => match claim_path(pool, target_root, &base_relative, None, Some(video_id)).await {
            Ok(p) => p,
            Err(e) => {
                result.errors.push(ErrorDetail::new(
                    "claim_failed",
                    "Path Claim Failed",
                    format!("video {video_id}: {e}"),
                ));
                return;
            }
        },
    };

    if dry_run {
        result.videos_moved += 1;
        return;
    }

    let dest_abs = Path::new(target_root).join(&relative_path);
    if let Some(parent) = dest_abs.parent() {
        if let Err(e) = tokio::fs::create_dir_all(parent).await {
            result.errors.push(ErrorDetail::new(
                "mkdir_failed",
                "Directory Creation Failed",
                format!("video {video_id}: {e}"),
            ));
            return;
        }
    }
    if dest_abs.exists() {
        result.errors.push(ErrorDetail::new(
            "destination_exists",
            "Destination Already Exists",
            format!(
                "video {video_id}: refusing to move onto existing file at {}",
                dest_abs.display()
            ),
        ));
        return;
    }
    let src_abs = PathBuf::from(&local_path);
    if let Err(e) = file_ops::move_file(&src_abs, &dest_abs) {
        result.errors.push(ErrorDetail::new(
            "move_failed",
            "Move Failed",
            format!("video {video_id}: {e}"),
        ));
        return;
    }
    if let Some(old_parent) = src_abs.parent() {
        file_ops::prune_empty_ancestors(old_parent.to_path_buf(), Path::new(source_root));
    }

    let new_path_str = dest_abs.to_string_lossy().to_string();
    let new_size = blob.size.unwrap_or(0);
    if let Err(e) = crate::music::scanner::move_dir::relocate_blob(
        pool,
        &blob.id,
        &new_path_str,
        new_size,
        created_by.as_ref().map(|(id, _)| id.as_str()),
    )
    .await
    {
        result.errors.push(ErrorDetail::new(
            "local_path_update_failed",
            "Local Path Update Failed",
            format!("video {video_id}: {e}"),
        ));
    }
    result.videos_moved += 1;
}

/// process one batch job's fixed list of song ids.
pub async fn reorganize_songs_batch(
    song_ids: &[String],
    target_directory: &str,
    source_directory: &str,
    dry_run: bool,
    embed_tags: bool,
    created_by: Option<(String, String)>,
) -> GrimoireResponse<ReorganizeLibraryResult> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("failed to connect to database", vec![e.into()])
        }
    };
    let mut result = ReorganizeLibraryResult::default();
    for song_id in song_ids {
        reorganize_one_song(
            &pool,
            song_id,
            target_directory,
            source_directory,
            dry_run,
            embed_tags,
            created_by.clone(),
            &mut result,
        )
        .await;
    }
    GrimoireResponse::success("song reorganize batch complete", result)
}

/// process one batch job's fixed list of video ids.
pub async fn reorganize_videos_batch(
    video_ids: &[String],
    target_directory: &str,
    source_directory: &str,
    dry_run: bool,
    created_by: Option<(String, String)>,
) -> GrimoireResponse<ReorganizeLibraryResult> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("failed to connect to database", vec![e.into()])
        }
    };
    let mut result = ReorganizeLibraryResult::default();
    for video_id in video_ids {
        reorganize_one_video(
            &pool,
            video_id,
            target_directory,
            source_directory,
            dry_run,
            created_by.clone(),
            &mut result,
        )
        .await;
    }
    GrimoireResponse::success("video reorganize batch complete", result)
}

/// run the whole reorganize pass synchronously (no job queue) - used by
/// the CLI, which runs to completion in one call rather than needing the
/// admin_dispatch enqueue path's many-independent-jobs behavior (that
/// exists for the wizard, where fanning out lets a long run show live
/// progress and survive an app restart; the CLI is already a single
/// foreground process, so there's nothing to gain from a job queue here -
/// same reasoning as `repair_library_images_sync` vs its own job chain).
#[allow(clippy::too_many_arguments)]
pub async fn reorganize_library_sync(
    target_directory: &str,
    source_music: &str,
    source_video: &str,
    include_music: bool,
    include_video: bool,
    dry_run: bool,
    embed_tags: bool,
    created_by: Option<(String, String)>,
) -> GrimoireResponse<ReorganizeLibraryResult> {
    if let Err(e) = validate_target_directory(
        target_directory,
        source_music,
        source_video,
        include_music,
        include_video,
    ) {
        return GrimoireResponse::failure("invalid target directory", vec![e]);
    }

    let mut totals = ReorganizeLibraryResult::default();
    let batch_size = REORGANIZE_BATCH_SIZE as usize;

    if include_music {
        let song_ids = match list_candidate_song_ids(source_music, target_directory).await {
            Ok(ids) => ids,
            Err(e) => {
                return GrimoireResponse::failure(
                    "failed to list candidate songs",
                    vec![ErrorDetail::from(e)],
                )
            }
        };
        for chunk in song_ids.chunks(batch_size.max(1)) {
            let resp = reorganize_songs_batch(
                chunk,
                target_directory,
                source_music,
                dry_run,
                embed_tags,
                created_by.clone(),
            )
            .await;
            let Some(result) = resp.data else {
                return GrimoireResponse::failure(resp.message, resp.errors);
            };
            totals.merge(result);
        }
    }

    if include_video {
        let video_ids = match list_candidate_video_ids(source_video, target_directory).await {
            Ok(ids) => ids,
            Err(e) => {
                return GrimoireResponse::failure(
                    "failed to list candidate videos",
                    vec![ErrorDetail::from(e)],
                )
            }
        };
        for chunk in video_ids.chunks(batch_size.max(1)) {
            let resp = reorganize_videos_batch(
                chunk,
                target_directory,
                source_video,
                dry_run,
                created_by.clone(),
            )
            .await;
            let Some(result) = resp.data else {
                return GrimoireResponse::failure(resp.message, resp.errors);
            };
            totals.merge(result);
        }
    }

    if !dry_run {
        register_target_directory(
            target_directory,
            created_by.as_ref().map(|(id, _)| id.clone()),
        )
        .await;
        cleanup_if_fully_done(source_music, source_video, target_directory).await;
    }

    GrimoireResponse::success("library reorganize complete", totals)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn like_pattern_escapes_metacharacters() {
        assert_eq!(like_pattern("/data/100%_fetch"), "/data/100\\%\\_fetch/%");
    }

    #[test]
    fn merge_sums_every_counter() {
        let mut total = ReorganizeLibraryResult {
            songs_moved: 2,
            ..Default::default()
        };
        let batch = ReorganizeLibraryResult {
            songs_moved: 3,
            videos_moved: 1,
            errors: vec![ErrorDetail::new("x", "X", "detail")],
            ..Default::default()
        };
        total.merge(batch);
        assert_eq!(total.songs_moved, 5);
        assert_eq!(total.videos_moved, 1);
        assert_eq!(total.errors.len(), 1);
    }

    #[test]
    fn directories_overlap_same_dir() {
        assert!(directories_overlap("/data/fetch", "/data/fetch"));
        assert!(directories_overlap("/data/fetch/", "/data/fetch"));
    }

    #[test]
    fn directories_overlap_nested_either_direction() {
        assert!(directories_overlap("/data/fetch", "/data/fetch/sub"));
        assert!(directories_overlap("/data/fetch/sub", "/data/fetch"));
    }

    #[test]
    fn directories_overlap_false_for_siblings_and_prefixy_names() {
        assert!(!directories_overlap("/data/fetch", "/data/library"));
        // "/data/fetched" is NOT nested under "/data/fetch" - a naive
        // `starts_with` without the trailing '/' would wrongly say it is.
        assert!(!directories_overlap("/data/fetch", "/data/fetched"));
    }

    #[test]
    fn validate_target_directory_rejects_overlap_with_in_scope_domain_only() {
        // target == music source, but only video is in scope - should pass.
        assert!(validate_target_directory(
            "/data/fetch",
            "/data/fetch",
            "/data/video",
            true,
            false
        )
        .is_err());
        assert!(validate_target_directory(
            "/data/fetch",
            "/data/fetch",
            "/data/video",
            false,
            true
        )
        .is_ok());
    }

    #[test]
    fn validate_target_directory_allows_disjoint_dirs() {
        assert!(validate_target_directory(
            "/data/library",
            "/data/fetch",
            "/data/fetch_video",
            true,
            true
        )
        .is_ok());
    }
}
