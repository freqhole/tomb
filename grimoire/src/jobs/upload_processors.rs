//! Upload job processors
//!
//! Handles async processing for uploaded files:
//! - ConvertWebp: converts uploaded images to WebP format and optionally associates with entities
//! - ImportMusic: extracts metadata from uploaded audio files and creates Song/Album/Artist records

use crate::blob_data;
use crate::database;
use crate::error::GrimoireError;
use crate::jobs::{Job, JobError};
use serde_json::Value;
use tracing::{error, info};

/// Process image to WebP conversion job
///
/// Job parameters:
/// - blob_id: ID of the media blob containing the image data
/// - original_mime: original MIME type of the image
/// - associate_with (optional): { entity_type: "album"|"playlist"|"song"|"artist", entity_id: "..." }
///
/// Steps:
/// 1. Check if blob already has WebP data in blob_data table
/// 2. If not, get original image data and convert to WebP
/// 3. Store WebP data back to blob_data
/// 4. If associate_with is present, update the entity's thumbnail_blob_id field
pub async fn process_convert_webp_job(job: &Job) -> Result<Option<Value>, JobError> {
    info!("processing ConvertWebp job: {}", job.id);

    // Parse job parameters
    let params: serde_json::Value = job.parameters()?;
    let blob_id = params["blob_id"]
        .as_str()
        .ok_or_else(|| JobError::InvalidParameters {
            reason: "missing blob_id".to_string(),
        })?;
    let original_mime = params["original_mime"].as_str();
    let association = params.get("associate_with");

    info!(
        "ConvertWebp job: blob_id={}, original_mime={:?}",
        blob_id, original_mime
    );

    // Check if webp data already exists in blob_data table
    let exists_response = blob_data::blob_data_exists(blob_id).await;
    let already_converted = exists_response.success && exists_response.data.unwrap_or(false);

    if !already_converted {
        // Get original image data from blob_data
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

        // Convert to WebP (sync function, not async)
        let webp_data =
            blob_data::convert_to_webp(&image_data).map_err(|e| JobError::ProcessingFailed {
                reason: format!("webp conversion failed: {}", e),
            })?;

        // Store converted WebP data back to blob_data
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

    // Handle association if requested
    if let Some(assoc) = association {
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

        // Associate image with entity
        let update_result =
            associate_image_with_entity(entity_type, entity_id, blob_id, is_primary_hint).await;
        if let Err(e) = update_result {
            error!(
                "failed to associate blob with entity: type={}, id={}, error={}",
                entity_type, entity_id, e
            );
            // Don't fail the job - conversion succeeded, association is bonus
        } else {
            info!(
                "associated blob with entity: type={}, id={}, blob_id={}",
                entity_type, entity_id, blob_id
            );
        }
    }

    let result = serde_json::json!({
        "blob_id": blob_id,
        "converted": !already_converted,
        "associated": association.is_some(),
    });

    Ok(Some(result))
}

/// Associate image blob with entity using *_imagez tables
/// Associate image with entity using smart primary logic
///
/// Logic:
/// - First image for entity is ALWAYS primary (regardless of hint)
/// - Subsequent images use is_primary hint (default false)
async fn associate_image_with_entity(
    entity_type: &str,
    entity_id: &str,
    blob_id: &str,
    is_primary_hint: Option<bool>,
) -> Result<(), GrimoireError> {
    let pool = database::connect().await?;

    // Count existing images for this entity
    let existing_count = count_entity_images(entity_type, entity_id, &pool).await?;

    // Determine if this should be primary
    let is_primary = if existing_count == 0 {
        true // First image is ALWAYS primary
    } else {
        is_primary_hint.unwrap_or(false) // Use hint, default to false
    };

    match entity_type {
        "album" => {
            // Insert into album_imagez
            let is_primary_int = if is_primary { 1 } else { 0 };
            sqlx::query!(
                "INSERT INTO album_imagez (album_id, media_blob_id, is_primary)
                 VALUES (?, ?, ?)
                 ON CONFLICT(album_id, media_blob_id) DO UPDATE SET is_primary = excluded.is_primary",
                entity_id,
                blob_id,
                is_primary_int
            )
            .execute(&pool)
            .await?;
        }
        "playlist" => {
            // Insert into playlist_imagez
            let is_primary_int = if is_primary { 1 } else { 0 };
            sqlx::query!(
                "INSERT INTO playlist_imagez (playlist_id, media_blob_id, is_primary)
                 VALUES (?, ?, ?)
                 ON CONFLICT(playlist_id, media_blob_id) DO UPDATE SET is_primary = excluded.is_primary",
                entity_id,
                blob_id,
                is_primary_int
            )
            .execute(&pool)
            .await?;

            // If primary, also update thumbnail_blob_id column
            if is_primary {
                sqlx::query!(
                    "UPDATE playlistz SET thumbnail_blob_id = ? WHERE id = ?",
                    blob_id,
                    entity_id
                )
                .execute(&pool)
                .await?;
            }
        }
        "song" => {
            // Insert into song_imagez
            let is_primary_int = if is_primary { 1 } else { 0 };
            sqlx::query!(
                "INSERT INTO song_imagez (song_id, media_blob_id, is_primary)
                 VALUES (?, ?, ?)
                 ON CONFLICT(song_id, media_blob_id) DO UPDATE SET is_primary = excluded.is_primary",
                entity_id,
                blob_id,
                is_primary_int
            )
            .execute(&pool)
            .await?;

            // If primary, also update thumbnail_blob_id column
            if is_primary {
                sqlx::query!(
                    "UPDATE songz SET thumbnail_blob_id = ? WHERE id = ?",
                    blob_id,
                    entity_id
                )
                .execute(&pool)
                .await?;
            }
        }
        "artist" => {
            // Insert into artist_imagez
            let is_primary_int = if is_primary { 1 } else { 0 };
            sqlx::query!(
                "INSERT INTO artist_imagez (artist_id, media_blob_id, is_primary)
                 VALUES (?, ?, ?)
                 ON CONFLICT(artist_id, media_blob_id) DO UPDATE SET is_primary = excluded.is_primary",
                entity_id,
                blob_id,
                is_primary_int
            )
            .execute(&pool)
            .await?;
        }
        _ => {
            return Err(GrimoireError::ProcessingFailed {
                message: format!("unknown entity type: {}", entity_type),
            });
        }
    }

    Ok(())
}

/// Count existing images for an entity
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

/// Process music import job
///
/// Job parameters:
/// - blob_id: ID of the media blob
/// - local_path: filesystem path to the audio file
/// - mime_type: MIME type of the audio file
/// - filename: original filename
/// - user_hints (optional): { artist, album, title, track_number, year, genre, etc. }
///
/// Steps:
/// 1. Update media blob with local_path
/// 2. Extract metadata from audio file using scanner
/// 3. Create/find Artist record
/// 4. Create/find Album record
/// 5. Create Song record
/// 6. Generate thumbnail and waveform (optional)
pub async fn process_import_music_job(job: &Job) -> Result<Option<Value>, JobError> {
    info!("processing ImportMusic job: {}", job.id);

    // Parse job parameters
    let params: serde_json::Value = job.parameters()?;
    let blob_id = params["blob_id"]
        .as_str()
        .ok_or_else(|| JobError::InvalidParameters {
            reason: "missing blob_id".to_string(),
        })?;
    let local_path = params["local_path"]
        .as_str()
        .ok_or_else(|| JobError::InvalidParameters {
            reason: "missing local_path".to_string(),
        })?;

    info!(
        "ImportMusic job: blob_id={}, local_path={}",
        blob_id, local_path
    );

    // TODO: Implement actual music import logic
    // This requires:
    // 1. Update media_blobz.local_path
    // 2. Use grimoire::music::scanner to extract metadata from file
    // 3. Use grimoire::music::crud::create_song_with_artist_and_album or similar
    // 4. Optionally generate thumbnail/waveform

    // For now, return error indicating not implemented
    Err(JobError::ProcessingFailed {
        reason: "ImportMusic job type not yet fully implemented - music import logic pending"
            .to_string(),
    })
}
