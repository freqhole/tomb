//! audio file processing job processor
//!
//! imports audio files by creating media blobz, extracting metadata,
//! creating song/artist/album records, and generating thumbnails/waveforms

use super::models::{ProcessFileParams, ProcessFileResult};
use crate::blob_data;
use crate::config;
use crate::database;
use crate::jobs::models::{Job, JobError};
use crate::music::crud::create_or_update;
use crate::music::scanner;
use crate::GrimoireResponse;
use serde_json::Value;
use std::fs;
use std::path::Path;
use tracing::{debug, info, warn};

/// process audio file import job - extract metadata, create song record, generate assets
pub async fn process_file_job(job: &Job) -> Result<Option<Value>, JobError> {
    let job_start = std::time::Instant::now();

    // timing tracking
    #[allow(unused_assignments)]
    let mut time_sha256 = std::time::Duration::ZERO;
    #[allow(unused_assignments)]
    let mut time_metadata = std::time::Duration::ZERO;
    #[allow(unused_assignments)]
    let mut time_images = std::time::Duration::ZERO;
    #[allow(unused_assignments)]
    let mut time_waveform = std::time::Duration::ZERO;
    #[allow(unused_assignments)]
    let mut time_db_updates = std::time::Duration::ZERO;

    // get config
    let config = config::get_config();

    // parse job parameters
    let params: ProcessFileParams = match serde_json::from_str(&job.parameters) {
        Ok(p) => p,
        Err(e) => {
            return Err(JobError::ProcessingFailed {
                reason: format!("invalid parameters: {}", e),
            })
        }
    };

    let file_path = Path::new(&params.file_path);

    // verify file exists
    if !file_path.exists() {
        return Err(JobError::ProcessingFailed {
            reason: format!("file does not exist: {}", params.file_path),
        });
    }

    info!("processing file: {}", params.file_path);

    // read file metadata
    let metadata = match fs::metadata(file_path) {
        Ok(m) => m,
        Err(e) => {
            return Err(JobError::ProcessingFailed {
                reason: format!("failed to read file metadata: {}", e),
            })
        }
    };

    let file_size = metadata.len();
    debug!("file size: {} bytes", file_size);

    // get file modified time
    let file_modified_at = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    // step 1: create media blob in database (includes SHA256 hashing)
    let step_start = std::time::Instant::now();
    let media_blob_id = match blob_data::create_media_blob_from_file(
        &params.file_path,
        file_size,
        file_modified_at,
        job.created_by.clone(),
    )
    .await
    {
        response if response.success => match response.data {
            Some(id) => id,
            None => {
                return Err(JobError::ProcessingFailed {
                    reason: "failed to create media blob: no data returned".to_string(),
                })
            }
        },
        response => {
            let error_msg = if !response.errors.is_empty() {
                response.errors[0].detail.clone()
            } else {
                response.message
            };
            return Err(JobError::ProcessingFailed {
                reason: format!("failed to create media blob: {}", error_msg),
            });
        }
    };
    time_sha256 = step_start.elapsed();
    debug!("created media blob: {}", media_blob_id);

    // step 2: import audio file (extracts metadata and creates song)
    let mut song_id = None;
    let mut artist_id = None;
    let mut album_id = None;
    let mut metadata_extracted = false;
    let mut is_duplicate = false;

    if params.extract_metadata {
        let step_start = std::time::Instant::now();
        match scanner::import_audio_file(&media_blob_id, file_path, job.created_by.clone()).await {
            GrimoireResponse {
                success: true,
                data: Some(import_result),
                ..
            } => {
                song_id = Some(import_result.song_id);
                artist_id = import_result.artist_id;
                album_id = import_result.album_id.clone();
                metadata_extracted = import_result.metadata_extracted;
                time_metadata = step_start.elapsed();
                debug!("metadata extracted successfully");

                // if this file came from a fetch job, add the source URL to the album
                if let (Some(source_url), Some(aid)) = (&params.source_url, &import_result.album_id)
                {
                    match create_or_update::add_entity_url(
                        "album",
                        aid,
                        Some("source".to_string()),
                        source_url,
                    )
                    .await
                    {
                        Ok(Some(url_id)) => {
                            debug!("added source URL to album {}: {}", aid, url_id);
                        }
                        Ok(None) => {
                            debug!("source URL already exists for album {}", aid);
                        }
                        Err(e) => {
                            warn!("failed to add source URL to album {}: {}", aid, e);
                        }
                    }
                }
            }
            response => {
                let error_msg = if !response.errors.is_empty() {
                    response.errors[0].detail.clone()
                } else {
                    response.message
                };

                // check if this is a duplicate (skip expensive image/waveform processing)
                // check both error_type and detail message
                let is_dup = response.errors.iter().any(|e| {
                    e.error_type == "duplicate_song"
                        || e.detail.to_lowercase().contains("duplicate")
                        || e.detail.contains("already exists")
                });

                if is_dup {
                    is_duplicate = true;
                    time_metadata = step_start.elapsed();
                    info!("duplicate detected, skipping image and waveform generation");
                } else {
                    warn!("metadata extraction failed: {}", error_msg);
                }
            }
        }
    }

    // skip expensive processing if duplicate detected
    if is_duplicate {
        let result = ProcessFileResult {
            media_blob_id,
            song_id,
            artist_id,
            album_id,
            metadata_extracted: false,
            thumbnail_generated: false,
            waveform_generated: false,
        };

        let job_total = job_start.elapsed();
        let total_ms = job_total.as_millis() as f64;

        info!(
            "file processing complete (duplicate skipped): blob={} | total={:.1}s | sha256={:.1}s ({:.0}%) | metadata={:.1}s ({:.0}%)",
            result.media_blob_id,
            total_ms / 1000.0,
            time_sha256.as_millis() as f64 / 1000.0,
            (time_sha256.as_millis() as f64 / total_ms) * 100.0,
            time_metadata.as_millis() as f64 / 1000.0,
            (time_metadata.as_millis() as f64 / total_ms) * 100.0,
        );

        return Ok(Some(serde_json::to_value(result).map_err(|e| {
            JobError::ProcessingFailed {
                reason: format!("failed to serialize result: {}", e),
            }
        })?));
    }

    // step 3: collect all images (embedded art + directory images) if requested
    let mut thumbnail_blob_id_opt = None;
    let mut images_collected = false;

    if params.generate_thumbnail {
        let step_start = std::time::Instant::now();
        match blob_data::collect_song_images(
            &media_blob_id,
            &params.file_path,
            &config,
            job.session_id.as_deref(),
            job.created_by.clone(),
        )
        .await
        {
            response if response.success => {
                if let Some(collected) = response.data {
                    // determine primary image: embedded art first, then first directory image
                    let primary_blob_id: Option<String> = collected
                        .embedded_art_blob_id
                        .clone()
                        .or_else(|| collected.directory_image_blob_ids.first().cloned());

                    if let Some(primary_id) = &primary_blob_id {
                        thumbnail_blob_id_opt = Some(primary_id.clone());
                        debug!("primary thumbnail blob: {}", primary_id);
                    }

                    // insert images into song_imagez table if song was created
                    if let Some(sid) = &song_id {
                        let pool = match database::connect().await {
                            Ok(p) => p,
                            Err(e) => {
                                warn!("failed to connect to database for image association: {}", e);
                                return Err(JobError::ProcessingFailed {
                                    reason: format!("failed to connect to database: {}", e),
                                });
                            }
                        };

                        // insert embedded art if present
                        if let Some(embedded_id) = &collected.embedded_art_blob_id {
                            let _ = sqlx::query!(
                                "INSERT OR IGNORE INTO song_imagez (song_id, media_blob_id, is_primary) VALUES (?, ?, 1)",
                                sid,
                                embedded_id
                            )
                            .execute(&pool)
                            .await;
                        }

                        // insert directory images
                        for (idx, blob_id) in collected.directory_image_blob_ids.iter().enumerate()
                        {
                            // first directory image is primary only if no embedded art
                            let is_primary = if collected.embedded_art_blob_id.is_none() && idx == 0
                            {
                                1
                            } else {
                                0
                            };
                            let _ = sqlx::query!(
                                "INSERT OR IGNORE INTO song_imagez (song_id, media_blob_id, is_primary) VALUES (?, ?, ?)",
                                sid,
                                blob_id,
                                is_primary
                            )
                            .execute(&pool)
                            .await;
                        }

                        debug!(
                            "associated {} images with song {}",
                            collected.embedded_art_blob_id.iter().count()
                                + collected.directory_image_blob_ids.len(),
                            sid
                        );
                    }

                    // associate with album if good match and not "Unknown Album"
                    if collected.has_good_match {
                        if let Some(aid) = &album_id {
                            // check if album name contains "unknown album" (case insensitive)
                            let pool = match database::connect().await {
                                Ok(p) => p,
                                Err(e) => {
                                    warn!("failed to connect for album check: {}", e);
                                    return Err(JobError::ProcessingFailed {
                                        reason: format!("failed to connect to database: {}", e),
                                    });
                                }
                            };

                            let album = sqlx::query!("SELECT title FROM albumz WHERE id = ?", aid)
                                .fetch_optional(&pool)
                                .await;

                            if let Ok(Some(album_record)) = album {
                                let is_unknown =
                                    album_record.title.to_lowercase().contains("unknown album");

                                if !is_unknown {
                                    // use embedded art or first directory image as album art
                                    if let Some(art_blob_id) =
                                        collected.embedded_art_blob_id.or_else(|| {
                                            collected.directory_image_blob_ids.first().cloned()
                                        })
                                    {
                                        // check if album already has a primary image
                                        let has_primary = sqlx::query!(
                                            "SELECT COUNT(*) as count FROM album_imagez WHERE album_id = ? AND is_primary = 1",
                                            aid
                                        )
                                        .fetch_one(&pool)
                                        .await
                                        .ok()
                                        .map(|r| r.count > 0)
                                        .unwrap_or(false);

                                        let is_primary = if has_primary { 0 } else { 1 };

                                        let _ = sqlx::query!(
                                            "INSERT OR IGNORE INTO album_imagez (album_id, media_blob_id, is_primary) VALUES (?, ?, ?)",
                                            aid,
                                            art_blob_id,
                                            is_primary
                                        )
                                        .execute(&pool)
                                        .await;

                                        debug!("associated album art with album {}", aid);
                                    }
                                }
                            }
                        }
                    }

                    time_images = step_start.elapsed();
                    images_collected = true;
                }
            }
            response => {
                let error_msg = if !response.errors.is_empty() {
                    response.errors[0].detail.clone()
                } else {
                    response.message
                };
                warn!("image collection failed: {}", error_msg);
            }
        }
    }

    // step 4: generate waveform if requested
    let mut waveform_blob_id_opt = None;
    let waveform_generated = if params.generate_waveform {
        let step_start = std::time::Instant::now();
        match blob_data::create_audio_waveform_blob(
            &media_blob_id,
            &params.file_path,
            &config,
            job.created_by.clone(),
        )
        .await
        {
            response if response.success => match response.data {
                Some(waveform_blob_id) => {
                    time_waveform = step_start.elapsed();
                    debug!("waveform generated as blob: {}", waveform_blob_id);
                    waveform_blob_id_opt = Some(waveform_blob_id);
                    true
                }
                None => {
                    warn!("waveform generation failed: no data returned");
                    false
                }
            },
            response => {
                let error_msg = if !response.errors.is_empty() {
                    response.errors[0].detail.clone()
                } else {
                    response.message
                };
                warn!("waveform generation failed: {}", error_msg);
                false
            }
        }
    } else {
        false
    };

    // step 5: link thumbnail and waveform blobs to song record
    if let Some(sid) = &song_id {
        if thumbnail_blob_id_opt.is_some() || waveform_blob_id_opt.is_some() {
            let step_start = std::time::Instant::now();
            let pool = match database::connect().await {
                Ok(p) => p,
                Err(e) => {
                    warn!("failed to connect to database for blob linking: {}", e);
                    return Err(JobError::ProcessingFailed {
                        reason: format!("failed to connect to database: {}", e),
                    });
                }
            };

            // insert images into song_imagez table instead of updating singular fields
            if let Some(thumbnail_id) = thumbnail_blob_id_opt {
                let _ = sqlx::query!(
                    r#"INSERT OR IGNORE INTO song_imagez (song_id, media_blob_id, is_primary) VALUES (?, ?, 1)"#,
                    sid,
                    thumbnail_id
                )
                .execute(&pool)
                .await
                .map_err(|e| warn!("failed to insert thumbnail to song_imagez for {}: {}", sid, e));
            }

            if let Some(waveform_id) = waveform_blob_id_opt {
                let _ = sqlx::query!(
                    r#"INSERT OR IGNORE INTO song_imagez (song_id, media_blob_id, is_primary) VALUES (?, ?, 0)"#,
                    sid,
                    waveform_id
                )
                .execute(&pool)
                .await
                .map_err(|e| warn!("failed to insert waveform to song_imagez for {}: {}", sid, e));
            }

            time_db_updates += step_start.elapsed();
            debug!("linked thumbnail/waveform blobs to song {}", sid);
        }
    }

    let result = ProcessFileResult {
        media_blob_id,
        song_id,
        artist_id,
        album_id,
        metadata_extracted,
        thumbnail_generated: images_collected,
        waveform_generated,
    };

    // timing summary
    let job_total = job_start.elapsed();
    let total_ms = job_total.as_millis() as f64;

    info!(
        "file processing complete: blob={} | total={:.1}s | sha256={:.1}s ({:.0}%) | metadata={:.1}s ({:.0}%) | images={:.1}s ({:.0}%) | waveform={:.1}s ({:.0}%) | db={:.1}s ({:.0}%)",
        result.media_blob_id,
        total_ms / 1000.0,
        time_sha256.as_millis() as f64 / 1000.0,
        (time_sha256.as_millis() as f64 / total_ms) * 100.0,
        time_metadata.as_millis() as f64 / 1000.0,
        (time_metadata.as_millis() as f64 / total_ms) * 100.0,
        time_images.as_millis() as f64 / 1000.0,
        (time_images.as_millis() as f64 / total_ms) * 100.0,
        time_waveform.as_millis() as f64 / 1000.0,
        (time_waveform.as_millis() as f64 / total_ms) * 100.0,
        time_db_updates.as_millis() as f64 / 1000.0,
        (time_db_updates.as_millis() as f64 / total_ms) * 100.0,
    );

    Ok(Some(serde_json::to_value(result).map_err(|e| {
        JobError::ProcessingFailed {
            reason: format!("failed to serialize result: {}", e),
        }
    })?))
}
