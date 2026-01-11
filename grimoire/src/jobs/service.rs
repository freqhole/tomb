//! Job processing service for unified background task processing
//! Handles job queue management, execution, and session-based batch operations

use std::fs;
use std::path::Path;
use std::time::{Duration, Instant};

use serde_json::Value;
use sqlx::Row;

use crate::blob_data;
use crate::database;
use crate::music::scanner;
use crate::response::GrimoireResponse;

use super::models::{
    CreateJobRequest, CreateJobSessionRequest, Job, JobError, JobProgress, JobResult, JobSession,
    JobStatus, JobType, ProcessFileParams, ProcessFileResult, QueueStats, ScanDirectoryParams,
    ScanDirectoryResult,
};

/// Create a new job session for batch operations
pub async fn create_job_session(request: CreateJobSessionRequest) -> GrimoireResponse<JobSession> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("Failed to connect to database", vec![e.into()])
        }
    };

    let job_type_str = match serde_json::to_string(&request.job_type) {
        Ok(s) => s,
        Err(e) => return GrimoireResponse::failure("Failed to serialize job type", vec![e.into()]),
    };
    let job_type_str = job_type_str.trim_matches('"'); // Remove quotes from serialized enum

    let batch_size = request.batch_size.unwrap_or(100) as i64;
    let progress = JobProgress::new(0, 0);
    let progress_json = match serde_json::to_string(&progress) {
        Ok(s) => s,
        Err(e) => return GrimoireResponse::failure("Failed to serialize progress", vec![e.into()]),
    };

    let session = match sqlx::query_as::<_, JobSession>(
        r#"
        INSERT INTO job_sessionz (job_type, status, progress, batch_size, created_by)
        VALUES (?, 'Active', ?, ?, ?)
        RETURNING id, job_type, status, progress, last_checkpoint, batch_size,
                  created_at, updated_at, created_by
        "#,
    )
    .bind(job_type_str)
    .bind(progress_json)
    .bind(batch_size)
    .bind(request.created_by)
    .fetch_one(&pool)
    .await
    {
        Ok(s) => s,
        Err(e) => return GrimoireResponse::failure("Failed to create job session", vec![e.into()]),
    };

    GrimoireResponse::success("Job session created successfully", session)
}

/// Create a new job in the queue
pub async fn create_job(request: CreateJobRequest) -> GrimoireResponse<Job> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("Failed to connect to database", vec![e.into()])
        }
    };

    let job_type_str = match serde_json::to_string(&request.job_type) {
        Ok(s) => s,
        Err(e) => return GrimoireResponse::failure("Failed to serialize job type", vec![e.into()]),
    };
    let job_type_str = job_type_str.trim_matches('"'); // Remove quotes from serialized enum

    let parameters_json = match serde_json::to_string(&request.parameters) {
        Ok(s) => s,
        Err(e) => {
            return GrimoireResponse::failure("Failed to serialize parameters", vec![e.into()])
        }
    };
    let max_retries = request.max_retries.unwrap_or(3);
    let scheduled_at = request.scheduled_at.unwrap_or_else(|| {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64
    });

    let job = match sqlx::query_as::<_, Job>(
        r#"
        INSERT INTO jobz (session_id, job_type, status, parameters, max_retries, scheduled_at, created_by)
        VALUES (?, ?, 'Pending', ?, ?, ?, ?)
        RETURNING id, session_id, job_type, status, parameters, result, retry_count,
                  max_retries, scheduled_at, started_at, completed_at, error_message, created_by
        "#,
    )
    .bind(request.session_id)
    .bind(job_type_str)
    .bind(parameters_json)
    .bind(max_retries)
    .bind(scheduled_at)
    .bind(request.created_by)
    .fetch_one(&pool)
    .await
    {
        Ok(j) => j,
        Err(e) => return GrimoireResponse::failure("Failed to create job", vec![e.into()]),
    };

    GrimoireResponse::success("Job created successfully", job)
}

