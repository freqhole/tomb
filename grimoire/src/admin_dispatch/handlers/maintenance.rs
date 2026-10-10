//! maintenance handlers (cleanup, backfill, server image, spume update).

use crate::admin_dispatch::helpers::{
    bad_request, internal, opt_bool, opt_i64, opt_str, require_str, resolve_config_path, to_value,
};
use crate::error::ErrorDetail;
use crate::offal::Caller;
use crate::response::GrimoireResponse;
use serde_json::{json, Value as JsonValue};

pub(in crate::admin_dispatch) async fn cleanup_orphaned_tags(
    args: JsonValue,
) -> GrimoireResponse<JsonValue> {
    let dry_run = opt_bool(&args, "dry_run").unwrap_or(false);
    let resp = crate::maintenance::cleanup_orphaned_tags(dry_run).await;
    if !resp.success {
        return to_value(resp);
    }
    let data = resp
        .data
        .unwrap_or(crate::maintenance::OrphanedTagsSummary {
            tags_found: 0,
            tags_deleted: 0,
            tag_names: vec![],
        });
    let msg = if dry_run {
        format!(
            "dry run: {} orphaned tag(s) found, none deleted",
            data.tags_found
        )
    } else if data.tags_found == 0 {
        "no orphaned tags found".to_string()
    } else {
        format!(
            "deleted {} of {} orphaned tag(s)",
            data.tags_deleted, data.tags_found
        )
    };
    GrimoireResponse::success(
        &msg,
        json!({
            "dry_run": dry_run,
            "tags_found": data.tags_found,
            "tags_deleted": data.tags_deleted,
            "tag_names": data.tag_names,
        }),
    )
}

pub(in crate::admin_dispatch) async fn cleanup_orphaned_genres(
    args: JsonValue,
) -> GrimoireResponse<JsonValue> {
    let dry_run = opt_bool(&args, "dry_run").unwrap_or(false);
    let resp = crate::maintenance::cleanup_orphaned_genres(dry_run).await;
    if !resp.success {
        return to_value(resp);
    }
    let data = resp
        .data
        .unwrap_or(crate::maintenance::OrphanedGenresSummary {
            genres_found: 0,
            genres_deleted: 0,
            genre_names: vec![],
        });
    let msg = if dry_run {
        format!(
            "dry run: {} orphaned genre(s) found, none deleted",
            data.genres_found
        )
    } else if data.genres_found == 0 {
        "no orphaned genres found".to_string()
    } else {
        format!(
            "deleted {} of {} orphaned genre(s)",
            data.genres_deleted, data.genres_found
        )
    };
    GrimoireResponse::success(
        &msg,
        json!({
            "dry_run": dry_run,
            "genres_found": data.genres_found,
            "genres_deleted": data.genres_deleted,
            "genre_names": data.genre_names,
        }),
    )
}

pub(in crate::admin_dispatch) async fn cleanup_orphaned_artists(
    args: JsonValue,
) -> GrimoireResponse<JsonValue> {
    let dry_run = opt_bool(&args, "dry_run").unwrap_or(false);
    let resp = crate::maintenance::cleanup_orphaned_artists(dry_run).await;
    if !resp.success {
        return to_value(resp);
    }
    let data = resp
        .data
        .unwrap_or(crate::maintenance::OrphanedArtistsSummary {
            artists_found: 0,
            artists_deleted: 0,
            artist_names: vec![],
        });
    let msg = if dry_run {
        format!(
            "dry run: {} orphaned artist(s) found, none deleted",
            data.artists_found
        )
    } else if data.artists_found == 0 {
        "no orphaned artists found".to_string()
    } else {
        format!(
            "deleted {} of {} orphaned artist(s)",
            data.artists_deleted, data.artists_found
        )
    };
    GrimoireResponse::success(
        &msg,
        json!({
            "dry_run": dry_run,
            "artists_found": data.artists_found,
            "artists_deleted": data.artists_deleted,
            "artist_names": data.artist_names,
        }),
    )
}

pub(in crate::admin_dispatch) async fn cleanup_orphaned_albums(
    args: JsonValue,
) -> GrimoireResponse<JsonValue> {
    let dry_run = opt_bool(&args, "dry_run").unwrap_or(false);
    let resp = crate::maintenance::cleanup_orphaned_albums(dry_run).await;
    if !resp.success {
        return to_value(resp);
    }
    let data = resp
        .data
        .unwrap_or(crate::maintenance::OrphanedAlbumsSummary {
            albums_found: 0,
            albums_deleted: 0,
            album_titles: vec![],
        });
    let msg = if dry_run {
        format!(
            "dry run: {} orphaned album(s) found, none deleted",
            data.albums_found
        )
    } else if data.albums_found == 0 {
        "no orphaned albums found".to_string()
    } else {
        format!(
            "deleted {} of {} orphaned album(s)",
            data.albums_deleted, data.albums_found
        )
    };
    GrimoireResponse::success(
        &msg,
        json!({
            "dry_run": dry_run,
            "albums_found": data.albums_found,
            "albums_deleted": data.albums_deleted,
            "album_titles": data.album_titles,
        }),
    )
}

pub(in crate::admin_dispatch) async fn cleanup_orphaned_video_series(
    args: JsonValue,
) -> GrimoireResponse<JsonValue> {
    let dry_run = opt_bool(&args, "dry_run").unwrap_or(false);
    let resp = crate::maintenance::cleanup_orphaned_video_series(dry_run).await;
    if !resp.success {
        return to_value(resp);
    }
    let data = resp
        .data
        .unwrap_or(crate::maintenance::OrphanedVideoSeriesSummary {
            series_found: 0,
            series_deleted: 0,
            series_titles: vec![],
        });
    let msg = if dry_run {
        format!(
            "dry run: {} orphaned video series found, none deleted",
            data.series_found
        )
    } else if data.series_found == 0 {
        "no orphaned video series found".to_string()
    } else {
        format!(
            "deleted {} of {} orphaned video series",
            data.series_deleted, data.series_found
        )
    };
    GrimoireResponse::success(
        &msg,
        json!({
            "dry_run": dry_run,
            "series_found": data.series_found,
            "series_deleted": data.series_deleted,
            "series_titles": data.series_titles,
        }),
    )
}

