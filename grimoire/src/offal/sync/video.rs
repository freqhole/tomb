//! video sync: the video counterpart of `song::sync_song_by_blake3`.
//!
//! pulls the video blob from the source peer via iroh-blobs, then writes the
//! video row plus its series/season shell and poster images, so a charnel
//! desktop app can mirror a remote video into its own library.

use serde_json::Value as JsonValue;

use crate::error::{ErrorDetail, GrimoireError, GrimoireResult};
use crate::media_blobz::BlobType;
use crate::media_domain::MediaDomain;
use crate::offal::caller::Caller;
use crate::offal::upload::pull_audio_blob_to_local_storage;
use crate::response::GrimoireResponse;

use super::images::resolve_sync_image_ref;
use super::models::{SyncImageRef, SyncVideoByBlake3Request, SyncVideoByBlake3Response};

/// sync a video from a source remote via iroh-blobs pull.
///
/// path: POST /api/sync/video-by-blake3
pub async fn sync_video_by_blake3(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: SyncVideoByBlake3Request = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!(
                "sync_video_by_blake3: bad request from {}: {}",
                caller.username,
                e
            );
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new(
                    "bad_request",
                    "bad request",
                    e.to_string(),
                )],
            );
        }
    };

    let short_blake3 = req.blake3[..16.min(req.blake3.len())].to_string();
    tracing::info!(
        "sync_video_by_blake3: START from {} -- title=\"{}\" blake3={} series={:?} season={:?} source_node={}",
        caller.username,
        req.title,
        short_blake3,
        req.series_title,
        req.season_number,
        &req.source_node_id[..16.min(req.source_node_id.len())],
    );

    // already have this exact file? reuse the existing video row rather than
    // re-pulling, but still reconcile series/season/images below.
    let existing_blob = crate::media_blobz::get_media_blob_by_blake3(&req.blake3)
        .await
        .ok();
    let existing_video = match &existing_blob {
        Some(blob) => find_video_id_by_media_blob_id(&blob.id)
            .await
            .unwrap_or(None),
        None => None,
    };

    let (video_id, media_blob_id, file_path, existing) = match (existing_video, &existing_blob) {
        (Some(video_id), Some(blob)) if blob.local_path.is_some() => {
            tracing::info!(
                "sync_video_by_blake3: video {} already exists for blake3 {}",
                video_id,
                short_blake3
            );
            (
                video_id,
                blob.id.clone(),
                blob.local_path.clone().unwrap_or_default(),
                true,
            )
        }
        _ => {
            let pulled = match pull_audio_blob_to_local_storage(
                &req.source_node_id,
                &req.blake3,
                req.sha256.as_deref(),
                req.size,
                &req.filename,
                caller,
                MediaDomain::Video,
            )
            .await
            {
                Ok(r) => r,
                Err(e) => {
                    tracing::error!(
                        "sync_video_by_blake3: FAIL pull for title=\"{}\" blake3={}: {:?}",
                        req.title,
                        short_blake3,
                        e,
                    );
                    return e.into_grimoire_response();
                }
            };
            tracing::info!(
                "sync_video_by_blake3: pulled blob {} ({} bytes) -> media_blob {} at {}",
                short_blake3,
                pulled.size,
                pulled.blob.id,
                pulled.local_path.display(),
            );

            // a soft-deleted row for this blob would make create_video fail on
            // the unique constraint; reuse it the same way a fresh pull would.
            let (series_id, season_id) =
                resolve_sync_series_season(&req, Some(caller.user_id.clone())).await;

            let create_resp = crate::video::create_video(crate::video::CreateVideoRequest {
                series_id: series_id.clone(),
                season_id: season_id.clone(),
                episode_number: req.episode_number,
                content_type: req.content_type.clone(),
                title: req.title.clone(),
                description: req.description.clone(),
                media_blob_id: pulled.blob.id.clone(),
                poster_blob_id: None,
                duration_seconds: req.duration_seconds,
                release_date: req.release_date.clone(),
                created_by: Some(caller.user_id.clone()),
            })
            .await;

            let Some(video) = create_resp.data else {
                tracing::error!(
                    "sync_video_by_blake3: create failed for title=\"{}\": {}",
                    req.title,
                    create_resp.message
                );
                return GrimoireResponse::failure("failed to create video", create_resp.errors);
            };

            (
                video.id,
                pulled.blob.id,
                pulled.local_path.to_string_lossy().to_string(),
                false,
            )
        }
    };

    // resolve series/season for the existing-row path too, so a video that
    // arrived earlier as a loose file gets filed under its show on re-sync.
    let (series_id, season_id) = if existing {
        let resolved = resolve_sync_series_season(&req, Some(caller.user_id.clone())).await;
        if resolved.0.is_some() {
            let update = crate::video::update_video(crate::video::UpdateVideoRequest {
                video_id: video_id.clone(),
                series_id: resolved.0.clone(),
                season_id: resolved.1.clone(),
                episode_number: req.episode_number,
                content_type: req.content_type.clone(),
                title: None,
                description: None,
                poster_blob_id: None,
                duration_seconds: None,
                release_date: None,
                updated_by: Some(caller.user_id.clone()),
                clear_series_id: false,
                clear_season_id: false,
            })
            .await;
            if !update.success {
                tracing::warn!(
                    "sync_video_by_blake3: failed to relink series/season for {}: {}",
                    video_id,
                    update.message
                );
            }
        }
        resolved
    } else {
        // already applied at create time - re-resolve is cheap and idempotent
        resolve_sync_series_season(&req, Some(caller.user_id.clone())).await
    };

    // images: video poster first (it also becomes videoz.poster_blob_id),
    // then series/season posters.
    let mut images_linked = 0i64;
    let mut missing_image_sha256s = Vec::new();

    let video_poster = link_sync_entity_images(
        crate::video::VideoEntityType::Video,
        &video_id,
        &req.video_images,
        &media_blob_id,
        caller,
        &mut images_linked,
        &mut missing_image_sha256s,
    )
    .await;

    if let Some(poster_blob_id) = video_poster {
        let update = crate::video::update_video(crate::video::UpdateVideoRequest {
            video_id: video_id.clone(),
            series_id: None,
            season_id: None,
            episode_number: None,
            content_type: None,
            title: None,
            description: None,
            poster_blob_id: Some(poster_blob_id),
            duration_seconds: None,
            release_date: None,
            updated_by: Some(caller.user_id.clone()),
            clear_series_id: false,
            clear_season_id: false,
        })
        .await;
        if !update.success {
            tracing::warn!(
                "sync_video_by_blake3: failed to set poster_blob_id on {}: {}",
                video_id,
                update.message
            );
        }
    }

    if let Some(series_id) = &series_id {
        link_sync_entity_images(
            crate::video::VideoEntityType::VideoSeries,
            series_id,
            &req.series_images,
            &media_blob_id,
            caller,
            &mut images_linked,
            &mut missing_image_sha256s,
        )
        .await;
    }
    if let Some(season_id) = &season_id {
        link_sync_entity_images(
            crate::video::VideoEntityType::VideoSeason,
            season_id,
            &req.season_images,
            &media_blob_id,
            caller,
            &mut images_linked,
            &mut missing_image_sha256s,
        )
        .await;
    }

    tracing::info!(
        "sync_video_by_blake3: DONE video={} existing={} series={:?} season={:?} images_linked={}",
        video_id,
        existing,
        series_id,
        season_id,
        images_linked,
    );

    let response = SyncVideoByBlake3Response {
        video_id,
        media_blob_id,
        file_path,
        blake3: req.blake3.clone(),
        series_id,
        season_id,
        existing,
        images_linked,
        missing_image_sha256s,
    };
    GrimoireResponse::success(
        if existing {
            "video already existed"
        } else {
            "video synced"
        },
        serde_json::to_value(response).unwrap_or_default(),
    )
}