/// Get a job by ID
pub async fn get_job(job_id: &str) -> GrimoireResponse<Job> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("Failed to connect to database", vec![e.into()])
        }
    };

    let job = match sqlx::query_as::<_, Job>(
        r#"
        SELECT id, session_id, job_type, status, parameters, result, retry_count,
               max_retries, scheduled_at, started_at, completed_at, error_message, created_by
        FROM jobz WHERE id = ?
        "#,
    )
    .bind(job_id)
    .fetch_optional(&pool)
    .await
    {
        Ok(Some(j)) => j,
        Ok(None) => {
            return GrimoireResponse::failure(
                "Job not found",
                vec![JobError::JobNotFound {
                    id: job_id.to_string(),
                }
                .into()],
            )
        }
        Err(e) => return GrimoireResponse::failure("Failed to fetch job", vec![e.into()]),
    };

    GrimoireResponse::success("Job retrieved successfully", job)
}

/// Get a job session by ID
pub async fn get_job_session(session_id: &str) -> GrimoireResponse<JobSession> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("Failed to connect to database", vec![e.into()])
        }
    };

    let session = match sqlx::query_as::<_, JobSession>(
        r#"
        SELECT id, job_type, status, progress, last_checkpoint, batch_size,
               created_at, updated_at, created_by
        FROM job_sessionz WHERE id = ?
        "#,
    )
    .bind(session_id)
    .fetch_optional(&pool)
    .await
    {
        Ok(Some(s)) => s,
        Ok(None) => {
            return GrimoireResponse::failure(
                "Job session not found",
                vec![JobError::JobNotFound {
                    id: session_id.to_string(),
                }
                .into()],
            )
        }
        Err(e) => return GrimoireResponse::failure("Failed to fetch job session", vec![e.into()]),
    };

    GrimoireResponse::success("Job session retrieved successfully", session)
}

/// Get the next pending job to process
/// Get the next pending job from the queue
pub async fn get_next_pending_job() -> GrimoireResponse<Option<Job>> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("Failed to connect to database", vec![e.into()])
        }
    };

    let job = match sqlx::query_as::<_, Job>(
        r#"
        SELECT id, session_id, job_type, status, parameters, result, retry_count,
               max_retries, scheduled_at, started_at, completed_at, error_message, created_by
        FROM jobz
        WHERE status = 'Pending' AND scheduled_at <= unixepoch()
        ORDER BY scheduled_at ASC
        LIMIT 1
        "#,
    )
    .fetch_optional(&pool)
    .await
    {
        Ok(j) => j,
        Err(e) => {
            return GrimoireResponse::failure("Failed to fetch next pending job", vec![e.into()])
        }
    };

    GrimoireResponse::success("Retrieved next pending job", job)
}

/// Mark a job as started
pub async fn mark_job_started(job_id: &str) -> GrimoireResponse<Job> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("Failed to connect to database", vec![e.into()])
        }
    };

    let job = match sqlx::query_as::<_, Job>(
        r#"
        UPDATE jobz
        SET status = 'Running', started_at = unixepoch()
        WHERE id = ?
        RETURNING id, session_id, job_type, status, parameters, result, retry_count,
                  max_retries, scheduled_at, started_at, completed_at, error_message, created_by
        "#,
    )
    .bind(job_id)
    .fetch_one(&pool)
    .await
    {
        Ok(j) => j,
        Err(e) => {
            return GrimoireResponse::failure("Failed to mark job as started", vec![e.into()])
        }
    };

    GrimoireResponse::success("Job marked as started", job)
}