pub(in crate::admin_dispatch) async fn cleanup_orphaned_taxons(
    args: JsonValue,
) -> GrimoireResponse<JsonValue> {
    let dry_run = opt_bool(&args, "dry_run").unwrap_or(false);
    let resp = crate::maintenance::cleanup_orphaned_taxons(dry_run).await;
    if !resp.success {
        return to_value(resp);
    }
    let data = resp
        .data
        .unwrap_or(crate::maintenance::OrphanedTaxonsSummary {
            taxons_found: 0,
            taxons_deleted: 0,
            taxon_labels: vec![],
        });
    let msg = if dry_run {
        format!(
            "dry run: {} orphaned taxon(s) found, none deleted",
            data.taxons_found
        )
    } else if data.taxons_found == 0 {
        "no orphaned taxons found".to_string()
    } else {
        format!(
            "deleted {} of {} orphaned taxon(s)",
            data.taxons_deleted, data.taxons_found
        )
    };
    GrimoireResponse::success(
        &msg,
        json!({
            "dry_run": dry_run,
            "taxons_found": data.taxons_found,
            "taxons_deleted": data.taxons_deleted,
            "taxon_labels": data.taxon_labels,
        }),
    )
}

/// soft-delete `media_blobz` rows with literally no retrievable content
/// anywhere (no local_path, no blob_data row, no blake3 - permanently
/// stuck) - see `blob_data::cleanup_contentless_media_blobs`'s doc comment.
pub(in crate::admin_dispatch) async fn cleanup_contentless_blobs(
    args: JsonValue,
) -> GrimoireResponse<JsonValue> {
    let dry_run = opt_bool(&args, "dry_run").unwrap_or(false);
    let resp = crate::maintenance::cleanup_contentless_media_blobs(dry_run).await;
    if !resp.success {
        return to_value(resp);
    }
    let data = resp.data.unwrap_or_default();
    let msg = if dry_run {
        format!(
            "dry run: {} contentless blob(s) found, none deleted",
            data.blobs_found
        )
    } else if data.blobs_found == 0 {
        "no contentless blobs found".to_string()
    } else {
        format!(
            "deleted {} of {} contentless blob(s){}",
            data.blobs_deleted,
            data.blobs_found,
            if data.deletion_failures > 0 {
                format!(" ({} failure(s))", data.deletion_failures)
            } else {
                String::new()
            }
        )
    };
    GrimoireResponse::success(
        &msg,
        json!({
            "dry_run": dry_run,
            "blobs_found": data.blobs_found,
            "blobs_deleted": data.blobs_deleted,
            "deletion_failures": data.deletion_failures,
        }),
    )
}

pub(in crate::admin_dispatch) async fn cleanup_all(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let dry_run = opt_bool(&args, "dry_run").unwrap_or(false);
    let tags = crate::maintenance::cleanup_orphaned_tags(dry_run).await;
    if !tags.success {
        return to_value(tags);
    }
    let genres = crate::maintenance::cleanup_orphaned_genres(dry_run).await;
    if !genres.success {
        return to_value(genres);
    }
    let tags_data = tags
        .data
        .unwrap_or(crate::maintenance::OrphanedTagsSummary {
            tags_found: 0,
            tags_deleted: 0,
            tag_names: vec![],
        });
    let genres_data = genres
        .data
        .unwrap_or(crate::maintenance::OrphanedGenresSummary {
            genres_found: 0,
            genres_deleted: 0,
            genre_names: vec![],
        });
    let total_found = tags_data.tags_found + genres_data.genres_found;
    let total_deleted = tags_data.tags_deleted + genres_data.genres_deleted;
    let payload = json!({
        "tags": tags_data,
        "genres": genres_data,
        "total_found": total_found,
        "total_deleted": total_deleted,
        "dry_run": dry_run,
    });
    let msg = if dry_run {
        format!("found {} orphaned records (dry run)", total_found)
    } else {
        format!(
            "deleted {} of {} orphaned records",
            total_deleted, total_found
        )
    };
    GrimoireResponse::success(&msg, payload)
}

pub(in crate::admin_dispatch) async fn backfill_thumbnails_count() -> GrimoireResponse<JsonValue> {
    to_value(crate::blob_data::count_blobs_needing_thumbnails().await)
}

/// backfill blake3 hashes for media_blobz rows that don't have one.
/// covers both file-backed audio (local_path set) and db-stored blobs
/// (images, thumbnails, waveforms in blob_data).
/// args: `{ batch_size?: i64 (default 100), concurrency?: i64 (default 16) }`
/// returns `{ scanned, hashed }` totals.
pub(in crate::admin_dispatch) async fn backfill_blake3(
    args: JsonValue,
) -> GrimoireResponse<JsonValue> {
    let batch_size = opt_i64(&args, "batch_size", 100);
    if batch_size <= 0 {
        return bad_request("batch_size must be > 0");
    }
    let concurrency = opt_i64(&args, "concurrency", 16).max(1) as usize;
    match crate::blobz::backfill_blake3_hashes(batch_size, concurrency).await {
        Ok((processed, remaining)) => {
            let msg = if processed == 0 && remaining == 0 {
                "all media blobs already have blake3 hashes".to_string()
            } else if remaining == 0 {
                format!("hashed {processed} blob(s); none remaining (batch_size={batch_size}, concurrency={concurrency})")
            } else {
                format!(
                    "hashed {processed} blob(s); {remaining} still need hashing (re-run /maintenance backfill-blake3 to continue; batch_size={batch_size}, concurrency={concurrency})"
                )
            };
            GrimoireResponse::success(
                &msg,
                json!({
                    "batch_size": batch_size,
                    "concurrency": concurrency,
                    "processed": processed,
                    "remaining": remaining,
                    "done": remaining == 0,
                }),
            )
        }
        Err(e) => GrimoireResponse::failure("backfill failed", vec![e.into()]),
    }
}