/// find-or-create the series (and season) named in a video sync request.
/// a season without a series is meaningless, so season resolution only
/// happens once a series exists.
async fn resolve_sync_series_season(
    req: &SyncVideoByBlake3Request,
    created_by: Option<String>,
) -> (Option<String>, Option<String>) {
    let Some(series_title) = req.series_title.as_deref().filter(|t| !t.is_empty()) else {
        return (None, None);
    };

    let series_resp = crate::video::find_or_create_video_series(series_title, created_by).await;
    let Some(series) = series_resp.data else {
        tracing::warn!(
            "sync_video_by_blake3: could not resolve series \"{}\": {}",
            series_title,
            series_resp.message
        );
        return (None, None);
    };

    // fill in a description the source had but the local row doesn't
    if let Some(description) = req.series_description.as_deref().filter(|d| !d.is_empty()) {
        if series.description.as_deref().unwrap_or("").is_empty() {
            let _ = crate::video::update_video_series(crate::video::UpdateVideoSeriesRequest {
                series_id: series.id.clone(),
                title: None,
                description: Some(description.to_string()),
                poster_blob_id: None,
                updated_by: None,
            })
            .await;
        }
    }

    let Some(season_number) = req.season_number else {
        return (Some(series.id), None);
    };

    let season_resp = crate::video::find_or_create_video_season(
        &series.id,
        season_number,
        req.season_title.clone(),
    )
    .await;
    match season_resp.data {
        Some(season) => (Some(series.id), Some(season.id)),
        None => {
            tracing::warn!(
                "sync_video_by_blake3: could not resolve season {} of \"{}\": {}",
                season_number,
                series_title,
                season_resp.message
            );
            (Some(series.id), None)
        }
    }
}