/// Mark a job as completed
pub async fn mark_job_completed(job_id: &str, result: Option<Value>) -> GrimoireResponse<Job> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("Failed to connect to database", vec![e.into()])
        }
    };

    let result_json = match result {
        Some(r) => match serde_json::to_string(&r) {
            Ok(s) => Some(s),
            Err(e) => {
                return GrimoireResponse::failure("Failed to serialize result", vec![e.into()])
            }
        },
        None => None,
    };

    let job = match sqlx::query_as::<_, Job>(
        r#"
        UPDATE jobz
        SET status = 'Completed', completed_at = unixepoch(), result = ?
        WHERE id = ?
        RETURNING id, session_id, job_type, status, parameters, result, retry_count,
                  max_retries, scheduled_at, started_at, completed_at, error_message, created_by
        "#,
    )
    .bind(result_json)
    .bind(job_id)
    .fetch_one(&pool)
    .await
    {
        Ok(j) => j,
        Err(e) => {
            return GrimoireResponse::failure("Failed to mark job as completed", vec![e.into()])
        }
    };

    GrimoireResponse::success("Job marked as completed", job)
}

/// Mark a job as failed and handle retry logic
pub async fn mark_job_failed(job_id: &str, error_message: &str) -> GrimoireResponse<Job> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("Failed to connect to database", vec![e.into()])
        }
    };

    // First get the current job to check retry count
    let current_job_response = get_job(job_id).await;
    let current_job = match current_job_response.data {
        Some(j) => j,
        None => {
            return GrimoireResponse::failure(
                "Failed to get current job for retry check",
                current_job_response.errors,
            )
        }
    };

    let new_retry_count = current_job.retry_count + 1;
    let should_retry = new_retry_count < current_job.max_retries;

    let (status, scheduled_at) = if should_retry {
        // Schedule for retry with exponential backoff (base 2 minutes)
        let backoff_seconds = 2_i64.pow(new_retry_count as u32) * 60;
        let retry_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64
            + backoff_seconds;
        ("Pending".to_string(), retry_at)
    } else {
        ("Failed".to_string(), current_job.scheduled_at)
    };

    let job = match sqlx::query_as::<_, Job>(
        r#"
        UPDATE jobz
        SET status = ?, retry_count = ?, error_message = ?, scheduled_at = ?,
            completed_at = CASE WHEN ? = 'Failed' THEN unixepoch() ELSE completed_at END
        WHERE id = ?
        RETURNING id, session_id, job_type, status, parameters, result, retry_count,
                  max_retries, scheduled_at, started_at, completed_at, error_message, created_by
        "#,
    )
    .bind(&status)
    .bind(new_retry_count)
    .bind(error_message)
    .bind(scheduled_at)
    .bind(&status)
    .bind(job_id)
    .fetch_one(&pool)
    .await
    {
        Ok(j) => j,
        Err(e) => return GrimoireResponse::failure("Failed to mark job as failed", vec![e.into()]),
    };

    GrimoireResponse::success("Job marked as failed", job)
}

/// Cancel a job
pub async fn cancel_job(job_id: &str) -> GrimoireResponse<Job> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("Failed to connect to database", vec![e.into()])
        }
    };

    let job = match sqlx::query_as::<_, Job>(
        r#"
        UPDATE jobz
        SET status = 'Cancelled', completed_at = unixepoch()
        WHERE id = ? AND status IN ('Pending', 'Running')
        RETURNING id, session_id, job_type, status, parameters, result, retry_count,
                  max_retries, scheduled_at, started_at, completed_at, error_message, created_by
        "#,
    )
    .bind(job_id)
    .fetch_one(&pool)
    .await
    {
        Ok(j) => j,
        Err(e) => return GrimoireResponse::failure("Failed to cancel job", vec![e.into()]),
    };

    GrimoireResponse::success("Job cancelled successfully", job)
}