pub(in crate::admin_dispatch) async fn backfill_thumbnails(
    args: JsonValue,
    caller: &Caller,
) -> GrimoireResponse<JsonValue> {
    let limit = args.get("limit").and_then(|v| v.as_u64()).map(|v| v as u32);
    let dry_run = opt_bool(&args, "dry_run").unwrap_or(false);
    if dry_run {
        let count_resp = crate::blob_data::count_blobs_needing_thumbnails().await;
        if !count_resp.success {
            return to_value(count_resp);
        }
        let total = count_resp.data.unwrap_or(0);
        let to_process = limit.map(|l| l.min(total)).unwrap_or(total);
        let payload = json!({
            "dry_run": true,
            "blobs_needing_thumbnails": total,
            "will_process": to_process,
            "limit": limit,
        });
        return GrimoireResponse::success(
            format!(
                "would process {} blobs (of {} needing thumbnails)",
                to_process, total
            ),
            payload,
        );
    }
    to_value(crate::blob_data::backfill_thumbnails(limit, Some(caller.user_id.clone())).await)
}

pub(in crate::admin_dispatch) async fn update_server_image() -> GrimoireResponse<JsonValue> {
    let path = match resolve_config_path() {
        Ok(p) => p,
        Err(e) => return bad_request(format!("config not found: {e}")),
    };
    match crate::config::ensure_server_image_blob(&path).await {
        Ok(blob_id) => GrimoireResponse::success(
            format!("server image blob created: {blob_id}"),
            json!({
                "blob_id": blob_id,
                "config_path": path.display().to_string(),
            }),
        ),
        Err(e) => internal(format!("failed to update server image: {e}")),
    }
}

pub(in crate::admin_dispatch) async fn update_spume() -> GrimoireResponse<JsonValue> {
    if !crate::setup::has_embedded_spume() {
        return bad_request("this build does not include embedded spume web client");
    }
    let path = match resolve_config_path() {
        Ok(p) => p,
        Err(e) => return bad_request(format!("config not found: {e}")),
    };
    let cfg = match crate::config::GrimoireConfig::load(&path) {
        Ok(c) => c,
        Err(e) => return internal(format!("failed to load config: {e}")),
    };
    let server = match &cfg.server {
        Some(s) => s,
        None => return bad_request("config has no [server] section"),
    };
    if !server.static_files.enabled {
        return bad_request("server.static_files.enabled = false");
    }
    let spume_dir = match &server.static_files.directory {
        Some(d) => d.clone(),
        None => return bad_request("server.static_files.directory not set"),
    };
    if !spume_dir.exists() {
        return bad_request(format!("directory {} does not exist", spume_dir.display()));
    }
    match crate::setup::update_spume_to(&spume_dir) {
        Ok(result) => GrimoireResponse::success(
            "spume assets updated",
            json!({
                "directory": spume_dir.display().to_string(),
                "result": format!("{:?}", result),
            }),
        ),
        Err(e) => internal(format!("update_spume failed: {e:?}")),
    }
}

/// permanently delete media blobs that are soft-deleted and have no
/// remaining references, and whose `deleted_at` is older than
/// `min_age_days`. args: `{ min_age_days?: f64 (default 30.0), dry_run?: bool (default false) }`.
pub(in crate::admin_dispatch) async fn cleanup_orphaned_blobs(
    args: JsonValue,
) -> GrimoireResponse<JsonValue> {
    let min_age_days = args
        .get("min_age_days")
        .and_then(|v| v.as_f64())
        .unwrap_or(30.0);
    if min_age_days < 0.0 {
        return bad_request("min_age_days must be >= 0");
    }
    let dry_run = opt_bool(&args, "dry_run").unwrap_or(false);
    let resp =
        crate::maintenance::cleanup_orphaned_media_blobs_older_than(min_age_days, dry_run).await;
    if !resp.success {
        return to_value(resp);
    }
    let data = match resp.data {
        Some(d) => d,
        None => return to_value(resp),
    };
    let bytes_mb = data.bytes_freed as f64 / (1024.0 * 1024.0);
    let prefix = if dry_run { "dry run: " } else { "" };
    let msg = if data.orphaned_blobs_found == 0 {
        format!(
            "{prefix}no orphaned blobs older than {min_age_days} day(s) (checked {})",
            data.total_blobs_checked
        )
    } else if dry_run {
        format!(
            "{prefix}{} orphaned blob(s) older than {min_age_days} day(s) would be deleted, freeing ~{:.2} MiB (checked {} total)",
            data.orphaned_blobs_found,
            bytes_mb,
            data.total_blobs_checked,
        )
    } else {
        format!(
            "deleted {}/{} orphaned blob(s) older than {min_age_days} day(s); freed {:.2} MiB, removed {} app-managed file(s), left {} user-owned file(s) untouched ({} failure(s); checked {} total in {} ms)",
            data.orphaned_blobs_deleted,
            data.orphaned_blobs_found,
            bytes_mb,
            data.files_deleted,
            data.files_skipped_user_owned,
            data.deletion_failures,
            data.total_blobs_checked,
            data.duration_ms,
        )
    };
    GrimoireResponse::success(
        &msg,
        json!({
            "dry_run": dry_run,
            "min_age_days": min_age_days,
            "total_blobs_checked": data.total_blobs_checked,
            "orphaned_blobs_found": data.orphaned_blobs_found,
            "orphaned_blobs_deleted": data.orphaned_blobs_deleted,
            "deletion_failures": data.deletion_failures,
            "bytes_freed": data.bytes_freed,
            "bytes_freed_mib": format!("{bytes_mb:.2}"),
            "files_deleted": data.files_deleted,
            "files_skipped_user_owned": data.files_skipped_user_owned,
            "duration_ms": data.duration_ms,
        }),
    )
}

