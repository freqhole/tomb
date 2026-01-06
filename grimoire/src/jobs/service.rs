//! Job processing service for unified background task processing
//! Handles job queue management, execution, and session-based batch operations

use std::time::{Duration, Instant};

use serde_json::Value;
use sqlx::Row;

use crate::database;
use crate::error::GrimoireResult;

use super::models::{
    CreateJobRequest, CreateJobSessionRequest, Job, JobError, JobProgress, JobResult, JobSession,
    JobStatus, JobType, ProcessFileParams, ProcessFileResult, QueueStats, ScanDirectoryParams,
    ScanDirectoryResult, SessionStatus,
};

/// Create a new job session for batch operations
pub async fn create_job_session(request: CreateJobSessionRequest) -> Result<JobSession, JobError> {
    let pool = database::connect().await?;

    let job_type_str = serde_json::to_string(&request.job_type)?;
    let job_type_str = job_type_str.trim_matches('"'); // Remove quotes from serialized enum

    let batch_size = request.batch_size.unwrap_or(100) as i64;
    let progress = JobProgress::new(0, 0);
    let progress_json = serde_json::to_string(&progress)?;

    let session = sqlx::query_as::<_, JobSession>(
        r#"
        INSERT INTO job_sessionz (job_type, status, progress, batch_size, created_by)
        VALUES (?, 'Active', ?, ?, ?)
        RETURNING rowid, id, job_type, status, progress, last_checkpoint, batch_size,
                  created_at, updated_at, created_by
        "#,
    )
    .bind(job_type_str)
    .bind(progress_json)
    .bind(batch_size)
    .bind(request.created_by)
    .fetch_one(&pool)
    .await?;

    Ok(session)
}