/// Update job session progress
pub async fn update_session_progress(
    session_id: &str,
    progress: JobProgress,
    checkpoint: Option<String>,
) -> GrimoireResponse<JobSession> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("Failed to connect to database", vec![e.into()])
        }
    };

    let progress_json = match serde_json::to_string(&progress) {
        Ok(s) => s,
        Err(e) => return GrimoireResponse::failure("Failed to serialize progress", vec![e.into()]),
    };

    let session = match sqlx::query_as::<_, JobSession>(
        r#"
        UPDATE job_sessionz
        SET progress = ?, last_checkpoint = ?
        WHERE id = ?
        RETURNING id, job_type, status, progress, last_checkpoint, batch_size,
                  created_at, updated_at, created_by
        "#,
    )
    .bind(progress_json)
    .bind(checkpoint)
    .bind(session_id)
    .fetch_one(&pool)
    .await
    {
        Ok(s) => s,
        Err(e) => {
            return GrimoireResponse::failure("Failed to update session progress", vec![e.into()])
        }
    };

    GrimoireResponse::success("Session progress updated", session)
}

/// Complete a job session
pub async fn complete_session(session_id: &str) -> GrimoireResponse<JobSession> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("Failed to connect to database", vec![e.into()])
        }
    };

    let session = match sqlx::query_as::<_, JobSession>(
        r#"
        UPDATE job_sessionz
        SET status = 'Completed'
        WHERE id = ?
        RETURNING id, job_type, status, progress, last_checkpoint, batch_size,
                  created_at, updated_at, created_by
        "#,
    )
    .bind(session_id)
    .fetch_one(&pool)
    .await
    {
        Ok(s) => s,
        Err(e) => return GrimoireResponse::failure("Failed to complete session", vec![e.into()]),
    };

    GrimoireResponse::success("Session completed successfully", session)
}

/// Fail a job session
pub async fn fail_session(session_id: &str) -> GrimoireResponse<JobSession> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("Failed to connect to database", vec![e.into()])
        }
    };

    let session = match sqlx::query_as::<_, JobSession>(
        r#"
        UPDATE job_sessionz
        SET status = 'Failed'
        WHERE id = ?
        RETURNING id, job_type, status, progress, last_checkpoint, batch_size,
                  created_at, updated_at, created_by
        "#,
    )
    .bind(session_id)
    .fetch_one(&pool)
    .await
    {
        Ok(s) => s,
        Err(e) => {
            return GrimoireResponse::failure("Failed to mark session as failed", vec![e.into()])
        }
    };

    GrimoireResponse::success("Session marked as failed", session)
}

/// Get queue statistics
pub async fn get_queue_stats() -> GrimoireResponse<QueueStats> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("Failed to connect to database", vec![e.into()])
        }
    };

    let row = match sqlx::query(
        r#"
        SELECT
            COALESCE(SUM(CASE WHEN status = 'Pending' THEN 1 ELSE 0 END), 0) as pending_jobs,
            COALESCE(SUM(CASE WHEN status = 'Running' THEN 1 ELSE 0 END), 0) as running_jobs,
            COALESCE(SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END), 0) as completed_jobs,
            COALESCE(SUM(CASE WHEN status = 'Failed' THEN 1 ELSE 0 END), 0) as failed_jobs
        FROM jobz
        "#,
    )
    .fetch_one(&pool)
    .await
    {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure("Failed to fetch queue statistics", vec![e.into()])
        }
    };

    let active_sessions_row = match sqlx::query(
        "SELECT COUNT(*) as active_sessions FROM job_sessionz WHERE status = 'Active'",
    )
    .fetch_one(&pool)
    .await
    {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to fetch active sessions count",
                vec![e.into()],
            )
        }
    };

    let stats = QueueStats {
        pending_jobs: row.get("pending_jobs"),
        running_jobs: row.get("running_jobs"),
        completed_jobs: row.get("completed_jobs"),
        failed_jobs: row.get("failed_jobs"),
        active_sessions: active_sessions_row.get("active_sessions"),
    };

    GrimoireResponse::success("Retrieved queue statistics", stats)
}