/// resolve + attach a set of `SyncImageRef`s to one video entity, returning
/// the blob id of whichever image was marked primary (the poster).
async fn link_sync_entity_images(
    entity_type: crate::video::VideoEntityType,
    entity_id: &str,
    images: &[SyncImageRef],
    parent_blob_id: &str,
    caller: &Caller,
    images_linked: &mut i64,
    missing_image_sha256s: &mut Vec<String>,
) -> Option<String> {
    let mut primary_blob_id = None;

    for img in images {
        let name_prefix = format!("{}-{}", entity_type.as_str(), entity_id);
        let resolved = match resolve_sync_image_ref(img, &name_prefix, Some(parent_blob_id)).await {
            Ok(Some(blob_id)) => blob_id,
            Ok(None) => {
                missing_image_sha256s.push(img.content_sha256.clone());
                continue;
            }
            Err(e) => {
                tracing::warn!(
                    "sync_video_by_blake3: image {} for {} failed: {}",
                    &img.content_sha256[..16.min(img.content_sha256.len())],
                    entity_id,
                    e
                );
                continue;
            }
        };

        let blob_type = match img.blob_type.as_deref() {
            Some("thumbnail") => BlobType::Thumbnail,
            Some("preview") => BlobType::Preview,
            _ => BlobType::Original,
        };
        let image_resp = crate::video::add_entity_image(
            entity_type,
            entity_id,
            &resolved,
            Some(img.is_primary),
            blob_type,
            Some(&caller.user_id),
        )
        .await;
        if image_resp.success {
            *images_linked += 1;
            if img.is_primary || primary_blob_id.is_none() {
                primary_blob_id = Some(resolved);
            }
        } else {
            tracing::warn!(
                "sync_video_by_blake3: failed to link image to {} {}: {}",
                entity_type.as_str(),
                entity_id,
                image_resp.message
            );
        }
    }

    primary_blob_id
}

/// existing (non-deleted) video for a media blob - the dedupe key for video
/// sync, mirroring `videoz.media_blob_id`'s unique constraint.
async fn find_video_id_by_media_blob_id(media_blob_id: &str) -> GrimoireResult<Option<String>> {
    let pool = crate::database::connect().await?;
    let id = sqlx::query_scalar!(
        "SELECT id FROM videoz WHERE media_blob_id = ? AND deleted_at IS NULL LIMIT 1",
        media_blob_id
    )
    .fetch_optional(&pool)
    .await
    .map_err(|e| GrimoireError::ProcessingFailed {
        message: format!("failed to check for existing video: {}", e),
    })?;
    Ok(id.flatten())
}