/// hard-delete songs/albums/artists/playlists/tags/genres that have
/// been soft-deleted longer than `retention_days`. args:
/// `{ retention_days?: u32 (default 30), delete_blob_data?: bool (default true), dry_run?: bool (default false) }`.
pub(in crate::admin_dispatch) async fn hard_delete_old_records(
    args: JsonValue,
) -> GrimoireResponse<JsonValue> {
    let retention_days = args
        .get("retention_days")
        .and_then(|v| v.as_u64())
        .map(|v| v as u32)
        .unwrap_or(30);
    let delete_blob_data = opt_bool(&args, "delete_blob_data").unwrap_or(true);
    let dry_run = opt_bool(&args, "dry_run").unwrap_or(false);
    let opts = crate::maintenance::HardDeleteOptions {
        retention_days,
        delete_blob_data,
        dry_run,
    };
    let resp = crate::maintenance::hard_delete_old_records(opts).await;
    if !resp.success {
        return to_value(resp);
    }
    let data = match resp.data {
        Some(d) => d,
        None => return to_value(resp),
    };
    let prefix = if dry_run { "dry run: " } else { "" };
    let msg = format!(
        "{prefix}hard-delete pass: {} record(s) across songs={} albums={} artists={} playlists={} tags={} genres={} media_blobs={} blob_data={} (retention={}d, delete_blob_data={}, {} ms)",
        data.total_records_deleted,
        data.songs_deleted,
        data.albums_deleted,
        data.artists_deleted,
        data.playlists_deleted,
        data.tags_deleted,
        data.genres_deleted,
        data.media_blobs_deleted,
        data.blob_data_deleted,
        retention_days,
        delete_blob_data,
        data.duration_ms,
    );
    GrimoireResponse::success(
        &msg,
        json!({
            "dry_run": dry_run,
            "retention_days": retention_days,
            "delete_blob_data": delete_blob_data,
            "summary": data,
        }),
    )
}

/// hard-delete videos/seasons/series that have been soft-deleted longer
/// than `retention_days`. args: `{ retention_days?: u32 (default 30),
/// dry_run?: bool (default false) }`. row-level only - any media blobs (and
/// their app-managed files) this orphans are reclaimed separately by the
/// domain-agnostic `maintenance_cleanup_orphaned_blobs`/`maintenance_run_full`
/// pass, which never deletes a file living outside the app's own data_dir
/// (i.e. a user's own library file, added via directory scan).
pub(in crate::admin_dispatch) async fn hard_delete_old_videos(
    args: JsonValue,
) -> GrimoireResponse<JsonValue> {
    let retention_days = args
        .get("retention_days")
        .and_then(|v| v.as_u64())
        .map(|v| v as u32)
        .unwrap_or(30);
    let dry_run = opt_bool(&args, "dry_run").unwrap_or(false);
    let opts = crate::maintenance::HardDeleteVideoOptions {
        retention_days,
        dry_run,
    };
    let resp = crate::maintenance::hard_delete_old_videos(opts).await;
    if !resp.success {
        return to_value(resp);
    }
    let data = match resp.data {
        Some(d) => d,
        None => return to_value(resp),
    };
    let prefix = if dry_run { "dry run: " } else { "" };
    let msg = format!(
        "{prefix}video hard-delete pass: {} record(s) (videos={} seasons={} series={}) (retention={}d, {} ms)",
        data.total_records_deleted,
        data.videos_deleted,
        data.seasons_deleted,
        data.series_deleted,
        retention_days,
        data.duration_ms,
    );
    GrimoireResponse::success(
        &msg,
        json!({
            "dry_run": dry_run,
            "retention_days": retention_days,
            "summary": data,
        }),
    )
}

/// run the full maintenance pipeline (orphaned tags + genres cleanup
/// + hard-delete pass). args: same as `hard_delete_old_records`.
pub(in crate::admin_dispatch) async fn run_full(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let retention_days = args
        .get("retention_days")
        .and_then(|v| v.as_u64())
        .map(|v| v as u32)
        .unwrap_or(30);
    let delete_blob_data = opt_bool(&args, "delete_blob_data").unwrap_or(true);
    let dry_run = opt_bool(&args, "dry_run").unwrap_or(false);
    let opts = crate::maintenance::HardDeleteOptions {
        retention_days,
        delete_blob_data,
        dry_run,
    };
    let resp = crate::maintenance::run_full_maintenance_with_options(opts).await;
    if !resp.success {
        return to_value(resp);
    }
    let data = match resp.data {
        Some(d) => d,
        None => return to_value(resp),
    };
    let prefix = if dry_run { "dry run: " } else { "" };
    let blobs = &data.orphaned_blobs_cleaned;
    let hd = &data.hard_delete_summary;
    let bytes_mb = blobs.bytes_freed as f64 / (1024.0 * 1024.0);
    let msg = format!(
        "{prefix}full maintenance: {} orphaned blob(s) deleted ({:.2} MiB freed, {} file(s) removed, {} user-owned file(s) untouched), {} record(s) hard-deleted (retention={}d, delete_blob_data={}, {} ms total)",
        blobs.orphaned_blobs_deleted,
        bytes_mb,
        blobs.files_deleted,
        blobs.files_skipped_user_owned,
        hd.total_records_deleted,
        retention_days,
        delete_blob_data,
        data.total_duration_ms,
    );
    GrimoireResponse::success(
        &msg,
        json!({
            "dry_run": dry_run,
            "retention_days": retention_days,
            "delete_blob_data": delete_blob_data,
            "orphaned_blobs_cleaned": blobs,
            "hard_delete_summary": hd,
            "total_duration_ms": data.total_duration_ms,
            "bytes_freed_mib": format!("{bytes_mb:.2}"),
        }),
    )
}

fn repair_summary_payload(
    dry_run: bool,
    scan_directory: Option<&str>,
    data: &crate::maintenance::RepairLibraryImagesResult,
) -> JsonValue {
    json!({
        "dry_run": dry_run,
        "scan_directory": scan_directory,
        "songs_waveforms_backfilled": data.songs_waveforms_backfilled,
        "albums_thumbnails_backfilled": data.albums_thumbnails_backfilled,
        "albums_thumbnails_removed_overapplied": data.albums_thumbnails_removed_overapplied,
        "albums_left_ambiguous": data.albums_left_ambiguous,
        "videos_waveforms_backfilled": data.videos_waveforms_backfilled,
        "videos_thumbnails_backfilled": data.videos_thumbnails_backfilled,
        "errors": data.errors,
    })
}

