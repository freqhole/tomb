//! video-side counterpart to `repair_library_images.rs`'s waveform and
//! thumbnail backfill: fills in a missing waveform or poster/thumbnail
//! for an already-imported video, using the exact same ffmpeg primitives
//! the importer uses at import time (`blob_data::create_audio_waveform_blob`,
//! `video::importer::extract_video_poster`) - just run after the fact,
//! in small batches, for videos that slipped through (imported before
//! ffmpeg was configured, or a one-off extraction failure at import
//! time). mirrors `repair_waveforms_batch`'s shape closely; videos have
//! no directory-grouping concept (a poster is always a frame grab from
//! the video's own file, never shared across unrelated items the way a
//! stray folder.jpg can be), so there's no equivalent to
//! `repair_directories_batch` here.

use super::repair_library_images::{scan_directory_pattern, RepairLibraryImagesResult};
use super::WaveformBatchOutcome;
use crate::database;
use crate::error::ErrorDetail;
use crate::media_blobz::BlobType;
use crate::response::GrimoireResponse;
use crate::video::VideoEntityType;
use std::path::Path;

/// videos processed per thumbnail-phase batch - smaller than the
/// waveform batch size since each row can involve an ffmpeg frame-grab +
/// webp conversion + sized-thumbnail generation.
pub const VIDEO_THUMBNAIL_BATCH_SIZE: i64 = 100;

/// backfill a waveform for up to `limit` videos that don't have one yet
/// and do have an audio stream (a silent video is skipped, not counted
/// as an error - see `video::importer::video_has_audio_stream`).
/// `dry_run` still probes each candidate for an audio stream (read-only)
/// so the reported count matches what an actual run would do, it just
/// skips the ffmpeg waveform generation + db write. `scan_directory` and
/// `created_by` mirror `repair_waveforms_batch`'s same-named parameters.
pub async fn repair_video_waveforms_batch(
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
    let created_by_string = created_by.as_ref().map(|(id, _)| id.clone());

    let like_prefix = scan_directory_pattern(scan_directory);

    let candidates = sqlx::query!(
        r#"
        SELECT v.id as "video_id!", v.media_blob_id as "media_blob_id!", mb.local_path as "local_path!"
        FROM videoz v
        JOIN media_blobz mb ON mb.id = v.media_blob_id
        WHERE v.deleted_at IS NULL
          AND mb.local_path IS NOT NULL
          AND (?1 IS NULL OR mb.local_path LIKE ?1 ESCAPE '\')
          AND NOT EXISTS (
            SELECT 1 FROM entity_imagez ei
            JOIN media_blobz wmb ON wmb.id = ei.media_blob_id
            WHERE ei.entity_type = 'video' AND ei.entity_id = v.id
              AND wmb.blob_type = 'waveform' AND wmb.deleted_at IS NULL
          )
        LIMIT ?2
        "#,
        like_prefix,
        limit
    )
    .fetch_all(&pool)
    .await;

    let rows = match candidates {
        Ok(rows) => rows,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to query video waveform candidates",
                vec![ErrorDetail::from(crate::error::GrimoireError::from(e))],
            )
        }
    };
    let more_remaining = rows.len() as i64 == limit;

    for row in rows {
        if !crate::video::importer::video_has_audio_stream(Path::new(&row.local_path), &config)
            .await
        {
            continue;
        }
        if dry_run {
            result.videos_waveforms_backfilled += 1;
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
                "video_waveform_backfill_failed",
                "Video Waveform Backfill Failed",
                format!("video {}: {}", row.video_id, waveform.message),
            ));
            continue;
        };
        let link = crate::video::add_entity_image(
            VideoEntityType::Video,
            &row.video_id,
            &blob_id,
            Some(false),
            BlobType::Waveform,
            created_by_string.as_deref(),
        )
        .await;
        if link.success {
            result.videos_waveforms_backfilled += 1;
        } else {
            result.errors.push(ErrorDetail::new(
                "video_waveform_link_failed",
                "Video Waveform Link Failed",
                format!("video {}: {}", row.video_id, link.message),
            ));
        }
    }

    GrimoireResponse::success(
        "video waveform batch complete",
        WaveformBatchOutcome {
            result,
            more_remaining,
        },
    )
}

/// backfill a poster/thumbnail (via ffmpeg frame grab) for up to `limit`
/// videos missing one (`videoz.poster_blob_id IS NULL`). `scan_directory`
/// and `created_by` mirror `repair_waveforms_batch`'s same-named
/// parameters.
pub async fn repair_video_thumbnails_batch(
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
    let created_by_string = created_by.as_ref().map(|(id, _)| id.clone());

    let like_prefix = scan_directory_pattern(scan_directory);

    let candidates = sqlx::query!(
        r#"
        SELECT v.id as "video_id!", v.media_blob_id as "media_blob_id!", mb.local_path as "local_path!",
               v.duration_seconds
        FROM videoz v
        JOIN media_blobz mb ON mb.id = v.media_blob_id
        WHERE v.deleted_at IS NULL
          AND v.poster_blob_id IS NULL
          AND mb.local_path IS NOT NULL
          AND (?1 IS NULL OR mb.local_path LIKE ?1 ESCAPE '\')
        LIMIT ?2
        "#,
        like_prefix,
        limit
    )
    .fetch_all(&pool)
    .await;

    let rows = match candidates {
        Ok(rows) => rows,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to query video thumbnail candidates",
                vec![ErrorDetail::from(crate::error::GrimoireError::from(e))],
            )
        }
    };
    let more_remaining = rows.len() as i64 == limit;

    for row in rows {
        if dry_run {
            result.videos_thumbnails_backfilled += 1;
            continue;
        }
        let poster = crate::video::importer::extract_video_poster(
            &row.media_blob_id,
            Path::new(&row.local_path),
            row.duration_seconds,
            &config,
            created_by_string.clone(),
        )
        .await;
        let blob_id = match poster {
            Ok(id) => id,
            Err(e) => {
                result.errors.push(ErrorDetail::new(
                    "video_thumbnail_backfill_failed",
                    "Video Thumbnail Backfill Failed",
                    format!("video {}: {}", row.video_id, e),
                ));
                continue;
            }
        };
        let update = crate::video::update_video(crate::video::UpdateVideoRequest {
            video_id: row.video_id.clone(),
            series_id: None,
            season_id: None,
            episode_number: None,
            content_type: None,
            title: None,
            description: None,
            poster_blob_id: Some(blob_id.clone()),
            duration_seconds: None,
            release_date: None,
            updated_by: created_by_string.clone(),
            clear_series_id: false,
            clear_season_id: false,
            parent_video_id: None,
            clear_parent_video_id: false,
        })
        .await;
        if !update.success {
            result.errors.push(ErrorDetail::new(
                "video_thumbnail_link_failed",
                "Video Thumbnail Link Failed",
                format!("video {}: {}", row.video_id, update.message),
            ));
            continue;
        }
        let image_resp = crate::video::add_entity_image(
            VideoEntityType::Video,
            &row.video_id,
            &blob_id,
            Some(true),
            BlobType::Thumbnail,
            created_by_string.as_deref(),
        )
        .await;
        if image_resp.success {
            result.videos_thumbnails_backfilled += 1;
        } else {
            result.errors.push(ErrorDetail::new(
                "video_thumbnail_link_failed",
                "Video Thumbnail Link Failed",
                format!("video {}: {}", row.video_id, image_resp.message),
            ));
        }
    }

    GrimoireResponse::success(
        "video thumbnail batch complete",
        WaveformBatchOutcome {
            result,
            more_remaining,
        },
    )
}