/// List jobs with optional filtering
pub async fn list_jobs(
    session_id: Option<&str>,
    status: Option<JobStatus>,
    limit: Option<u32>,
    offset: Option<u32>,
) -> GrimoireResponse<Vec<Job>> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("Failed to connect to database", vec![e.into()])
        }
    };

    let mut query_str = String::from(
        r#"
        SELECT id, session_id, job_type, status, parameters, result, retry_count,
               max_retries, scheduled_at, started_at, completed_at, error_message, created_by
        FROM jobz
        WHERE 1=1
        "#,
    );

    let mut bind_count = 0;
    let mut params: Vec<String> = Vec::new();

    if let Some(sid) = session_id {
        query_str.push_str(&format!(" AND session_id = ${}", bind_count + 1));
        params.push(sid.to_string());
        bind_count += 1;
    }

    if let Some(stat) = status {
        let status_str = match serde_json::to_string(&stat) {
            Ok(s) => s.trim_matches('"').to_string(),
            Err(e) => {
                return GrimoireResponse::failure("Failed to serialize status", vec![e.into()])
            }
        };
        query_str.push_str(&format!(" AND status = ${}", bind_count + 1));
        params.push(status_str);
        bind_count += 1;
    }

    query_str.push_str(" ORDER BY scheduled_at DESC");

    if let Some(lim) = limit {
        query_str.push_str(&format!(" LIMIT ${}", bind_count + 1));
        params.push(lim.to_string());
        bind_count += 1;
    }

    if let Some(off) = offset {
        query_str.push_str(&format!(" OFFSET ${}", bind_count + 1));
        params.push(off.to_string());
    }

    let mut query = sqlx::query_as::<_, Job>(&query_str);
    for param in params {
        query = query.bind(param);
    }

    let jobs = match query.fetch_all(&pool).await {
        Ok(j) => j,
        Err(e) => return GrimoireResponse::failure("Failed to list jobs", vec![e.into()]),
    };

    GrimoireResponse::success("Jobs retrieved successfully", jobs)
}

/// Process a single job (to be called by job processor)
pub async fn process_job(job: Job) -> GrimoireResponse<JobResult> {
    let start_time = Instant::now();

    // Mark job as started
    let started_job_response = mark_job_started(&job.id).await;
    let job = match started_job_response.data {
        Some(j) => j,
        None => {
            return GrimoireResponse::failure(
                "Failed to mark job as started",
                started_job_response.errors,
            )
        }
    };

    // Get job type
    let job_type = match job.job_type() {
        Ok(jt) => jt,
        Err(e) => return GrimoireResponse::failure("Failed to parse job type", vec![e.into()]),
    };

    // Process based on job type
    let result = match job_type {
        JobType::ScanDirectory => process_scan_directory_job(&job).await,
        JobType::ProcessFile => process_file_job(&job).await,
        JobType::ExtractMetadata => process_extract_metadata_job(&job).await,
        JobType::GenerateThumbnail => process_generate_thumbnail_job(&job).await,
        JobType::GenerateWaveform => process_generate_waveform_job(&job).await,
    };

    let processing_time = start_time.elapsed().as_millis() as u64;

    match result {
        Ok(output) => {
            let completed_job_response = mark_job_completed(&job.id, output).await;
            let completed_job = match completed_job_response.data {
                Some(j) => j,
                None => {
                    return GrimoireResponse::failure(
                        "Failed to mark job as completed",
                        completed_job_response.errors,
                    )
                }
            };

            let job_result = JobResult {
                job: completed_job,
                output: None, // Could include the output here if needed
                processing_time_ms: processing_time,
            };
            GrimoireResponse::success("Job processed successfully", job_result)
        }
        Err(error) => {
            let _failed_job_response = mark_job_failed(&job.id, &error.to_string()).await;
            GrimoireResponse::failure("Job processing failed", vec![error.into()])
        }
    }
}

