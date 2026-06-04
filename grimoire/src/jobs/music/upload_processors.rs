//! upload job processors
//!
//! handles async processing for uploaded files:
//! - ConvertWebp: convert uploaded images to WebP format and optionally associates with entities
//! - ImportMusic: extract metadata from uploaded audio files and creates Song/Album/Artist records

use crate::analytics::{record_event, MediaEvent, MediaEventType};
use crate::blob_data;
use crate::config;
use crate::database;
use crate::error::GrimoireError;
use crate::jobs::{Job, JobError};
use crate::media_blobz::update_blob_local_path;
use crate::music::analytics::feed_events::upsert_album_feed_event;
use crate::music::entities::albums::add_album_image;
use crate::music::entities::artists::add_artist_image;
use crate::music::entities::playlists::add_playlist_image;
use crate::music::entities::songs::add_song_image;
use crate::music::scanner::extract_and_import;
use serde_json::{json, Value};
use std::path::Path;
use tracing::{debug, error, info, warn};

/// process image to WebP conversion job
///
/// job parameters:
/// - blob_id: ID of the media blob containing the image data
/// - original_mime: original MIME type of the image
/// - associate_with (optional): { entity_type: "album"|"playlist"|"song"|"artist", entity_id: "..." }
///
/// steps:
/// 1. check if blob already has WebP data in blob_data table
/// 2. if not, get original image data and convert to WebP
/// 3. store WebP data back to blob_data
/// 4. if associate_with is present, insert images into entity's *_imagez junction table
pub async fn process_convert_webp_job(job: &Job) -> Result<Option<Value>, JobError> {
    info!("processing ConvertWebp job: {}", job.id);

    // parse job parameters
    let params: serde_json::Value = job.parameters()?;
    let blob_id = params["blob_id"]
        .as_str()
        .ok_or_else(|| JobError::InvalidParameters {
            reason: "missing blob_id".to_string(),
        })?;
    let original_mime = params["original_mime"].as_str();
    let association = params.get("associate_with");
    // upstream may pass a blob_type hint so non-image originals (e.g. waveforms)
    // skip the lossy webp re-encode and thumbnail generation while still being
    // associated with their entity.
    let blob_type_hint = params["blob_type"].as_str().unwrap_or("original");
    let is_original = blob_type_hint.eq_ignore_ascii_case("original");

    info!(
        "ConvertWebp job: blob_id={}, original_mime={:?}, blob_type={}",
        blob_id, original_mime, blob_type_hint
    );

    if is_original {
        // check if webp data already exists in blob_data table
        let exists_response = blob_data::blob_data_exists(blob_id).await;
        let already_converted = exists_response.success && exists_response.data.unwrap_or(false);

        if !already_converted {
            crate::jobs::job_events::emit_stage_from_job(
                job,
                "converting",
                Some("converting to webp"),
            );
            // get original image data from blob_data
            let data_response = blob_data::get_blob_data(blob_id).await;
            if !data_response.success {
                return Err(JobError::ProcessingFailed {
                    reason: format!("failed to get blob data: {}", data_response.message),
                });
            }

            let image_data = data_response
                .data
                .ok_or_else(|| JobError::ProcessingFailed {
                    reason: "no blob data found".to_string(),
                })?;

            // convert to WebP (sync function, not async)
            let webp_data = blob_data::convert_to_webp(&image_data).map_err(|e| {
                JobError::ProcessingFailed {
                    reason: format!("webp conversion failed: {}", e),
                }
            })?;

            // store converted WebP data back to blob_data
            let store_response = blob_data::store_blob_data(blob_id, webp_data).await;
            if !store_response.success {
                return Err(JobError::ProcessingFailed {
                    reason: format!("failed to store webp data: {}", store_response.message),
                });
            }

            info!("converted image to webp: blob_id={}", blob_id);
        } else {
            info!("image already converted to webp: blob_id={}", blob_id);
        }

        // generate thumbnails (for pre-generation mode, not on-demand)
        // this ensures thumbnails exist when on_demand is disabled
        crate::jobs::job_events::emit_stage_from_job(
            job,
            "thumbnails",
            Some("generating thumbnails"),
        );
        let thumb_result =
            blob_data::generate_sized_thumbnails(blob_id, job.created_by.clone()).await;
        if thumb_result.success {
            if let Some(thumbnails) = thumb_result.data {
                info!(
                    "generated {} thumbnails for blob_id={}",
                    thumbnails.len(),
                    blob_id
                );
            }
        } else {
            warn!(
                "failed to generate thumbnails for blob_id={}: {}",
                blob_id, thumb_result.message
            );
        }
    } else {
        info!(
            "skipping webp conversion + thumbnail generation for non-original blob (blob_type={})",
            blob_type_hint
        );
    }

    // handle association if requested
    if let Some(assoc) = association {
        crate::jobs::job_events::emit_stage_from_job(
            job,
            "associating",
            Some("linking image to entity"),
        );
        let entity_type =
            assoc["entity_type"]
                .as_str()
                .ok_or_else(|| JobError::InvalidParameters {
                    reason: "missing entity_type in associate_with".to_string(),
                })?;
        let entity_id = assoc["entity_id"]
            .as_str()
            .ok_or_else(|| JobError::InvalidParameters {
                reason: "missing entity_id in associate_with".to_string(),
            })?;
        let is_primary_hint = assoc["is_primary"].as_bool();

        // associate image with entity, passing through user who initiated the job
        associate_image_with_entity(
            entity_type,
            entity_id,
            blob_id,
            is_primary_hint,
            job.created_by.as_deref(),
        )
        .await
        .map_err(|e| {
            error!(
                "failed to associate blob with entity: type={}, id={}, error={}",
                entity_type, entity_id, e
            );
            JobError::ProcessingFailed {
                reason: format!("failed to associate image: {}", e),
            }
        })?;

        info!(
            "associated blob with entity: type={}, id={}, blob_id={}",
            entity_type, entity_id, blob_id
        );
    }

    let result = serde_json::json!({
        "blob_id": blob_id,
        "converted": is_original,
        "blob_type": blob_type_hint,
        "associated": association.is_some(),
    });

    Ok(Some(result))
}

