//! media fetching job processor
//!
//! download media from the internet (or where ever) using the config command;
//! creates ProcessFile jobs for each downloaded file

use super::models::ProcessFileParams;
use crate::config::get_config;
use crate::database;
use crate::jobs::models::{CreateJobRequest, Job, JobError, JobType};
use crate::jobs::service::create_job;
use crate::music::fetch::{
    check_existing_content, download_media, extract_metadata, FetchMediaParams, FetchMediaResult,
    FetchProgress,
};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tracing::{debug, error, info, warn};

/// progress emitter for fetch jobs - translates download callbacks into JobEvent::Stage emissions
struct JobProgressEmitter {
    job: Job,
    total: usize,
    index: AtomicUsize,
    title_by_content_id: HashMap<String, String>,
    started_idx: Mutex<HashMap<String, usize>>,
}

impl JobProgressEmitter {
    fn new(job: Job, total: usize, title_by_content_id: HashMap<String, String>) -> Self {
        Self {
            job,
            total,
            index: AtomicUsize::new(0),
            title_by_content_id,
            started_idx: Mutex::new(HashMap::new()),
        }
    }

    fn emit_stage(&self, stage: &str, message: String) {
        crate::jobs::job_events::emit(crate::jobs::job_events::JobEvent::Stage {
            session_id: self.job.session_id.clone(),
            job_id: self.job.id.clone(),
            stage: stage.to_string(),
            message: Some(message),
            topic: JobType::FetchMedia,
            entity_ref: None,
            created_by: self.job.created_by.clone(),
        });
    }
}

impl FetchProgress for JobProgressEmitter {
    fn item_started(&self, content_id: &str, _filename_hint: Option<&str>) {
        let idx = self.index.fetch_add(1, Ordering::SeqCst) + 1;
        let title = self
            .title_by_content_id
            .get(content_id)
            .cloned()
            .unwrap_or_else(|| content_id.to_string());
        let message = format!("{}/{}: {}", idx, self.total, title);
        self.emit_stage("item_started", message);

        // record idx for this content_id so item_complete/postprocess can use it
        if let Ok(mut map) = self.started_idx.lock() {
            map.insert(content_id.to_string(), idx);
        }
    }

    fn item_complete(&self, content_id: &str, filename: &str) {
        let idx = self
            .started_idx
            .lock()
            .ok()
            .and_then(|map| map.get(content_id).copied())
            .unwrap_or(0);
        let message = format!("{}/{}: {}", idx, self.total, filename);
        self.emit_stage("item_complete", message);
    }