fn repair_summary_message(
    dry_run: bool,
    data: &crate::maintenance::RepairLibraryImagesResult,
) -> String {
    let verb = if dry_run {
        "would backfill"
    } else {
        "backfilled"
    };
    let remove_verb = if dry_run { "would remove" } else { "removed" };
    format!(
        "{verb} {} song waveform(s), {} album thumbnail(s), {} video waveform(s), {} video thumbnail(s); \
         {remove_verb} {} over-applied image(s); {} album(s) left ambiguous ({} error(s))",
        data.songs_waveforms_backfilled,
        data.albums_thumbnails_backfilled,
        data.videos_waveforms_backfilled,
        data.videos_thumbnails_backfilled,
        data.albums_thumbnails_removed_overapplied,
        data.albums_left_ambiguous,
        data.errors.len(),
    )
}

/// read the repair sub-job toggles from args, each defaulting per
/// `preset` (so the waveforms-only/thumbnails-only presets below can
/// still honor an explicit override, but fall back to their own fixed
/// defaults rather than `RepairLibraryImagesOptions::default()`'s).
fn parse_repair_options(
    args: &JsonValue,
    preset: crate::maintenance::RepairLibraryImagesOptions,
) -> crate::maintenance::RepairLibraryImagesOptions {
    crate::maintenance::RepairLibraryImagesOptions {
        backfill_waveforms: opt_bool(args, "backfill_waveforms")
            .unwrap_or(preset.backfill_waveforms),
        backfill_embedded_art: opt_bool(args, "backfill_embedded_art")
            .unwrap_or(preset.backfill_embedded_art),
        backfill_directory_art: opt_bool(args, "backfill_directory_art")
            .unwrap_or(preset.backfill_directory_art),
        remove_overapplied: opt_bool(args, "remove_overapplied")
            .unwrap_or(preset.remove_overapplied),
        backfill_video_thumbnails: opt_bool(args, "backfill_video_thumbnails")
            .unwrap_or(preset.backfill_video_thumbnails),
    }
}

/// run the full library image repair (song+video waveform backfill,
/// video thumbnail backfill, and directory-grouped song/album thumbnail
/// backfill/cleanup, see `maintenance::repair_library_images_sync`'s doc
/// comment). args: `{ dry_run?: bool, scan_directory?: string,
/// backfill_waveforms?: bool, backfill_embedded_art?: bool,
/// backfill_directory_art?: bool, remove_overapplied?: bool,
/// backfill_video_thumbnails?: bool }` - all five sub-job toggles
/// default per `RepairLibraryImagesOptions::default()` (every backfill
/// action on, the destructive removal off). this is the command the
/// charnel wizard's repair checklist posts to.
pub(in crate::admin_dispatch) async fn repair_library(
    args: JsonValue,
    caller: &Caller,
) -> GrimoireResponse<JsonValue> {
    let dry_run = opt_bool(&args, "dry_run").unwrap_or(false);
    let scan_directory = opt_str(&args, "scan_directory");
    let options = parse_repair_options(
        &args,
        crate::maintenance::RepairLibraryImagesOptions::default(),
    );
    let resp = crate::maintenance::repair_library_images_sync(
        dry_run,
        scan_directory.clone(),
        options,
        Some((caller.user_id.clone(), caller.username.clone())),
    )
    .await;
    let Some(data) = resp.data else {
        return to_value(resp);
    };
    GrimoireResponse::success(
        repair_summary_message(dry_run, &data),
        repair_summary_payload(dry_run, scan_directory.as_deref(), &data),
    )
}

/// waveform-only preset of `repair_library` - backfills missing song
/// waveforms without touching album thumbnails. args: `{ dry_run?: bool,
/// scan_directory?: string }`.
pub(in crate::admin_dispatch) async fn repair_library_waveforms(
    args: JsonValue,
    caller: &Caller,
) -> GrimoireResponse<JsonValue> {
    let dry_run = opt_bool(&args, "dry_run").unwrap_or(false);
    let scan_directory = opt_str(&args, "scan_directory");
    let options = crate::maintenance::RepairLibraryImagesOptions {
        backfill_waveforms: true,
        backfill_embedded_art: false,
        backfill_directory_art: false,
        remove_overapplied: false,
        backfill_video_thumbnails: false,
    };
    let resp = crate::maintenance::repair_library_images_sync(
        dry_run,
        scan_directory.clone(),
        options,
        Some((caller.user_id.clone(), caller.username.clone())),
    )
    .await;
    let Some(data) = resp.data else {
        return to_value(resp);
    };
    GrimoireResponse::success(
        repair_summary_message(dry_run, &data),
        repair_summary_payload(dry_run, scan_directory.as_deref(), &data),
    )
}

/// directory-image preset of `repair_library` - backfills missing album
/// thumbnails and (optionally) cleans up over-applied directory images,
/// without touching song/video waveforms or video thumbnails. args: `{
/// dry_run?: bool, scan_directory?: string, backfill_embedded_art?: bool,
/// backfill_directory_art?: bool, remove_overapplied?: bool }`.
pub(in crate::admin_dispatch) async fn repair_library_thumbnails(
    args: JsonValue,
    caller: &Caller,
) -> GrimoireResponse<JsonValue> {
    let dry_run = opt_bool(&args, "dry_run").unwrap_or(false);
    let scan_directory = opt_str(&args, "scan_directory");
    let mut options = parse_repair_options(
        &args,
        crate::maintenance::RepairLibraryImagesOptions::default(),
    );
    options.backfill_waveforms = false;
    options.backfill_video_thumbnails = false;
    let resp = crate::maintenance::repair_library_images_sync(
        dry_run,
        scan_directory.clone(),
        options,
        Some((caller.user_id.clone(), caller.username.clone())),
    )
    .await;
    let Some(data) = resp.data else {
        return to_value(resp);
    };
    GrimoireResponse::success(
        repair_summary_message(dry_run, &data),
        repair_summary_payload(dry_run, scan_directory.as_deref(), &data),
    )
}