// Job processing functions
async fn process_scan_directory_job(job: &Job) -> Result<Option<Value>, JobError> {
    // Parse job parameters
    let params: ScanDirectoryParams = match serde_json::from_str(&job.parameters) {
        Ok(p) => p,
        Err(e) => {
            return Err(JobError::ProcessingFailed {
                reason: format!("Invalid parameters: {}", e),
            })
        }
    };

    let session_id = match job.session_id.as_ref() {
        Some(sid) => sid,
        None => {
            return Err(JobError::ProcessingFailed {
                reason: "ScanDirectory job requires a session_id".to_string(),
            })
        }
    };

    // Use music scanner to handle directory scanning and job creation
    let files_discovered = match scanner::scan_directory_and_create_jobs(
        &params.directory_path,
        session_id,
        params.recursive,
        params.max_depth,
        params.file_extensions,
    )
    .await
    {
        Ok(count) => count,
        Err(e) => {
            return Err(JobError::ProcessingFailed {
                reason: format!("Failed to scan directory: {}", e),
            })
        }
    };

    // Return scan results
    let result = ScanDirectoryResult {
        files_discovered: files_discovered as u64,
        jobs_created: files_discovered as u64,
        errors: Vec::new(),
    };

    Ok(Some(serde_json::to_value(result).map_err(|e| {
        JobError::ProcessingFailed {
            reason: format!("Failed to serialize result: {}", e),
        }
    })?))
}

async fn process_file_job(job: &Job) -> Result<Option<Value>, JobError> {
    // Parse job parameters
    let params: ProcessFileParams = match serde_json::from_str(&job.parameters) {
        Ok(p) => p,
        Err(e) => {
            return Err(JobError::ProcessingFailed {
                reason: format!("Invalid parameters: {}", e),
            })
        }
    };

    let file_path = Path::new(&params.file_path);

    // Verify file exists
    if !file_path.exists() {
        return Err(JobError::ProcessingFailed {
            reason: format!("File does not exist: {}", params.file_path),
        });
    }

    println!("processing file: {}", params.file_path);

    // Read file metadata
    let metadata = match fs::metadata(file_path) {
        Ok(m) => m,
        Err(e) => {
            return Err(JobError::ProcessingFailed {
                reason: format!("Failed to read file metadata: {}", e),
            })
        }
    };

    let file_size = metadata.len();
    println!("file size: {} bytes", file_size);

    // Step 1: Create media blob in database
    let media_blob_id =
        match blob_data::create_media_blob_from_file(&params.file_path, file_size).await {
            Ok(id) => id,
            Err(e) => {
                return Err(JobError::ProcessingFailed {
                    reason: format!("Failed to create media blob: {}", e),
                })
            }
        };
    println!("created media blob: {}", media_blob_id);

    // Step 2: Import audio file (extracts metadata and creates song)
    let mut song_id = None;
    let mut artist_id = None;
    let mut album_id = None;
    let mut metadata_extracted = false;

    if params.extract_metadata {
        match scanner::import_audio_file(&media_blob_id, file_path).await {
            crate::GrimoireResponse {
                success: true,
                data: Some(import_result),
                ..
            } => {
                song_id = Some(import_result.song_id);
                artist_id = import_result.artist_id;
                album_id = import_result.album_id;
                metadata_extracted = import_result.metadata_extracted;
                println!("metadata extracted successfully");
            }
            response => {
                let error_msg = if !response.errors.is_empty() {
                    response.errors[0].detail.clone()
                } else {
                    response.message
                };
                eprintln!("metadata extraction failed: {}", error_msg);
            }
        }
    }

    // Step 3: Generate thumbnail if requested
    let thumbnail_generated = if params.generate_thumbnail {
        match blob_data::create_audio_thumbnail_blob(&media_blob_id, &params.file_path).await {
            Ok(thumbnail_blob_id) => {
                println!("thumbnail generated as blob: {}", thumbnail_blob_id);
                true
            }
            Err(e) => {
                eprintln!("thumbnail generation failed: {}", e);
                false
            }
        }
    } else {
        false
    };

    // Step 4: Generate waveform if requested
    let waveform_generated = if params.generate_waveform {
        match blob_data::create_audio_waveform_blob(&media_blob_id, &params.file_path).await {
            Ok(waveform_blob_id) => {
                println!("waveform generated as blob: {}", waveform_blob_id);
                true
            }
            Err(e) => {
                eprintln!("waveform generation failed: {}", e);
                false
            }
        }
    } else {
        false
    };

    let result = ProcessFileResult {
        media_blob_id,
        song_id,
        artist_id,
        album_id,
        metadata_extracted,
        thumbnail_generated,
        waveform_generated,
    };

    println!("file processing complete");

    Ok(Some(serde_json::to_value(result).map_err(|e| {
        JobError::ProcessingFailed {
            reason: format!("Failed to serialize result: {}", e),
        }
    })?))
}