    fn postprocess(&self, content_id: &str) {
        let message = format!("converting/tagging: {}", content_id);
        self.emit_stage("postprocess", message);
    }
}

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

    // step 1: emit precheck_started
    crate::jobs::job_events::emit_stage_from_job(job, "precheck_started", Some(&params.url));

    // step 2: extract metadata (precheck)
    let metadata_list = match extract_metadata(&params.url, &config).await {
        Ok(list) => list,
        Err(e) => {
            return Err(JobError::ProcessingFailed {
                reason: format!("precheck failed: {}", e),
            })
        }
    };

    let total_items = metadata_list.len();
    info!("found {} item(s) to fetch", total_items);

    // step 3: emit precheck_complete
    crate::jobs::job_events::emit_stage_from_job(
        job,
        "precheck_complete",
        Some(&format!("{} item(s) found", total_items)),
    );

    // step 4: check for existing content
    let existing = check_existing_content(&metadata_list).await;
    if !existing.is_empty() {
        info!("{} item(s) already exist, skipping", existing.len());
        // step 5: emit dedup only if there are duplicates
        crate::jobs::job_events::emit_stage_from_job(
            job,
            "dedup",
            Some(&format!("{} item(s) already present", existing.len())),
        );
    }

    // step 6: build progress emitter
    let title_by_content_id: HashMap<String, String> = metadata_list
        .iter()
        .map(|m| {
            let title = m.title.clone().unwrap_or_else(|| m.content_id.clone());
            (m.content_id.clone(), title)
        })
        .collect();

    let emitter = JobProgressEmitter::new(job.clone(), total_items, title_by_content_id);

    // step 7: download media
    let downloaded_files = match download_media(&params.url, &job.id, &config, &emitter).await {
        Ok(files) => files,
        Err(e) => {
            return Err(JobError::ProcessingFailed {
                reason: format!("download failed: {}", e),
            })
        }
    };

    if downloaded_files.is_empty() {
        return Err(JobError::ProcessingFailed {
            reason: "no files downloaded".to_string(),
        });
    }

    // step 8: build result
    let mut result =
        FetchMediaResult::from_downloads(total_items as u32, downloaded_files.clone(), Vec::new());

    // add existing content to result
    for (_content_id, blob_id) in existing {
        result.media_blob_ids.push(blob_id);
    }

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
            crate::jobs::job_events::emit(crate::jobs::job_events::JobEvent::Progress {
                session_id: session_id.to_string(),
                complete: 0,
                total: (1 + n) as i64,
                topic: crate::jobs::JobType::FetchMedia,
                entity_ref: None,
                created_by: job.created_by.clone(),
                details: Some(serde_json::json!({
                    "directory": directory,
                    "songs_added": 0,
                    "jobs_pending": (1 + n) as u32,
                    "jobs_total": (1 + n) as u32,
                })),
            });
        }
    }

    // step 9: create ProcessFile jobs for each downloaded file
    let mut spawned_count = 0;
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

        // create ProcessFile job with fetch metadata embedded in parameters.
        // serialization_group is set to this fetch job's id so the runner
        // serializes every child of this yt-dlp url onto a single worker
        // (avoids find_or_create_artist / find_or_create_album races for
        // sibling tracks of one playlist). multi-url submits still fan out
        // because each fetch job has a distinct id.
        let process_params = ProcessFileParams {
            file_path: downloaded_file.file_path.clone(),
            extract_metadata: true,
            generate_thumbnail: true,
            generate_waveform: true,
            source_url: Some(params.url.clone()),
            existing_blob_id: None,
            serialization_group: Some(job.id.clone()),
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
                spawned_count += 1;
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

    // step 10: emit import_spawned, then wait for children to settle so
    // the parent job's stage stream stays live until all spawned
    // ProcessFile/ImportMusic children have completed. while parent is
    // still Running, the runner has not yet emitted its terminal
    // StatusChanged; clients subscribed by parent job_id keep receiving
    // Stage events with running counts.
    crate::jobs::job_events::emit_stage_from_job(
        job,
        "import_spawned",
        Some(&format!("queued {} import job(s)", spawned_count)),
    );

    if let Some(session_id) = job.session_id.as_deref() {
        use crate::jobs::service::get_session_job_counts;
        let mut last_done: u32 = u32::MAX;
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
            let counts = match get_session_job_counts(session_id).await.data {
                Some(c) => c,
                None => break,
            };
            // parent itself is the only Running job once all children
            // settle. children are pending/running until they finish.
            let other_pending = counts.pending;
            let other_running = counts.running.saturating_sub(1); // exclude self
            let done = counts.completed + counts.failed;
            if other_pending == 0 && other_running == 0 {
                crate::jobs::job_events::emit_stage_from_job(
                    job,
                    "import_complete",
                    Some(&format!(
                        "imported {}/{} ({} failed)",
                        counts.completed, counts.total, counts.failed
                    )),
                );
                break;
            }
            if done != last_done {
                crate::jobs::job_events::emit_stage_from_job(
                    job,
                    "importing",
                    Some(&format!(
                        "importing {}/{} ({} pending, {} running)",
                        done, counts.total, other_pending, other_running
                    )),
                );
                last_done = done;
            }
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