/// video-thumbnail-only preset of `repair_library` - backfills a missing
/// poster/thumbnail (ffmpeg frame grab) for any video that doesn't have
/// one yet, without touching anything else. args: `{ dry_run?: bool,
/// scan_directory?: string }`.
pub(in crate::admin_dispatch) async fn repair_library_video_thumbnails(
    args: JsonValue,
    caller: &Caller,
) -> GrimoireResponse<JsonValue> {
    let dry_run = opt_bool(&args, "dry_run").unwrap_or(false);
    let scan_directory = opt_str(&args, "scan_directory");
    let options = crate::maintenance::RepairLibraryImagesOptions {
        backfill_waveforms: false,
        backfill_embedded_art: false,
        backfill_directory_art: false,
        remove_overapplied: false,
        backfill_video_thumbnails: true,
    };
    let resp = crate::maintenance::repair_library_images_sync(
        dry_run,
        scan_directory.clone(),
        options,
        Some((caller.user_id.clone(), caller.username.clone())),
    )
    .await;
    let Some(data) = resp.data else {
        return to_value(resp);
    };
    GrimoireResponse::success(
        repair_summary_message(dry_run, &data),
        repair_summary_payload(dry_run, scan_directory.as_deref(), &data),
    )
}

/// one resumable step of the library image repair pass - exposes the
/// same phase/batch primitives `jobs::music::repair_library_images_processor`
/// uses for its job chain, but driven by the caller round-tripping this
/// command instead of a background job. `repair_library`'s single
/// round-trip blocks until the WHOLE library is done, which on a large
/// library (lots of individual ffmpeg calls) can look stuck for a long
/// time with zero feedback - this lets a caller (the charnel wizard)
/// call once per batch instead and show live progress between calls.
///
/// args: `{ dry_run?: bool, scan_directory?: string, phase?:
/// RepairLibraryImagesPhase, directory_offset?: number,
/// backfill_waveforms?: bool, backfill_embedded_art?: bool,
/// backfill_directory_art?: bool, remove_overapplied?: bool,
/// backfill_video_thumbnails?: bool }` - `phase`/`directory_offset`
/// default to the very first step (`waveforms`/`0`), so an initial call
/// needs neither. despite the name, `directory_offset` carries the
/// offset for WHICHEVER phase is current, not just `Directories` - only
/// meaningful under `dry_run` (a real run's per-phase candidate set
/// shrinks on its own as rows get fixed; see `repair_waveforms_batch`'s
/// doc comment for why a dry run needs one instead).
///
/// response: `{ phase, next_phase, next_directory_offset, done,
/// scan_directory, batch }` - `batch` is just THIS step's counts (a
/// `RepairLibraryImagesResult`); the caller accumulates a running total
/// across calls itself, same as the job chain's `carry` parameter. calls
/// again with `next_phase`/`next_directory_offset` until `done` is true.
pub(in crate::admin_dispatch) async fn repair_library_step(
    args: JsonValue,
    caller: &Caller,
) -> GrimoireResponse<JsonValue> {
    let dry_run = opt_bool(&args, "dry_run").unwrap_or(false);
    let scan_directory = opt_str(&args, "scan_directory");
    let options = parse_repair_options(
        &args,
        crate::maintenance::RepairLibraryImagesOptions::default(),
    );
    let phase: crate::maintenance::RepairLibraryImagesPhase = args
        .get("phase")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();
    let directory_offset = args
        .get("directory_offset")
        .and_then(|v| v.as_i64())
        .unwrap_or(0);
    let created_by = Some((caller.user_id.clone(), caller.username.clone()));

    use crate::maintenance::{
        RepairLibraryImagesPhase as Phase, RepairLibraryImagesResult, DIRECTORY_BATCH_SIZE,
        VIDEO_THUMBNAIL_BATCH_SIZE, WAVEFORM_BATCH_SIZE,
    };

    let (batch, next): (RepairLibraryImagesResult, Option<(Phase, i64)>) = match phase {
        Phase::Waveforms if !options.backfill_waveforms => (
            RepairLibraryImagesResult::default(),
            Some((Phase::VideoThumbnails, 0)),
        ),
        Phase::Waveforms => {
            let resp = crate::maintenance::repair_waveforms_batch(
                dry_run,
                WAVEFORM_BATCH_SIZE,
                directory_offset,
                scan_directory.as_deref(),
                created_by.clone(),
            )
            .await;
            let Some(outcome) = resp.data else {
                return GrimoireResponse::failure(resp.message, resp.errors);
            };
            // a real run's candidate set shrinks on its own; only a dry
            // run (never writes) needs the offset to advance so it
            // doesn't re-fetch the same rows forever - see
            // `repair_waveforms_batch`'s doc comment.
            let next = if outcome.more_remaining {
                let next_offset = if dry_run {
                    directory_offset + WAVEFORM_BATCH_SIZE
                } else {
                    0
                };
                Some((Phase::Waveforms, next_offset))
            } else {
                Some((Phase::VideoWaveforms, 0))
            };
            (outcome.result, next)
        }
        Phase::VideoWaveforms if !options.backfill_waveforms => (
            RepairLibraryImagesResult::default(),
            Some((Phase::VideoThumbnails, 0)),
        ),
        Phase::VideoWaveforms => {
            let resp = crate::maintenance::repair_video_waveforms_batch(
                dry_run,
                WAVEFORM_BATCH_SIZE,
                directory_offset,
                scan_directory.as_deref(),
                created_by.clone(),
            )
            .await;
            let Some(outcome) = resp.data else {
                return GrimoireResponse::failure(resp.message, resp.errors);
            };
            let next = if outcome.more_remaining {
                let next_offset = if dry_run {
                    directory_offset + WAVEFORM_BATCH_SIZE
                } else {
                    0
                };
                Some((Phase::VideoWaveforms, next_offset))
            } else {
                Some((Phase::VideoThumbnails, 0))
            };
            (outcome.result, next)
        }
        Phase::VideoThumbnails if !options.backfill_video_thumbnails => (
            RepairLibraryImagesResult::default(),
            Some((Phase::Directories, 0)),
        ),
        Phase::VideoThumbnails => {
            let resp = crate::maintenance::repair_video_thumbnails_batch(
                dry_run,
                VIDEO_THUMBNAIL_BATCH_SIZE,
                directory_offset,
                scan_directory.as_deref(),
                created_by.clone(),
            )
            .await;
            let Some(outcome) = resp.data else {
                return GrimoireResponse::failure(resp.message, resp.errors);
            };
            let next = if outcome.more_remaining {
                let next_offset = if dry_run {
                    directory_offset + VIDEO_THUMBNAIL_BATCH_SIZE
                } else {
                    0
                };
                Some((Phase::VideoThumbnails, next_offset))
            } else {
                Some((Phase::Directories, 0))
            };
            (outcome.result, next)
        }
        Phase::Directories if !options.any_directory_action() => {
            (RepairLibraryImagesResult::default(), None)
        }
        Phase::Directories => {
            let resp = crate::maintenance::repair_directories_batch(
                dry_run,
                directory_offset,
                DIRECTORY_BATCH_SIZE,
                scan_directory.as_deref(),
                options,
                created_by.clone(),
            )
            .await;
            let Some(outcome) = resp.data else {
                return GrimoireResponse::failure(resp.message, resp.errors);
            };
            let next = outcome
                .more_remaining
                .then_some((Phase::Directories, outcome.next_offset));
            (outcome.result, next)
        }
    };

    let done = next.is_none();
    let (next_phase, next_directory_offset) = next.unwrap_or((phase, 0));
    GrimoireResponse::success(
        "repair library step complete",
        json!({
            "phase": phase,
            "next_phase": next_phase,
            "next_directory_offset": next_directory_offset,
            "done": done,
            "scan_directory": scan_directory,
            "batch": batch,
        }),
    )
}