/// Create a new job in the queue
pub async fn create_job(request: CreateJobRequest) -> Result<Job, JobError> {
    let pool = database::connect().await?;

    let job_type_str = serde_json::to_string(&request.job_type)?;
    let job_type_str = job_type_str.trim_matches('"'); // Remove quotes from serialized enum

    let parameters_json = serde_json::to_string(&request.parameters)?;
    let max_retries = request.max_retries.unwrap_or(3);
    let scheduled_at = request.scheduled_at.unwrap_or_else(|| {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64
    });

    let job = sqlx::query_as::<_, Job>(
        r#"
        INSERT INTO jobz (session_id, job_type, status, parameters, max_retries, scheduled_at, created_by)
        VALUES (?, ?, 'Pending', ?, ?, ?, ?)
        RETURNING rowid, id, session_id, job_type, status, parameters, result, retry_count,
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
    .await?;

    Ok(job)
}

/// Get a job by ID
pub async fn get_job(job_id: &str) -> Result<Job, JobError> {
    let pool = database::connect().await?;

    let job = sqlx::query_as::<_, Job>(
        r#"
        SELECT rowid, id, session_id, job_type, status, parameters, result, retry_count,
               max_retries, scheduled_at, started_at, completed_at, error_message, created_by
        FROM jobz WHERE id = ?
        "#,
    )
    .bind(job_id)
    .fetch_optional(&pool)
    .await?;

    job.ok_or(JobError::JobNotFound {
        id: job_id.to_string(),
    })
}

/// Get a job session by ID
pub async fn get_job_session(session_id: &str) -> Result<JobSession, JobError> {
    let pool = database::connect().await?;

    let session = sqlx::query_as::<_, JobSession>(
        r#"
        SELECT rowid, id, job_type, status, progress, last_checkpoint, batch_size,
               created_at, updated_at, created_by
        FROM job_sessionz WHERE id = ?
        "#,
    )
    .bind(session_id)
    .fetch_optional(&pool)
    .await?;

    session.ok_or(JobError::SessionNotFound {
        id: session_id.to_string(),
    })
}

/// Get the next pending job to process
pub async fn get_next_pending_job() -> Result<Option<Job>, JobError> {
    let pool = database::connect().await?;

    let job = sqlx::query_as::<_, Job>(
        r#"
        SELECT rowid, id, session_id, job_type, status, parameters, result, retry_count,
               max_retries, scheduled_at, started_at, completed_at, error_message, created_by
        FROM jobz
        WHERE status = 'Pending' AND scheduled_at <= unixepoch()
        ORDER BY scheduled_at ASC
        LIMIT 1
        "#,
    )
    .fetch_optional(&pool)
    .await?;

    Ok(job)
}

/// Mark a job as started
pub async fn mark_job_started(job_id: &str) -> Result<Job, JobError> {
    let pool = database::connect().await?;

    let job = sqlx::query_as::<_, Job>(
        r#"
        UPDATE jobz
        SET status = 'Running', started_at = unixepoch()
        WHERE id = ?
        RETURNING rowid, id, session_id, job_type, status, parameters, result, retry_count,
                  max_retries, scheduled_at, started_at, completed_at, error_message, created_by
        "#,
    )
    .bind(job_id)
    .fetch_optional(&pool)
    .await?;

    job.ok_or(JobError::JobNotFound {
        id: job_id.to_string(),
    })
}

/// Mark a job as completed with result
pub async fn mark_job_completed(job_id: &str, result: Option<Value>) -> Result<Job, JobError> {
    let pool = database::connect().await?;

    let result_json = match result {
        Some(r) => Some(serde_json::to_string(&r)?),
        None => None,
    };

    let job = sqlx::query_as::<_, Job>(
        r#"
        UPDATE jobz
        SET status = 'Completed', completed_at = unixepoch(), result = ?
        WHERE id = ?
        RETURNING rowid, id, session_id, job_type, status, parameters, result, retry_count,
                  max_retries, scheduled_at, started_at, completed_at, error_message, created_by
        "#,
    )
    .bind(result_json)
    .bind(job_id)
    .fetch_optional(&pool)
    .await?;

    job.ok_or(JobError::JobNotFound {
        id: job_id.to_string(),
    })
}

/// Mark a job as failed
pub async fn mark_job_failed(job_id: &str, error_message: &str) -> Result<Job, JobError> {
    let pool = database::connect().await?;

    // First get the current job to check retry count
    let current_job = get_job(job_id).await?;

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

    let job = sqlx::query_as::<_, Job>(
        r#"
        UPDATE jobz
        SET status = ?, retry_count = ?, error_message = ?, scheduled_at = ?,
            completed_at = CASE WHEN ? = 'Failed' THEN unixepoch() ELSE completed_at END
        WHERE id = ?
        RETURNING rowid, id, session_id, job_type, status, parameters, result, retry_count,
                  max_retries, scheduled_at, started_at, completed_at, error_message, created_by
        "#,
    )
    .bind(&status)
    .bind(new_retry_count)
    .bind(error_message)
    .bind(scheduled_at)
    .bind(&status)
    .bind(job_id)
    .fetch_optional(&pool)
    .await?;

    job.ok_or(JobError::JobNotFound {
        id: job_id.to_string(),
    })
}

/// Cancel a job
pub async fn cancel_job(job_id: &str) -> Result<Job, JobError> {
    let pool = database::connect().await?;

    let job = sqlx::query_as::<_, Job>(
        r#"
        UPDATE jobz
        SET status = 'Cancelled', completed_at = unixepoch()
        WHERE id = ? AND status IN ('Pending', 'Running')
        RETURNING rowid, id, session_id, job_type, status, parameters, result, retry_count,
                  max_retries, scheduled_at, started_at, completed_at, error_message, created_by
        "#,
    )
    .bind(job_id)
    .fetch_optional(&pool)
    .await?;

    job.ok_or(JobError::JobNotFound {
        id: job_id.to_string(),
    })
}

/// Update job session progress
pub async fn update_session_progress(
    session_id: &str,
    progress: JobProgress,
    checkpoint: Option<String>,
) -> Result<JobSession, JobError> {
    let pool = database::connect().await?;

    let progress_json = serde_json::to_string(&progress)?;

    let session = sqlx::query_as::<_, JobSession>(
        r#"
        UPDATE job_sessionz
        SET progress = ?, last_checkpoint = ?
        WHERE id = ?
        RETURNING rowid, id, job_type, status, progress, last_checkpoint, batch_size,
                  created_at, updated_at, created_by
        "#,
    )
    .bind(progress_json)
    .bind(checkpoint)
    .bind(session_id)
    .fetch_optional(&pool)
    .await?;

    session.ok_or(JobError::SessionNotFound {
        id: session_id.to_string(),
    })
}

/// Complete a job session
pub async fn complete_session(session_id: &str) -> Result<JobSession, JobError> {
    let pool = database::connect().await?;

    let session = sqlx::query_as::<_, JobSession>(
        r#"
        UPDATE job_sessionz
        SET status = 'Completed'
        WHERE id = ?
        RETURNING rowid, id, job_type, status, progress, last_checkpoint, batch_size,
                  created_at, updated_at, created_by
        "#,
    )
    .bind(session_id)
    .fetch_optional(&pool)
    .await?;

    session.ok_or(JobError::SessionNotFound {
        id: session_id.to_string(),
    })
}

/// Fail a job session
pub async fn fail_session(session_id: &str) -> Result<JobSession, JobError> {
    let pool = database::connect().await?;

    let session = sqlx::query_as::<_, JobSession>(
        r#"
        UPDATE job_sessionz
        SET status = 'Failed'
        WHERE id = ?
        RETURNING rowid, id, job_type, status, progress, last_checkpoint, batch_size,
                  created_at, updated_at, created_by
        "#,
    )
    .bind(session_id)
    .fetch_optional(&pool)
    .await?;

    session.ok_or(JobError::SessionNotFound {
        id: session_id.to_string(),
    })
}

/// Get queue statistics
pub async fn get_queue_stats() -> Result<QueueStats, JobError> {
    let pool = database::connect().await?;

    let row = sqlx::query(
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
    .await?;

    let active_sessions_row =
        sqlx::query("SELECT COUNT(*) as active_sessions FROM job_sessionz WHERE status = 'Active'")
            .fetch_one(&pool)
            .await?;

    Ok(QueueStats {
        pending_jobs: row.get("pending_jobs"),
        running_jobs: row.get("running_jobs"),
        completed_jobs: row.get("completed_jobs"),
        failed_jobs: row.get("failed_jobs"),
        active_sessions: active_sessions_row.get("active_sessions"),
    })
}

/// List jobs with optional filtering
pub async fn list_jobs(
    session_id: Option<&str>,
    status: Option<JobStatus>,
    limit: Option<u32>,
    offset: Option<u32>,
) -> Result<Vec<Job>, JobError> {
    let pool = database::connect().await?;

    let mut query_str = String::from(
        r#"
        SELECT rowid, id, session_id, job_type, status, parameters, result, retry_count,
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
        let status_str = serde_json::to_string(&stat)?.trim_matches('"').to_string();
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

    let jobs = query.fetch_all(&pool).await?;
    Ok(jobs)
}

/// Process a single job (to be called by job processor)
pub async fn process_job(job: Job) -> Result<JobResult, JobError> {
    let start_time = Instant::now();

    // Mark job as started
    let job = mark_job_started(&job.id).await?;

    // Process based on job type
    let result = match job.job_type()? {
        JobType::ScanDirectory => process_scan_directory_job(&job).await,
        JobType::ProcessFile => process_file_job(&job).await,
        JobType::ExtractMetadata => process_extract_metadata_job(&job).await,
        JobType::GenerateThumbnail => process_generate_thumbnail_job(&job).await,
        JobType::GenerateWaveform => process_generate_waveform_job(&job).await,
    };

    let processing_time = start_time.elapsed().as_millis() as u64;

    match result {
        Ok(output) => {
            let completed_job = mark_job_completed(&job.id, output).await?;
            Ok(JobResult {
                job: completed_job,
                output: None, // Could include the output here if needed
                processing_time_ms: processing_time,
            })
        }
        Err(error) => {
            let _failed_job = mark_job_failed(&job.id, &error.to_string()).await?;
            Err(error)
        }
    }
}

// Job processing functions (stubs for now - to be implemented with actual logic)

async fn process_scan_directory_job(job: &Job) -> Result<Option<Value>, JobError> {
    use walkdir::WalkDir;

    // Parse job parameters
    let params: ScanDirectoryParams =
        serde_json::from_str(&job.parameters).map_err(|e| JobError::ProcessingFailed {
            reason: format!("Invalid parameters: {}", e),
        })?;

    // Default audio extensions if none provided
    let audio_extensions = params.file_extensions.unwrap_or_else(|| {
        vec![
            "mp3".to_string(),
            "flac".to_string(),
            "wav".to_string(),
            "m4a".to_string(),
            "ogg".to_string(),
            "aac".to_string(),
            "wma".to_string(),
            "aiff".to_string(),
            "aif".to_string(),
        ]
    });

    println!("scanning directory: {}", params.directory_path);
    println!("recursive: {}", params.recursive);
    if let Some(depth) = params.max_depth {
        println!("max depth: {}", depth);
    }

    // Build walkdir iterator
    let mut walker = WalkDir::new(&params.directory_path);
    if !params.recursive {
        walker = walker.max_depth(1);
    } else if let Some(depth) = params.max_depth {
        walker = walker.max_depth(depth as usize);
    }

    // Collect all audio files
    let mut audio_files = Vec::new();
    for entry in walker {
        let entry = entry.map_err(|e| JobError::ProcessingFailed {
            reason: format!("Failed to read directory entry: {}", e),
        })?;

        if !entry.file_type().is_file() {
            continue;
        }

        let path = entry.path();
        if let Some(extension) = path.extension() {
            if let Some(ext_str) = extension.to_str() {
                if audio_extensions
                    .iter()
                    .any(|ae| ae.eq_ignore_ascii_case(ext_str))
                {
                    audio_files.push(path.to_path_buf());
                }
            }
        }
    }

    println!("found {} audio files", audio_files.len());

    // Create ProcessFile jobs for each audio file
    let mut created_jobs = 0;
    let total_files = audio_files.len() as u64;
    for file_path in audio_files {
        let file_path_str = file_path.to_string_lossy().to_string();

        // Create ProcessFile job parameters
        let process_params = ProcessFileParams {
            file_path: file_path_str,
            extract_metadata: true,
            generate_thumbnail: true,
            generate_waveform: true, // Enable for testing
        };

        let job_request = CreateJobRequest {
            job_type: JobType::ProcessFile,
            session_id: job.session_id.clone(),
            parameters: serde_json::to_value(process_params).map_err(|e| {
                JobError::ProcessingFailed {
                    reason: format!("Failed to serialize job parameters: {}", e),
                }
            })?,
            max_retries: Some(3),
            scheduled_at: None,
            created_by: Some("scan_directory_job".to_string()),
        };

        match create_job(job_request).await {
            Ok(_) => {
                created_jobs += 1;
            }
            Err(e) => {
                eprintln!(
                    "Failed to create ProcessFile job for {}: {}",
                    file_path.display(),
                    e
                );
            }
        }
    }

    // Update session progress if we have a session
    if let Some(session_id) = &job.session_id {
        let progress = JobProgress {
            current: created_jobs,
            total: total_files,
            message: Some(format!("Created {} ProcessFile jobs", created_jobs)),
        };

        if let Err(e) = update_session_progress(session_id, progress, None).await {
            eprintln!("Failed to update session progress: {}", e);
        }
    }

    // Return scan results
    let result = ScanDirectoryResult {
        files_discovered: total_files,
        jobs_created: created_jobs,
        errors: Vec::new(),
    };

    Ok(Some(serde_json::to_value(result).map_err(|e| {
        JobError::ProcessingFailed {
            reason: format!("Failed to serialize result: {}", e),
        }
    })?))
}

async fn process_file_job(job: &Job) -> Result<Option<Value>, JobError> {
    use std::fs;
    use std::path::Path;

    // Parse job parameters
    let params: ProcessFileParams =
        serde_json::from_str(&job.parameters).map_err(|e| JobError::ProcessingFailed {
            reason: format!("Invalid parameters: {}", e),
        })?;

    let file_path = Path::new(&params.file_path);

    // Verify file exists
    if !file_path.exists() {
        return Err(JobError::ProcessingFailed {
            reason: format!("File does not exist: {}", params.file_path),
        });
    }

    println!("processing file: {}", params.file_path);

    // Read file metadata
    let metadata = fs::metadata(file_path).map_err(|e| JobError::ProcessingFailed {
        reason: format!("Failed to read file metadata: {}", e),
    })?;

    let file_size = metadata.len();
    println!("file size: {} bytes", file_size);

    // Step 1: Create media blob in database with local_path
    let media_blob_id = create_media_blob_from_file(&params.file_path, file_size).await?;
    println!("created media blob: {}", media_blob_id);

    // Step 2: Extract metadata using lofty
    let mut song_id = None;
    let mut artist_id = None;
    let mut album_id = None;
    let mut metadata_extracted = false;

    if params.extract_metadata {
        match extract_and_store_metadata(&media_blob_id, file_path, file_size).await {
            Ok((s_id, a_id, al_id)) => {
                song_id = Some(s_id);
                artist_id = a_id;
                album_id = al_id;
                metadata_extracted = true;
                println!("metadata extracted successfully");
            }
            Err(e) => {
                eprintln!("metadata extraction failed: {}", e);
            }
        }
    }

    // Step 3: Generate thumbnail if requested
    let thumbnail_generated = if params.generate_thumbnail {
        match generate_audio_thumbnail(&media_blob_id).await {
            Ok(_) => {
                println!("thumbnail generated");
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
        match generate_audio_waveform(&media_blob_id).await {
            Ok(_) => {
                println!("waveform generated");
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

async fn process_extract_metadata_job(_job: &Job) -> Result<Option<Value>, JobError> {
    // TODO: Implement metadata extraction logic
    Err(JobError::ProcessingFailed {
        reason: "ExtractMetadata not yet implemented".to_string(),
    })
}

async fn process_generate_thumbnail_job(_job: &Job) -> Result<Option<Value>, JobError> {
    // TODO: Implement thumbnail generation logic
    Err(JobError::ProcessingFailed {
        reason: "GenerateThumbnail not yet implemented".to_string(),
    })
}

async fn process_generate_waveform_job(_job: &Job) -> Result<Option<Value>, JobError> {
    // TODO: Implement waveform generation logic
    Err(JobError::ProcessingFailed {
        reason: "GenerateWaveform not yet implemented".to_string(),
    })
}

/// Simple job processor that processes one job at a time
pub async fn run_job_processor() -> Result<(), JobError> {
    loop {
        match get_next_pending_job().await? {
            Some(job) => {
                println!("processing job: {} ({})", job.id, job.job_type);
                match process_job(job).await {
                    Ok(result) => {
                        println!(
                            "job completed: {} in {}ms",
                            result.job.id, result.processing_time_ms
                        );
                    }
                    Err(error) => {
                        eprintln!("job failed: {}", error);
                    }
                }
            }
            None => {
                // No jobs available, wait a bit before checking again
                tokio::time::sleep(Duration::from_secs(5)).await;
            }
        }
    }
}

// Helper functions for file processing

async fn create_media_blob_from_file(file_path: &str, file_size: u64) -> Result<String, JobError> {
    use crate::media_blobz;
    use std::path::Path;

    let file_name = Path::new(file_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown");

    let mime_type = mime_guess::from_path(file_path)
        .first_or_octet_stream()
        .to_string();

    // Calculate SHA256 hash of the file path (not contents for performance)
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(file_path.as_bytes());
    let sha256 = format!("{:x}", hasher.finalize());

    let metadata = serde_json::json!({
        "filename": file_name,
        "original_path": file_path
    });

    let request = media_blobz::CreateMediaBlobRequest {
        sha256,
        size: Some(file_size as i64),
        mime: Some(mime_type),
        source_client_id: Some("job_processor".to_string()),
        local_path: Some(file_path.to_string()),
        parent_blob_id: None,
        blob_type: Some("original".to_string()),
        metadata,
        created_by: Some("job_processor".to_string()),
    };

    let media_blob =
        media_blobz::create_media_blob(request)
            .await
            .map_err(|e| JobError::ProcessingFailed {
                reason: format!("Failed to create media blob: {}", e),
            })?;

    Ok(media_blob.id)
}

async fn extract_and_store_metadata(
    media_blob_id: &str,
    file_path: &std::path::Path,
    file_size: u64,
) -> Result<(String, Option<String>, Option<String>), JobError> {
    use crate::music::crud::{add_song, ImportSongRequest};
    use lofty::{Accessor, AudioFile, ItemValue, Probe, TaggedFileExt};
    use std::collections::HashMap;

    // Parse audio file with lofty with error handling
    let tagged_file = match Probe::open(file_path).and_then(|p| p.read()) {
        Ok(file) => file,
        Err(e) => {
            println!(
                "warning: could not read metadata from {:?}: {}",
                file_path, e
            );
            // Still try to create a basic song record with filename
            return create_basic_song_record(media_blob_id, file_path, file_size).await;
        }
    };

    // Extract properties with fallbacks
    let properties = tagged_file.properties();
    let duration_ms = properties.duration().as_millis() as i64;
    let _bitrate = properties.audio_bitrate().unwrap_or(0);
    let _sample_rate = properties.sample_rate().unwrap_or(0);

    // Extract all tag data for comprehensive parsing
    let mut tags_map = HashMap::new();
    if let Some(tag) = tagged_file.primary_tag() {
        for item in tag.items() {
            let key = format!("{:?}", item.key());
            let value_str = match item.value() {
                ItemValue::Text(s) | ItemValue::Locator(s) => s.clone(),
                ItemValue::Binary(_) => continue, // Skip binary data
            };

            if !value_str.trim().is_empty() {
                tags_map.insert(key, value_str.trim().to_string());
            }
        }
    }

    // Helper function to get tag value case-insensitively with fallbacks
    let get_tag = |preferred: &str, fallbacks: &[&str]| -> Option<String> {
        // Try preferred key first
        if let Some(value) = tags_map.get(preferred) {
            if !value.is_empty() {
                return Some(value.clone());
            }
        }

        // Try fallback keys
        for fallback in fallbacks {
            if let Some(value) = tags_map.get(*fallback) {
                if !value.is_empty() {
                    return Some(value.clone());
                }
            }
        }

        // Try case-insensitive search
        let all_keys = [&[preferred], fallbacks].concat();
        for search_key in all_keys {
            let key_lower = search_key.to_lowercase();
            for (k, v) in tags_map.iter() {
                if k.to_lowercase() == key_lower && !v.is_empty() {
                    return Some(v.clone());
                }
            }
        }

        None
    };

    // Parse numeric values safely with fraction handling
    let parse_track_number =
        |s: &str| -> Option<i64> { s.split('/').next()?.trim().parse::<i64>().ok() };

    // Extract standardized fields with comprehensive fallbacks
    let title = get_tag("TrackTitle", &["Title", "TITLE", "TIT2"]).unwrap_or_else(|| {
        file_path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("Unknown Title")
            .to_string()
    });

    let artist_name = get_tag(
        "TrackArtist",
        &["Artist", "ARTIST", "TPE1", "AlbumArtist", "TPE2"],
    )
    .unwrap_or_else(|| "Unknown Artist".to_string());

    let album_title = get_tag("AlbumTitle", &["Album", "ALBUM", "TALB"]);

    let track_number =
        get_tag("TrackNumber", &["TRCK", "Track"]).and_then(|s| parse_track_number(&s));

    let disc_number =
        get_tag("DiscNumber", &["TPOS", "Disc", "PartOfSet"]).and_then(|s| parse_track_number(&s));

    let year = get_tag("RecordingDate", &["Year", "DATE", "TDRC", "TYER"])
        .and_then(|s| s.split('-').next()?.trim().parse::<i64>().ok());

    let genre = get_tag("Genre", &["GENRE", "TCON"]);

    // Use existing import function to create song with metadata
    let import_request = ImportSongRequest {
        media_blob_id: media_blob_id.to_string(),
        title,
        artist_name: Some(artist_name),
        album_title,
        genre_name: genre,
        track_number,
        disc_number,
        duration: Some(duration_ms),
        year,
        bpm: None,
        key_signature: None,
        created_by: Some("job_processor".to_string()),
    };

    let result = add_song(import_request)
        .await
        .map_err(|e| JobError::ProcessingFailed {
            reason: format!("Failed to import song: {}", e),
        })?;

    Ok((
        result.song.id,
        result.artist.map(|a| a.id),
        result.album.map(|a| a.id),
    ))
}

// Helper function to create basic song record when metadata extraction fails
async fn create_basic_song_record(
    media_blob_id: &str,
    file_path: &std::path::Path,
    file_size: u64,
) -> Result<(String, Option<String>, Option<String>), JobError> {
    use crate::music::crud::{add_song, ImportSongRequest};

    let title = file_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Unknown Title")
        .to_string();

    let import_request = ImportSongRequest {
        media_blob_id: media_blob_id.to_string(),
        title,
        artist_name: Some("Unknown Artist".to_string()),
        album_title: None,
        genre_name: None,
        track_number: None,
        disc_number: None,
        duration: None,
        year: None,
        bpm: None,
        key_signature: None,
        created_by: Some("job_processor".to_string()),
    };

    let result = add_song(import_request)
        .await
        .map_err(|e| JobError::ProcessingFailed {
            reason: format!("Failed to create basic song record: {}", e),
        })?;

    Ok((
        result.song.id,
        result.artist.map(|a| a.id),
        result.album.map(|a| a.id),
    ))
}

async fn generate_audio_thumbnail(media_blob_id: &str) -> Result<(), JobError> {
    // Get media blob info to get the file path
    let media_blob = crate::media_blobz::get_media_blob(media_blob_id)
        .await
        .map_err(|e| JobError::ProcessingFailed {
            reason: format!("Failed to get media blob: {}", e),
        })?;

    let file_path = media_blob
        .local_path
        .ok_or_else(|| JobError::ProcessingFailed {
            reason: "Media blob has no local path".to_string(),
        })?;

    // Try to extract embedded album art first using ffmpeg
    match extract_album_art_with_ffmpeg(&file_path, media_blob_id).await {
        Ok(_) => {
            println!("extracted album art from audio file");
            return Ok(());
        }
        Err(e) => {
            println!("embedded album art extraction failed: {}", e);
        }
    }

    // Try to find album art image files in the same directory
    match find_album_art_in_directory(&file_path, media_blob_id).await {
        Ok(_) => {
            println!("found album art image file in directory");
            return Ok(());
        }
        Err(e) => {
            println!("directory album art search failed: {}", e);
        }
    }

    // If no album art found, generate a simple placeholder thumbnail
    generate_placeholder_thumbnail(media_blob_id).await
}

async fn extract_album_art_with_ffmpeg(
    input_path: &str,
    media_blob_id: &str,
) -> Result<(), JobError> {
    use sha2::{Digest, Sha256};

    // Create output directory if it doesn't exist
    let output_dir = "data/thumbnails";
    tokio::fs::create_dir_all(output_dir)
        .await
        .map_err(|e| JobError::ProcessingFailed {
            reason: format!("Failed to create thumbnail directory: {}", e),
        })?;

    // Generate output filename
    let mut hasher = Sha256::new();
    hasher.update(media_blob_id.as_bytes());
    let hash = format!("{:x}", hasher.finalize());
    let output_path = format!("{}/thumb_{}.jpg", output_dir, &hash[..16]);

    // Use ffmpeg to extract album art
    let mut cmd = tokio::process::Command::new("ffmpeg");
    cmd.args([
        "-i",
        input_path,
        "-an", // no audio
        "-vcodec",
        "mjpeg",
        "-vframes",
        "1", // extract first frame
        "-q:v",
        "2",  // high quality
        "-y", // overwrite output
        &output_path,
    ])
    .stdout(std::process::Stdio::null())
    .stderr(std::process::Stdio::null());

    let output = tokio::time::timeout(tokio::time::Duration::from_secs(30), cmd.output())
        .await
        .map_err(|_| JobError::ProcessingFailed {
            reason: "Album art extraction timed out".to_string(),
        })?
        .map_err(|e| JobError::ProcessingFailed {
            reason: format!("Failed to run ffmpeg: {}", e),
        })?;

    if !output.status.success() {
        return Err(JobError::ProcessingFailed {
            reason: "ffmpeg failed to extract album art".to_string(),
        });
    }

    // Check if output file was created and has content
    let metadata =
        tokio::fs::metadata(&output_path)
            .await
            .map_err(|_| JobError::ProcessingFailed {
                reason: "No album art found in audio file".to_string(),
            })?;

    if metadata.len() == 0 {
        tokio::fs::remove_file(&output_path).await.ok();
        return Err(JobError::ProcessingFailed {
            reason: "Extracted album art file is empty".to_string(),
        });
    }

    // Create media blob for the thumbnail
    let thumbnail_metadata = serde_json::json!({
        "type": "album_art",
        "source_blob_id": media_blob_id,
        "extracted_with": "ffmpeg"
    });

    let create_request = crate::media_blobz::CreateMediaBlobRequest {
        sha256: hash,
        size: Some(metadata.len() as i64),
        mime: Some("image/jpeg".to_string()),
        source_client_id: Some("job_processor".to_string()),
        local_path: Some(output_path),
        parent_blob_id: Some(media_blob_id.to_string()),
        blob_type: Some("thumbnail".to_string()),
        metadata: thumbnail_metadata,
        created_by: Some("job_processor".to_string()),
    };

    crate::media_blobz::create_media_blob(create_request)
        .await
        .map_err(|e| JobError::ProcessingFailed {
            reason: format!("Failed to create thumbnail blob: {}", e),
        })?;

    Ok(())
}

async fn find_album_art_in_directory(
    audio_file_path: &str,
    media_blob_id: &str,
) -> Result<(), JobError> {
    use std::path::Path;

    let audio_path = Path::new(audio_file_path);
    let parent_dir = audio_path
        .parent()
        .ok_or_else(|| JobError::ProcessingFailed {
            reason: "Cannot get parent directory of audio file".to_string(),
        })?;

    // Common album art filenames to search for
    let art_filenames = [
        "folder.jpg",
        "folder.jpeg",
        "folder.png",
        "cover.jpg",
        "cover.jpeg",
        "cover.png",
        "album.jpg",
        "album.jpeg",
        "album.png",
        "artwork.jpg",
        "artwork.jpeg",
        "artwork.png",
        "front.jpg",
        "front.jpeg",
        "front.png",
    ];

    // Look for image files in the directory
    for filename in &art_filenames {
        let art_path = parent_dir.join(filename);
        if art_path.exists() {
            return copy_album_art_file(&art_path, media_blob_id).await;
        }
    }

    // If no specific art files found, look for any image files
    let dir_entries =
        tokio::fs::read_dir(parent_dir)
            .await
            .map_err(|e| JobError::ProcessingFailed {
                reason: format!("Failed to read directory: {}", e),
            })?;

    let mut entries = vec![];
    let mut dir_stream = dir_entries;
    while let Ok(Some(entry)) = dir_stream.next_entry().await {
        entries.push(entry);
    }

    for entry in entries {
        let path = entry.path();
        if let Some(extension) = path.extension() {
            if let Some(ext_str) = extension.to_str() {
                let ext_lower = ext_str.to_lowercase();
                if matches!(ext_lower.as_str(), "jpg" | "jpeg" | "png" | "webp") {
                    return copy_album_art_file(&path, media_blob_id).await;
                }
            }
        }
    }

    Err(JobError::ProcessingFailed {
        reason: "No album art image files found in directory".to_string(),
    })
}

async fn copy_album_art_file(
    image_path: &std::path::Path,
    media_blob_id: &str,
) -> Result<(), JobError> {
    use sha2::{Digest, Sha256};

    // Create output directory
    let output_dir = "data/thumbnails";
    tokio::fs::create_dir_all(output_dir)
        .await
        .map_err(|e| JobError::ProcessingFailed {
            reason: format!("Failed to create thumbnail directory: {}", e),
        })?;

    // Generate output filename
    let mut hasher = Sha256::new();
    hasher.update(media_blob_id.as_bytes());
    let hash = format!("{:x}", hasher.finalize());
    let extension = image_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("jpg");
    let output_path = format!("{}/art_{}.{}", output_dir, &hash[..16], extension);

    // Copy the image file
    tokio::fs::copy(image_path, &output_path)
        .await
        .map_err(|e| JobError::ProcessingFailed {
            reason: format!("Failed to copy album art file: {}", e),
        })?;

    let metadata =
        tokio::fs::metadata(&output_path)
            .await
            .map_err(|e| JobError::ProcessingFailed {
                reason: format!("Failed to get copied file metadata: {}", e),
            })?;

    // Determine MIME type
    let mime_type = match extension {
        "png" => "image/png",
        "webp" => "image/webp",
        _ => "image/jpeg",
    };

    // Create media blob for the album art
    let art_metadata = serde_json::json!({
        "type": "album_art",
        "source_blob_id": media_blob_id,
        "source_file": image_path.to_string_lossy(),
        "method": "directory_copy"
    });

    let create_request = crate::media_blobz::CreateMediaBlobRequest {
        sha256: hash,
        size: Some(metadata.len() as i64),
        mime: Some(mime_type.to_string()),
        source_client_id: Some("job_processor".to_string()),
        local_path: Some(output_path),
        parent_blob_id: Some(media_blob_id.to_string()),
        blob_type: Some("thumbnail".to_string()),
        metadata: art_metadata,
        created_by: Some("job_processor".to_string()),
    };

    crate::media_blobz::create_media_blob(create_request)
        .await
        .map_err(|e| JobError::ProcessingFailed {
            reason: format!("Failed to create album art blob: {}", e),
        })?;

    Ok(())
}

async fn generate_placeholder_thumbnail(media_blob_id: &str) -> Result<(), JobError> {
    use sha2::{Digest, Sha256};

    // For now, just create a simple text-based placeholder
    // In a real implementation, you might generate a default album cover image
    let output_dir = "data/thumbnails";
    tokio::fs::create_dir_all(output_dir)
        .await
        .map_err(|e| JobError::ProcessingFailed {
            reason: format!("Failed to create thumbnail directory: {}", e),
        })?;

    let mut hasher = Sha256::new();
    hasher.update(format!("placeholder_{}", media_blob_id).as_bytes());
    let hash = format!("{:x}", hasher.finalize());
    let output_path = format!("{}/placeholder_{}.txt", output_dir, &hash[..16]);

    // Write a simple placeholder file
    let placeholder_content = format!("Placeholder thumbnail for media blob: {}", media_blob_id);
    tokio::fs::write(&output_path, placeholder_content)
        .await
        .map_err(|e| JobError::ProcessingFailed {
            reason: format!("Failed to create placeholder: {}", e),
        })?;

    let metadata =
        tokio::fs::metadata(&output_path)
            .await
            .map_err(|e| JobError::ProcessingFailed {
                reason: format!("Failed to get placeholder metadata: {}", e),
            })?;

    // Create media blob for the placeholder
    let placeholder_metadata = serde_json::json!({
        "type": "placeholder_thumbnail",
        "source_blob_id": media_blob_id
    });

    let create_request = crate::media_blobz::CreateMediaBlobRequest {
        sha256: hash,
        size: Some(metadata.len() as i64),
        mime: Some("text/plain".to_string()),
        source_client_id: Some("job_processor".to_string()),
        local_path: Some(output_path),
        parent_blob_id: Some(media_blob_id.to_string()),
        blob_type: Some("placeholder_thumbnail".to_string()),
        metadata: placeholder_metadata,
        created_by: Some("job_processor".to_string()),
    };

    crate::media_blobz::create_media_blob(create_request)
        .await
        .map_err(|e| JobError::ProcessingFailed {
            reason: format!("Failed to create placeholder blob: {}", e),
        })?;

    Ok(())
}

async fn generate_audio_waveform(media_blob_id: &str) -> Result<(), JobError> {
    use sha2::{Digest, Sha256};
    use std::process::Stdio;

    // Get media blob info to get the file path
    let media_blob = crate::media_blobz::get_media_blob(media_blob_id)
        .await
        .map_err(|e| JobError::ProcessingFailed {
            reason: format!("Failed to get media blob: {}", e),
        })?;

    let file_path = media_blob
        .local_path
        .ok_or_else(|| JobError::ProcessingFailed {
            reason: "Media blob has no local path".to_string(),
        })?;

    // Create output directory if it doesn't exist
    let output_dir = "data/waveforms";
    tokio::fs::create_dir_all(output_dir)
        .await
        .map_err(|e| JobError::ProcessingFailed {
            reason: format!("Failed to create waveform directory: {}", e),
        })?;

    // Generate output filename
    let mut hasher = Sha256::new();
    hasher.update(format!("waveform_{}", media_blob_id).as_bytes());
    let hash = format!("{:x}", hasher.finalize());
    let output_path = format!("{}/wave_{}.png", output_dir, &hash[..16]);

    // Use ffmpeg to generate waveform visualization
    let mut cmd = tokio::process::Command::new("ffmpeg");
    cmd.args([
        "-i",
        &file_path,
        "-filter_complex",
        "showwavespic=s=800x200:colors=0x3b82f6",
        "-frames:v",
        "1",
        "-y", // overwrite output
        &output_path,
    ])
    .stdout(std::process::Stdio::null())
    .stderr(std::process::Stdio::null());

    let output = tokio::time::timeout(
        tokio::time::Duration::from_secs(60), // waveforms can take longer
        cmd.output(),
    )
    .await
    .map_err(|_| JobError::ProcessingFailed {
        reason: "Waveform generation timed out".to_string(),
    })?
    .map_err(|e| JobError::ProcessingFailed {
        reason: format!("Failed to run ffmpeg: {}", e),
    })?;

    if !output.status.success() {
        return Err(JobError::ProcessingFailed {
            reason: "ffmpeg failed to generate waveform".to_string(),
        });
    }

    // Check if output file was created
    let metadata =
        tokio::fs::metadata(&output_path)
            .await
            .map_err(|e| JobError::ProcessingFailed {
                reason: format!("Waveform file not created: {}", e),
            })?;

    // Create media blob for the waveform
    let waveform_metadata = serde_json::json!({
        "type": "waveform",
        "source_blob_id": media_blob_id,
        "dimensions": {"width": 800, "height": 200},
        "generated_with": "ffmpeg"
    });

    let create_request = crate::media_blobz::CreateMediaBlobRequest {
        sha256: hash,
        size: Some(metadata.len() as i64),
        mime: Some("image/png".to_string()),
        source_client_id: Some("job_processor".to_string()),
        local_path: Some(output_path.clone()),
        parent_blob_id: Some(media_blob_id.to_string()),
        blob_type: Some("waveform".to_string()),
        metadata: waveform_metadata,
        created_by: Some("job_processor".to_string()),
    };

    crate::media_blobz::create_media_blob(create_request)
        .await
        .map_err(|e| JobError::ProcessingFailed {
            reason: format!("Failed to create waveform blob: {}", e),
        })?;

    println!("generated waveform: {}", output_path);
    Ok(())
}

/// Run the job processor once - process all pending jobs and then exit
pub async fn run_job_processor_once(max_jobs: u32) -> Result<(), JobError> {
    let mut processed_count = 0;

    loop {
        match get_next_pending_job().await? {
            Some(job) => {
                println!("processing job: {} ({})", job.id, job.job_type);
                match process_job(job).await {
                    Ok(result) => {
                        println!(
                            "job completed: {} in {}ms",
                            result.job.id, result.processing_time_ms
                        );
                        processed_count += 1;
                    }
                    Err(error) => {
                        eprintln!("job failed: {}", error);
                        processed_count += 1;
                    }
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

    println!("processed {} jobs", processed_count);
    Ok(())
}