// Stub job processors - these job types are not currently used
// Metadata extraction, thumbnail, and waveform generation are handled in process_file_job
async fn process_extract_metadata_job(_job: &Job) -> Result<Option<Value>, JobError> {
    Err(JobError::ProcessingFailed {
        reason: "ExtractMetadata job type is deprecated - use ProcessFile instead".to_string(),
    })
}

async fn process_generate_thumbnail_job(_job: &Job) -> Result<Option<Value>, JobError> {
    Err(JobError::ProcessingFailed {
        reason: "GenerateThumbnail job type is deprecated - use ProcessFile instead".to_string(),
    })
}

async fn process_generate_waveform_job(_job: &Job) -> Result<Option<Value>, JobError> {
    Err(JobError::ProcessingFailed {
        reason: "GenerateWaveform job type is deprecated - use ProcessFile instead".to_string(),
    })
}

/// Simple job processor that processes one job at a time
pub async fn run_job_processor() -> GrimoireResponse<()> {
    loop {
        let next_job_response = get_next_pending_job().await;
        let next_job = match next_job_response.data {
            Some(job_opt) => job_opt,
            None => {
                return GrimoireResponse::failure(
                    "Failed to get next pending job",
                    next_job_response.errors,
                )
            }
        };

        match next_job {
            Some(job) => {
                println!("processing job: {} ({})", job.id, job.job_type);
                let process_response = process_job(job).await;
                if process_response.success {
                    if let Some(result) = process_response.data {
                        println!(
                            "job completed: {} in {}ms",
                            result.job.id, result.processing_time_ms
                        );
                    }
                } else {
                    eprintln!("job failed: {}", process_response.message);
                }
            }
            None => {
                // No jobs available, wait a bit before checking again
                tokio::time::sleep(Duration::from_secs(5)).await;
            }
        }
    }
}

/// Run the job processor once - process all pending jobs and then exit
pub async fn run_job_processor_once(max_jobs: u32) -> GrimoireResponse<()> {
    let mut processed_count = 0;

    loop {
        let next_job_response = get_next_pending_job().await;
        let next_job = match next_job_response.data {
            Some(job_opt) => job_opt,
            None => {
                return GrimoireResponse::failure(
                    "Failed to get next pending job",
                    next_job_response.errors,
                )
            }
        };

        match next_job {
            Some(job) => {
                println!("processing job: {} ({})", job.id, job.job_type);
                let process_response = process_job(job).await;
                if process_response.success {
                    if let Some(result) = process_response.data {
                        println!(
                            "job completed: {} in {}ms",
                            result.job.id, result.processing_time_ms
                        );
                        processed_count += 1;
                    }
                } else {
                    eprintln!("job failed: {}", process_response.message);
                    processed_count += 1;
                }

                // Check if we've hit the max jobs limit
                if max_jobs > 0 && processed_count >= max_jobs {
                    println!("reached maximum job limit ({}), stopping", max_jobs);
                    break;
                }
            }
            None => {
                // No more jobs available, exit
                println!("no more pending jobs, stopping");
                break;
            }
        }
    }

    GrimoireResponse::success("Job processor completed", ())
}