/// which domain(s) to include - "music" | "video" | anything else (incl.
/// missing/"both") means both. lenient on purpose: an admin_dispatch arg
/// typo falls back to the safe "do everything" default rather than
/// erroring.
fn wants_music(domain: &str) -> bool {
    domain != "video"
}
fn wants_video(domain: &str) -> bool {
    domain != "music"
}

/// resolve the default fetch source directories for the reorganize-library
/// UI's hint text - no DB queries, just reads config (or honors explicit
/// overrides, mirroring `reorganize_library_plan`/`_enqueue`'s own args).
pub(in crate::admin_dispatch) async fn reorganize_library_source_dirs(
    args: JsonValue,
) -> GrimoireResponse<JsonValue> {
    let source_music = opt_str(&args, "source_music_directory")
        .unwrap_or_else(crate::maintenance::default_music_source_dir);
    let source_video = opt_str(&args, "source_video_directory")
        .unwrap_or_else(crate::maintenance::default_video_source_dir);
    GrimoireResponse::success(
        "resolved default fetch source directories",
        json!({
            "source_music_directory": source_music,
            "source_video_directory": source_video,
        }),
    )
}

/// preview (no writes, no jobs created) for `maintenance_reorganize_library_enqueue`'s
/// args: `{ target_directory: string, domain?: "music"|"video"|"both",
/// source_music_directory?: string, source_video_directory?: string }` -
/// source dirs default to the configured `fetch_music`/`fetch_video`
/// output dirs (see `maintenance::default_music_source_dir`/
/// `default_video_source_dir`) when omitted.
pub(in crate::admin_dispatch) async fn reorganize_library_plan(
    args: JsonValue,
) -> GrimoireResponse<JsonValue> {
    let target_directory = match require_str(&args, "target_directory") {
        Ok(v) => v,
        Err(r) => return r,
    };
    let domain = opt_str(&args, "domain").unwrap_or_else(|| "both".to_string());
    let source_music = opt_str(&args, "source_music_directory")
        .unwrap_or_else(crate::maintenance::default_music_source_dir);
    let source_video = opt_str(&args, "source_video_directory")
        .unwrap_or_else(crate::maintenance::default_video_source_dir);
    if let Err(e) = crate::maintenance::validate_target_directory(
        &target_directory,
        &source_music,
        &source_video,
        wants_music(&domain),
        wants_video(&domain),
    ) {
        return GrimoireResponse::failure("invalid target directory", vec![e]);
    }

    let songs_candidate = if wants_music(&domain) {
        match crate::maintenance::list_candidate_song_ids(&source_music, &target_directory).await {
            Ok(ids) => ids.len(),
            Err(e) => {
                return GrimoireResponse::failure(
                    "failed to list candidate songs",
                    vec![ErrorDetail::from(e)],
                )
            }
        }
    } else {
        0
    };
    let videos_candidate = if wants_video(&domain) {
        match crate::maintenance::list_candidate_video_ids(&source_video, &target_directory).await {
            Ok(ids) => ids.len(),
            Err(e) => {
                return GrimoireResponse::failure(
                    "failed to list candidate videos",
                    vec![ErrorDetail::from(e)],
                )
            }
        }
    } else {
        0
    };

    GrimoireResponse::success(
        format!(
            "{} song(s) and {} video(s) would move to {}",
            songs_candidate, videos_candidate, target_directory
        ),
        json!({
            "target_directory": target_directory,
            "source_music_directory": source_music,
            "source_video_directory": source_video,
            "songs_candidate": songs_candidate,
            "videos_candidate": videos_candidate,
        }),
    )
}