/// associate image blob with entity using *_imagez tables
/// associate image with entity using smart primary logic
///
/// logic:
/// - first image for entity is ALWAYS primary (regardless of hint)
/// - subsequent images use is_primary hint (default false)
/// - if is_primary is true for subsequent images, unset old primary
/// - if user_id is provided, creates a feed event for the image addition
/// - also refreshes the entity's existing feed event with updated images
async fn associate_image_with_entity(
    entity_type: &str,
    entity_id: &str,
    blob_id: &str,
    is_primary_hint: Option<bool>,
    user_id: Option<&str>,
) -> Result<(), GrimoireError> {
    let pool = database::connect().await?;

    // count existing images for this entity
    let existing_count = count_entity_images(entity_type, entity_id, &pool).await?;

    // determine if this should be primary
    let is_primary = if existing_count == 0 {
        true // first image is ALWAYS primary
    } else {
        is_primary_hint.unwrap_or(false) // use hint, default to false
    };

    // look up username if user_id provided
    let user_info: Option<(String, String)> = if let Some(uid) = user_id {
        let username =
            sqlx::query_scalar!(r#"SELECT username FROM user_accountz WHERE id = ?"#, uid)
                .fetch_optional(&pool)
                .await?;
        username.map(|uname| (uid.to_string(), uname))
    } else {
        None
    };

    // prepare created_by tuple for add_*_image functions
    let created_by = user_info.as_ref().map(|(u, n)| (u.as_str(), n.as_str()));

    let response = match entity_type {
        "album" => add_album_image(entity_id, blob_id, is_primary, created_by).await,
        "playlist" => add_playlist_image(entity_id, blob_id, is_primary, created_by).await,
        "song" => add_song_image(entity_id, blob_id, is_primary, created_by).await,
        "artist" => add_artist_image(entity_id, blob_id, is_primary, created_by).await,
        _ => {
            return Err(GrimoireError::ProcessingFailed {
                message: format!("unknown entity type: {}", entity_type),
            });
        }
    };

    if !response.success {
        return Err(GrimoireError::ProcessingFailed {
            message: format!("failed to add image: {}", response.message),
        });
    }

    // note: add_*_image functions already create image feed events via create_image_feed_event
    // no need to call upsert_*_feed_event here - that would create duplicate "new album" events

    Ok(())
}

/// count existing images for an entity
async fn count_entity_images(
    entity_type: &str,
    entity_id: &str,
    pool: &sqlx::SqlitePool,
) -> Result<i64, GrimoireError> {
    let count = match entity_type {
        "album" => {
            sqlx::query_scalar!(
                "SELECT COUNT(*) as count FROM album_imagez WHERE album_id = ?",
                entity_id
            )
            .fetch_one(pool)
            .await?
        }
        "playlist" => {
            sqlx::query_scalar!(
                "SELECT COUNT(*) as count FROM playlist_imagez WHERE playlist_id = ?",
                entity_id
            )
            .fetch_one(pool)
            .await?
        }
        "song" => {
            sqlx::query_scalar!(
                "SELECT COUNT(*) as count FROM song_imagez WHERE song_id = ?",
                entity_id
            )
            .fetch_one(pool)
            .await?
        }
        "artist" => {
            sqlx::query_scalar!(
                "SELECT COUNT(*) as count FROM artist_imagez WHERE artist_id = ?",
                entity_id
            )
            .fetch_one(pool)
            .await?
        }
        _ => 0,
    };

    Ok(count)
}

/// process music import job
///
/// job parameters:
/// - blob_id: ID of the media blob
/// - local_path: filesystem path to the audio file
/// - mime_type: MIME type of the audio file
/// - filename: original filename
/// - user_hints (optional): { artist, album, title, track_number, year, genre, etc. }
///
/// steps:
/// 1. update media blob with local_path
/// 2. extract metadata from audio file using scanner
/// 3. create/find Artist record
/// 4. create/find Album record
/// 5. create Song record
/// 6. generate thumbnail and waveform (optional)
pub async fn process_import_music_job(job: &Job) -> Result<Option<Value>, JobError> {
    info!("processing ImportMusic job: {}", job.id);

    // parse job parameters
    let params: serde_json::Value = job.parameters()?;
    let blob_id = params["blob_id"]
        .as_str()
        .ok_or_else(|| JobError::InvalidParameters {
            reason: "missing blob_id".to_string(),
        })?
        .to_string();

    let local_path_str =
        params["local_path"]
            .as_str()
            .ok_or_else(|| JobError::InvalidParameters {
                reason: "missing local_path".to_string(),
            })?;

    let filename = params["filename"]
        .as_str()
        .map(|s| s.to_string())
        .unwrap_or_else(|| "unknown".to_string());

    info!(
        "importing music: blob_id={}, local_path={}, filename={}",
        blob_id, local_path_str, filename
    );

    // verify file exists on disk
    let file_path = Path::new(local_path_str);
    if !file_path.exists() {
        return Err(JobError::ProcessingFailed {
            reason: format!("file not found at path: {}", local_path_str),
        });
    }

    // update blob with local_path (in case it wasn't set during upload)
    match update_blob_local_path(&blob_id, local_path_str, Some("job_processor".to_string())).await
    {
        Ok(_) => {
            info!(
                "updated blob {} with local_path: {}",
                blob_id, local_path_str
            );
        }
        Err(e) => {
            // log warning but continue - path might already be set
            info!(
                "note: could not update blob local_path (may already be set): {}",
                e
            );
        }
    }

    // extract metadata and import song using scanner
    // this handles all the heavy lifting:
    // - metadata extraction with lofty
    // - artist/album/genre creation or lookup
    // - song creation with relationships
    // - falls back to basic import if metadata extraction fails
    // pass original filename so fallback parsing works (file is stored with blob_id as name)
    crate::jobs::job_events::emit_stage_from_job(
        job,
        "extracting",
        Some(&format!("extracting metadata: {}", filename)),
    );
    let import_result =
        extract_and_import(&blob_id, file_path, job.created_by.clone(), Some(&filename)).await?;

    info!(
        "successfully imported song: song_id={}, artist_id={:?}, album_id={:?}, metadata_extracted={}",
        import_result.song_id,
        import_result.artist_id,
        import_result.album_id,
        import_result.metadata_extracted
    );

    // create/update feed event for album (so uploaded music shows in feed)
    if let Some(album_id) = &import_result.album_id {
        let aid = album_id.clone();
        let uid = job.created_by.clone().unwrap_or_default();
        tokio::spawn(async move {
            // lookup username if we have a user_id
            let username = if !uid.is_empty() {
                if let Ok(pool) = database::connect().await {
                    sqlx::query_scalar!("SELECT username FROM user_accountz WHERE id = ?", uid)
                        .fetch_optional(&pool)
                        .await
                        .ok()
                        .flatten()
                        .unwrap_or_default()
                } else {
                    String::new()
                }
            } else {
                String::new()
            };
            let _ = upsert_album_feed_event(&aid, &uid, &username, 1).await;
        });
    }

    // record analytics event for import (best-effort)
    let event_data = json!({
        "source": "upload",
        "filename": filename,
        "metadata_extracted": import_result.metadata_extracted,
    });

    let media_event =
        MediaEvent::new(blob_id.clone(), MediaEventType::Add).with_event_data(event_data);

    if let Err(e) = record_event(&media_event).await {
        info!("note: failed to record analytics event: {}", e);
    }

    // generate waveform for uploaded audio
    crate::jobs::job_events::emit_stage_from_job(job, "waveform", Some("generating waveform"));
    let cfg = config::get_config();
    let mut waveform_generated = false;
    match blob_data::create_audio_waveform_blob(
        &blob_id,
        local_path_str,
        &cfg,
        job.created_by.clone(),
    )
    .await
    {
        response if response.success => {
            if let Some(waveform_blob_id) = response.data {
                debug!("waveform generated as blob: {}", waveform_blob_id);
                // link waveform to song in song_imagez table
                let pool = match database::connect().await {
                    Ok(p) => p,
                    Err(e) => {
                        warn!("failed to connect to database for waveform linking: {}", e);
                        // don't fail the job, waveform is optional
                        return Ok(Some(json!({
                            "blob_id": blob_id,
                            "song_id": import_result.song_id,
                            "artist_id": import_result.artist_id,
                            "album_id": import_result.album_id,
                            "metadata_extracted": import_result.metadata_extracted,
                            "waveform_generated": false,
                            "message": "music imported but waveform linking failed"
                        })));
                    }
                };
                if let Err(e) = sqlx::query!(
                    r#"INSERT OR IGNORE INTO song_imagez (song_id, media_blob_id, is_primary) VALUES (?, ?, 0)"#,
                    import_result.song_id,
                    waveform_blob_id
                )
                .execute(&pool)
                .await
                {
                    warn!("failed to link waveform to song: {}", e);
                } else {
                    debug!("linked waveform {} to song {}", waveform_blob_id, import_result.song_id);
                    waveform_generated = true;
                }
            }
        }
        response => {
            let error_msg = if !response.errors.is_empty() {
                response.errors[0].detail.clone()
            } else {
                response.message
            };
            warn!("waveform generation failed: {}", error_msg);
        }
    }

    // return job result with created entity IDs
    Ok(Some(json!({
        "blob_id": blob_id,
        "song_id": import_result.song_id,
        "artist_id": import_result.artist_id,
        "album_id": import_result.album_id,
        "metadata_extracted": import_result.metadata_extracted,
        "waveform_generated": waveform_generated,
        "message": if import_result.metadata_extracted {
            "music imported successfully with metadata"
        } else {
            "music imported with basic metadata (extraction failed)"
        }
    })))
}
