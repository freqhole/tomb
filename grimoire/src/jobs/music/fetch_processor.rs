//! media fetching job processor
//!
//! download media from the internet (or where ever) using the config command;
//! creates ProcessFile jobs for each downloaded file

use super::models::ProcessFileParams;
use crate::config::get_config;
use crate::database;
use crate::jobs::models::{CreateJobRequest, Job, JobError, JobType};
use crate::jobs::service::create_job;
use crate::music::fetch::{fetch_media, FetchMediaParams};
use serde_json::Value;
use std::time::{SystemTime, UNIX_EPOCH};
use tracing::{debug, error, info, warn};

/// process fetch media job - download from external source and import
pub async fn process_fetch_media_job(job: &Job) -> Result<Option<Value>, JobError> {
    info!("processing fetch media job: {}", job.id);

    // parse job parameters
    let params: FetchMediaParams = match serde_json::from_str(&job.parameters) {
        Ok(p) => p,
        Err(e) => {
            return Err(JobError::ProcessingFailed {
                reason: format!("invalid parameters: {}", e),
            })
        }
    };

    // get config
    let config = get_config();

    // execute fetch workflow
    let response = fetch_media(params.clone(), &job.id, &config).await;

    if !response.success {
        return Err(JobError::ProcessingFailed {
            reason: response.message,
        });
    }

    let mut result = response.data.ok_or_else(|| JobError::ProcessingFailed {
        reason: "no result data from fetch".to_string(),
    })?;

    // get current timestamp
    let fetched_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    // get database connection for metadata storage
    let pool = database::connect().await?;

    // bump session.progress total to reflect the soon-to-be-spawned
    // child ProcessFile jobs. without this the runner's progress
    // calculation stays pegged at the original total (1 — set by
    // the /fetch admin handler) so the ui badge never advances.
    if let Some(session_id) = job.session_id.as_deref() {
        let n = result.items_downloaded_files.len() as u64;
        if n > 0 {
            // existing total is the FetchMedia row itself (1); add
            // the children. completed = 1 once this row finishes.
            let _ = crate::jobs::update_session_progress(
                session_id,
                crate::jobs::JobProgress::new(0, 1 + n),
                None,
            )
            .await;
            // emit an immediate progress event reflecting the new
            // total so the ui badge advances the moment the fetch
            // download finishes — without waiting for the runner's
            // post-completion emit (which fires after the row is
            // marked done and deleted).
            let directory = serde_json::from_str::<serde_json::Value>(&job.parameters)
                .ok()
                .and_then(|p| p.get("url").and_then(|v| v.as_str()).map(str::to_string))
                .unwrap_or_default();
            crate::events::emit(crate::events::GrimoireEvent::JobProgress {
                session_id: session_id.to_string(),
                directory,
                songs_added: 0,
                jobs_pending: (1 + n) as u32,
                jobs_total: (1 + n) as u32,
            });
        }
    }

    // create ProcessFile jobs for each downloaded file
    for downloaded_file in &result.items_downloaded_files {
        let file_metadata = &downloaded_file.metadata;

        // build fetch provenance metadata to store in media_blob
        let fetch_metadata = serde_json::json!({
            "source_url": params.url,
            "content_id": file_metadata.content_id,
            "platform": file_metadata.platform,
            "fetch_job_id": job.id,
            "fetched_at": fetched_at,
            "original_title": file_metadata.title,
            "original_uploader": file_metadata.uploader,
            "original_artist": file_metadata.artist,
            "duration_seconds": file_metadata.duration_seconds,
            "playlist_title": file_metadata.playlist_title,
            "playlist_index": file_metadata.playlist_index,
        });

        // create ProcessFile job with fetch metadata embedded in parameters
        let process_params = ProcessFileParams {
            file_path: downloaded_file.file_path.clone(),
            extract_metadata: true,
            generate_thumbnail: true,
            generate_waveform: true,
            source_url: Some(params.url.clone()),
        };

        let job_request = CreateJobRequest {
            job_type: JobType::ProcessFile,
            session_id: job.session_id.clone(),
            parameters: serde_json::to_value(&process_params).map_err(|e| {
                JobError::ProcessingFailed {
                    reason: format!("failed to serialize ProcessFile params: {}", e),
                }
            })?,
            max_retries: Some(3),
            scheduled_at: None, // immediate
            created_by: job.created_by.clone(),
            priority: None,
        };

        let response = create_job(job_request).await;

        if response.success {
            if let Some(process_job) = response.data {
                debug!(
                    "created ProcessFile job {} for file: {}",
                    process_job.id, downloaded_file.file_path
                );

                // store fetch metadata in media_blob after it gets created
                // we'll update the blob's metadata column when the ProcessFile job completes
                // use json_patch to merge instead of overwriting existing metadata
                let metadata_json = serde_json::to_string(&fetch_metadata).unwrap_or_default();

                match sqlx::query!(
                    r#"
                    UPDATE media_blobz
                    SET metadata = json_patch(COALESCE(metadata, '{}'), ?)
                    WHERE content_id = ?
                    "#,
                    metadata_json,
                    file_metadata.content_id
                )
                .execute(&pool)
                .await
                {
                    Ok(_) => {
                        debug!(
                            "stored fetch metadata for content_id: {}",
                            file_metadata.content_id
                        );
                    }
                    Err(e) => {
                        warn!(
                            "failed to store fetch metadata for {}: {}",
                            file_metadata.content_id, e
                        );
                    }
                }
            }
        } else {
            error!(
                "failed to create ProcessFile job for {}: {}",
                downloaded_file.file_path, response.message
            );
            result.errors.push(format!(
                "failed to spawn job for {}: {}",
                downloaded_file.file_path, response.message
            ));
        }
    }

    info!(
        "fetch media job completed: {}/{} items downloaded, {} errors",
        result.items_downloaded,
        result.items_requested,
        result.errors.len()
    );

    // return result
    Ok(Some(serde_json::to_value(result).map_err(|e| {
        JobError::ProcessingFailed {
            reason: format!("failed to serialize result: {}", e),
        }
    })?))
}
