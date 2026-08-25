//! audio file processing job processor
//!
//! imports audio files by creating media blobz, extracting metadata,
//! creating song/artist/album records, and generating thumbnails/waveforms

use super::models::{ProcessFileParams, ProcessFileResult};
use crate::blob_data;
use crate::config;
use crate::database;
use crate::jobs::models::{Job, JobError};
use crate::media_domain::{detect_media_domain_from_extension, MediaDomain};
use crate::music::analytics::feed_events::upsert_album_feed_event;
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

    // don't leak the full local path into the broadcast error.
    let basename = file_path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("<unknown>");

    // a single metadata read distinguishes "does not exist" from "exists but
    // unreadable" (permission denied, broken symlink) - `.exists()` alone
    // can't tell these apart, so a permission error used to look identical
    // to a missing file and burn a retryable `ProcessingFailed` on what is
    // actually a deterministic permission problem.
    info!("processing file: {}", params.file_path);

    let metadata = match fs::metadata(file_path) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Err(JobError::ProcessingFailed {
                reason: format!("file does not exist: {}", basename),
            });
        }
        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => {
            return Err(JobError::ProcessingFailedFinal {
                reason: format!("permission denied reading file: {} ({})", basename, e),
                error_type: "file_permission_denied".to_string(),
            });
        }
        Err(e) => {
            return Err(JobError::ProcessingFailed {
                reason: format!("failed to read file metadata for {}: {}", basename, e),
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

    // rescan-update path: when the scanner already knows about a media_blobz
    // row at this local_path, refresh that row (and any song hanging off it)
    // in-place instead of creating new records. preserves song id and all
    // references to it (playlists, favorites, ratings, listening sessions).
    if let Some(existing_blob_id) = params.existing_blob_id.as_deref() {
        match scanner::update_existing_from_rescan(
            existing_blob_id,
            file_path,
            file_size as i64,
            file_modified_at,
        )
        .await
        {
            Ok(update) => {
                let result = ProcessFileResult {
                    media_blob_id: update.blob_id,
                    song_id: update.song_id,
                    artist_id: None,
                    album_id: None,
                    metadata_extracted: update.song_updated,
                    thumbnail_generated: false,
                    waveform_generated: false,
                    is_duplicate: false,
                };
                info!(
                    "file rescan-update complete: blob={} sha256_changed={} song_updated={} (total={:?})",
                    result.media_blob_id,
                    update.sha256_changed,
                    update.song_updated,
                    job_start.elapsed(),
                );
                return Ok(Some(serde_json::to_value(result).map_err(|e| {
                    JobError::ProcessingFailed {
                        reason: format!("failed to serialize result: {}", e),
                    }
                })?));
            }
            Err(e) => {
                // rescan-update failed (eg. existing blob disappeared); fall
                // through to the normal new-import path
                warn!(
                    "rescan-update failed for blob {}, falling back to new-import: {}",
                    existing_blob_id, e
                );
            }
        }
    }

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

    // branch by effective media domain: video files skip the entire
    // music-specific pipeline below (song/artist/album creation, embedded
    // art collection, waveform generation) and go through their own
    // importer instead.
    let effective_domain = params
        .domain
        .or_else(|| detect_media_domain_from_extension(&params.file_path, &config));

    if effective_domain == Some(MediaDomain::Video) {
        let import_result = crate::video::importer::import_video_file(
            &media_blob_id,
            file_path,
            None,
            job.created_by.clone(),
            Some(job),
        )
        .await?;

        let result = ProcessFileResult {
            media_blob_id: media_blob_id.clone(),
            song_id: None,
            artist_id: None,
            album_id: None,
            metadata_extracted: !import_result.is_duplicate,
            thumbnail_generated: import_result.poster_blob_id.is_some(),
            waveform_generated: false,
            is_duplicate: import_result.is_duplicate,
        };

        info!(
            "video file processing complete: blob={} video_id={} is_duplicate={} (total={:?})",
            media_blob_id,
            import_result.video_id,
            result.is_duplicate,
            job_start.elapsed(),
        );

        return Ok(Some(serde_json::to_value(result).map_err(|e| {
            JobError::ProcessingFailed {
                reason: format!("failed to serialize result: {}", e),
            }
        })?));
    } else if effective_domain.is_none() {
        let basename = file_path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("<unknown>");
        return Err(JobError::ProcessingFailed {
            reason: format!(
                "cannot determine media domain for file (unrecognized extension): {}",
                basename
            ),
        });
    }

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
                is_duplicate = import_result.is_duplicate;
                time_metadata = step_start.elapsed();
                debug!("metadata extracted successfully");

                if is_duplicate {
                    // the content already exists as a previously-imported song - its
                    // thumbnail/waveform assets are already in place and it has
                    // nothing new to review.
                    info!("duplicate detected (existing song reused), skipping image and waveform generation");
                } else {
                    // register this blob in the import review queue if the job has a session
                    if let Some(ref session_id) = job.session_id {
                        if let Ok(pool) = crate::database::connect().await {
                            let _ = sqlx::query!(
                                "INSERT OR IGNORE INTO import_blobz (media_blob_id, session_id) VALUES (?, ?)",
                                media_blob_id,
                                session_id
                            )
                            .execute(&pool)
                            .await;
                        }
                    }

                    // if this file came from a fetch job, add the source URL to the album
                    if let (Some(source_url), Some(aid)) =
                        (&params.source_url, &import_result.album_id)
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
            }
            response => {
                let error_msg = if !response.errors.is_empty() {
                    response.errors[0].detail.clone()
                } else {
                    response.message
                };

                // fallback: a duplicate should normally be resolved as a success
                // above (existing song looked up and reused); this only catches a
                // duplicate that couldn't be resolved that way (e.g. the
                // pre-existing song's own lookup failed), so processing still
                // degrades gracefully instead of hard-failing.
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
            is_duplicate: true,
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
                // job still reports success below (images_collected stays false) - there's
                // no partial-failure field on ProcessFileResult yet (see
                // docs/error-handling-tasks.md's P0-C section), so this log is the only
                // signal that art collection broke vs. the file genuinely having no art.
                warn!(
                    "image collection failed for blob {} ({}): {}",
                    media_blob_id, params.file_path, error_msg
                );
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
                    warn!(
                        "waveform generation failed for blob {} ({}): no data returned",
                        media_blob_id, params.file_path
                    );
                    false
                }
            },
            response => {
                let error_msg = if !response.errors.is_empty() {
                    response.errors[0].detail.clone()
                } else {
                    response.message
                };
                // same as image collection above: no partial-failure field on
                // ProcessFileResult yet, so the job reports waveform_generated=false
                // with only this log to explain why.
                warn!(
                    "waveform generation failed for blob {} ({}): {}",
                    media_blob_id, params.file_path, error_msg
                );
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

    // refresh album feed event if images were collected (updates images in existing feed event)
    if images_collected {
        if let (Some(aid), Some(uid)) = (&album_id, &job.created_by) {
            let aid = aid.clone();
            let uid = uid.clone();
            tokio::spawn(async move {
                let pool = match database::connect().await {
                    Ok(p) => p,
                    Err(_) => return,
                };
                let username =
                    sqlx::query_scalar!(r#"SELECT username FROM user_accountz WHERE id = ?"#, uid)
                        .fetch_optional(&pool)
                        .await
                        .ok()
                        .flatten()
                        .unwrap_or_else(|| "unknown".to_string());

                let _ = upsert_album_feed_event(&aid, &uid, &username, 1).await;
            });
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
        is_duplicate: false,
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