/// enqueue one `ReorganizeLibraryFiles` batch job for a fixed id chunk -
/// shared by the song and video enqueue loops below. each job carries
/// ids from exactly ONE domain (never mixed), so it also carries that
/// domain's own source directory - music and video can have (and often
/// do have) different fetch dirs. every batch from the same run shares
/// `session_id` so the generic per-session rollup in `jobs::runner`
/// emits `Progress`/`Completed` events a subscriber can follow without
/// polling - same mechanism `ProcessDirectory` scan jobs already use.
#[allow(clippy::too_many_arguments)]
async fn enqueue_reorganize_batch(
    song_ids: Vec<String>,
    video_ids: Vec<String>,
    target_directory: &str,
    source_directory: &str,
    dry_run: bool,
    embed_tags: bool,
    session_id: &str,
    caller: &Caller,
) -> Result<String, ErrorDetail> {
    let params = crate::jobs::ReorganizeLibraryFilesParams {
        target_directory: target_directory.to_string(),
        source_directory: source_directory.to_string(),
        song_ids,
        video_ids,
        dry_run,
        embed_tags,
    };
    let parameters = serde_json::to_value(&params).map_err(|e| {
        ErrorDetail::new(
            "serialization_error",
            "failed to serialize job parameters",
            e.to_string(),
        )
    })?;
    let req = crate::jobs::CreateJobRequest {
        job_type: crate::jobs::JobType::ReorganizeLibraryFiles,
        session_id: Some(session_id.to_string()),
        parameters,
        max_retries: Some(1),
        scheduled_at: None,
        created_by: Some(caller.user_id.clone()),
        priority: None,
    };
    let resp = crate::jobs::create_job(req).await;
    resp.data.map(|j| j.id).ok_or_else(|| {
        ErrorDetail::new(
            "job_creation_failed",
            "failed to enqueue reorganize batch",
            resp.message,
        )
    })
}

/// enqueue the whole reorganize-library run as a set of independent batch
/// jobs - one per `REORGANIZE_BATCH_SIZE`-sized chunk of song or video
/// ids, each a separate job (NOT chained - see
/// `maintenance::reorganize_library`'s module doc comment for why that's
/// safe). args: same as `reorganize_library_plan`, plus `dry_run?: bool`,
/// `embed_tags?: bool` (songs only, default true), and an optional
/// `session_id` (generated here when omitted) that every batch job in
/// this run shares - lets a caller subscribe to `jobs_events_subscribe`
/// with `{ "session_ids": [session_id] }` and get `Progress`/`Completed`
/// events for the whole run instead of polling. if there's nothing left
/// to move for either domain, no jobs are created and this also cleans
/// up `library_reorganize_claimed_pathz` bookkeeping for
/// `target_directory` (see `maintenance::cleanup_if_fully_done`).
pub(in crate::admin_dispatch) async fn reorganize_library_enqueue(
    args: JsonValue,
    caller: &Caller,
) -> GrimoireResponse<JsonValue> {
    let target_directory = match require_str(&args, "target_directory") {
        Ok(v) => v,
        Err(r) => return r,
    };
    let domain = opt_str(&args, "domain").unwrap_or_else(|| "both".to_string());
    let dry_run = opt_bool(&args, "dry_run").unwrap_or(false);
    let embed_tags = opt_bool(&args, "embed_tags").unwrap_or(true);
    let session_id =
        opt_str(&args, "session_id").unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let source_music = opt_str(&args, "source_music_directory")
        .unwrap_or_else(crate::maintenance::default_music_source_dir);
    let source_video = opt_str(&args, "source_video_directory")
        .unwrap_or_else(crate::maintenance::default_video_source_dir);
    if let Err(e) = crate::maintenance::validate_target_directory(
        &target_directory,
        &source_music,
        &source_video,
        wants_music(&domain),
        wants_video(&domain),
    ) {
        return GrimoireResponse::failure("invalid target directory", vec![e]);
    }

    let song_ids = if wants_music(&domain) {
        match crate::maintenance::list_candidate_song_ids(&source_music, &target_directory).await {
            Ok(ids) => ids,
            Err(e) => {
                return GrimoireResponse::failure(
                    "failed to list candidate songs",
                    vec![ErrorDetail::from(e)],
                )
            }
        }
    } else {
        Vec::new()
    };
    let video_ids = if wants_video(&domain) {
        match crate::maintenance::list_candidate_video_ids(&source_video, &target_directory).await {
            Ok(ids) => ids,
            Err(e) => {
                return GrimoireResponse::failure(
                    "failed to list candidate videos",
                    vec![ErrorDetail::from(e)],
                )
            }
        }
    } else {
        Vec::new()
    };

    if song_ids.is_empty() && video_ids.is_empty() {
        if !dry_run {
            crate::maintenance::cleanup_if_fully_done(
                &source_music,
                &source_video,
                &target_directory,
            )
            .await;
        }
        return GrimoireResponse::success(
            "nothing to reorganize - every song/video is already under the target directory",
            json!({
                "job_ids": Vec::<String>::new(),
                "session_id": session_id,
                "songs_queued": 0,
                "videos_queued": 0,
            }),
        );
    }

    let batch_size = crate::maintenance::REORGANIZE_BATCH_SIZE as usize;
    let mut job_ids = Vec::new();
    let mut errors = Vec::new();

    for chunk in song_ids.chunks(batch_size.max(1)) {
        match enqueue_reorganize_batch(
            chunk.to_vec(),
            Vec::new(),
            &target_directory,
            &source_music,
            dry_run,
            embed_tags,
            &session_id,
            caller,
        )
        .await
        {
            Ok(id) => job_ids.push(id),
            Err(e) => errors.push(e),
        }
    }
    for chunk in video_ids.chunks(batch_size.max(1)) {
        match enqueue_reorganize_batch(
            Vec::new(),
            chunk.to_vec(),
            &target_directory,
            &source_video,
            dry_run,
            false,
            &session_id,
            caller,
        )
        .await
        {
            Ok(id) => job_ids.push(id),
            Err(e) => errors.push(e),
        }
    }

    if job_ids.is_empty() {
        return GrimoireResponse::failure("failed to enqueue any reorganize batches", errors);
    }

    GrimoireResponse::success(
        format!(
            "enqueued {} batch job(s) for {} song(s) and {} video(s)",
            job_ids.len(),
            song_ids.len(),
            video_ids.len()
        ),
        json!({
            "job_ids": job_ids,
            "session_id": session_id,
            "songs_queued": song_ids.len(),
            "videos_queued": video_ids.len(),
            "errors": errors,
        }),
    )
}
