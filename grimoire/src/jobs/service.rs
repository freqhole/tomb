//! job processing service for unified background task processing
//! handles job queue management, execution, and session-based batch operations
//!
//! this module provides CRUD operations for jobs and sessions.
//! most job processors are in the music/ submodule.

use serde_json::Value;

use crate::database;
use crate::response::GrimoireResponse;

use super::models::{
    CreateJobRequest, CreateJobSessionRequest, Job, JobError, JobProgress, JobSession, JobStatus,
    QueueStats,
};

/// create a new job session for batch operations
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

    let session = match sqlx::query_as!(
        JobSession,
        r#"
        INSERT INTO job_sessionz (job_type, status, progress, batch_size, created_by)
        VALUES (?, 'Active', ?, ?, ?)
        RETURNING id as "id!", job_type as "job_type!", status as "status!",
                  progress as "progress!", last_checkpoint, batch_size as "batch_size!",
                  created_at as "created_at!", updated_at as "updated_at!", created_by
        "#,
        job_type_str,
        progress_json,
        batch_size,
        request.created_by
    )
    .fetch_one(&pool)
    .await
    {
        Ok(s) => s,
        Err(e) => return GrimoireResponse::failure("failed to create job session", vec![e.into()]),
    };

    GrimoireResponse::success("Job session created successfully", session)
}

/// create a new job in the queue
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

    let job = match sqlx::query_as!(
        Job,
        r#"
        INSERT INTO jobz (session_id, job_type, status, parameters, max_retries, scheduled_at, created_by)
        VALUES (?, ?, 'Pending', ?, ?, ?, ?)
        RETURNING id as "id!", session_id, job_type as "job_type!", status as "status!",
                  parameters as "parameters!", result, retry_count as "retry_count!: i32",
                  max_retries as "max_retries!: i32", scheduled_at as "scheduled_at!",
                  started_at, completed_at, error_message, created_by
        "#,
        request.session_id,
        job_type_str,
        parameters_json,
        max_retries,
        scheduled_at,
        request.created_by
    )
    .fetch_one(&pool)
    .await
    {
        Ok(j) => j,
        Err(e) => {
            return GrimoireResponse::failure(
                &format!("Failed to create job in database: {}", e),
                vec![e.into()],
            )
        }
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

    let job = match sqlx::query_as!(
        Job,
        r#"
        SELECT id as "id!", session_id, job_type as "job_type!", status as "status!",
               parameters as "parameters!", result, retry_count as "retry_count!: i32",
               max_retries as "max_retries!: i32", scheduled_at as "scheduled_at!",
               started_at, completed_at, error_message, created_by
        FROM jobz WHERE id = ?
        "#,
        job_id
    )
    .fetch_optional(&pool)
    .await
    {
        Ok(Some(j)) => j,
        Ok(None) => {
            return GrimoireResponse::failure(
                "job not found",
                vec![JobError::JobNotFound {
                    id: job_id.to_string(),
                }
                .into()],
            )
        }
        Err(e) => return GrimoireResponse::failure("failed to fetch job", vec![e.into()]),
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

    let session = match sqlx::query_as!(
        JobSession,
        r#"
        SELECT id as "id!", job_type as "job_type!", status as "status!",
               progress as "progress!", last_checkpoint, batch_size as "batch_size!",
               created_at as "created_at!", updated_at as "updated_at!", created_by
        FROM job_sessionz WHERE id = ?
        "#,
        session_id
    )
    .fetch_optional(&pool)
    .await
    {
        Ok(Some(s)) => s,
        Ok(None) => {
            return GrimoireResponse::failure(
                "job session not found",
                vec![JobError::JobNotFound {
                    id: session_id.to_string(),
                }
                .into()],
            )
        }
        Err(e) => return GrimoireResponse::failure("failed to fetch job session", vec![e.into()]),
    };

    GrimoireResponse::success("Job session retrieved successfully", session)
}

/// Get the next pending job and atomically mark it as started
/// This prevents race conditions when multiple job runners are active
/// Returns None if no jobs are available
pub async fn get_next_pending_job() -> GrimoireResponse<Option<Job>> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("Failed to connect to database", vec![e.into()])
        }
    };

    // Atomically claim the next pending job by updating it to Running
    // This prevents multiple workers from processing the same job
    let job = match sqlx::query_as!(
        Job,
        r#"
        UPDATE jobz
        SET status = 'Running', started_at = unixepoch()
        WHERE id = (
            SELECT id FROM jobz
            WHERE status = 'Pending' AND scheduled_at <= unixepoch()
            ORDER BY scheduled_at ASC
            LIMIT 1
        )
        RETURNING id as "id!", session_id, job_type as "job_type!", status as "status!",
                  parameters as "parameters!", result, retry_count as "retry_count!: i32",
                  max_retries as "max_retries!: i32", scheduled_at as "scheduled_at!",
                  started_at, completed_at, error_message, created_by
        "#
    )
    .fetch_optional(&pool)
    .await
    {
        Ok(j) => j,
        Err(e) => {
            return GrimoireResponse::failure("failed to fetch next pending job", vec![e.into()])
        }
    };

    GrimoireResponse::success("Retrieved and claimed next pending job", job)
}

/// Mark a job as started
pub async fn mark_job_started(job_id: &str) -> GrimoireResponse<Job> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("Failed to connect to database", vec![e.into()])
        }
    };

    let job = match sqlx::query_as!(
        Job,
        r#"
        UPDATE jobz
        SET status = 'Running', started_at = unixepoch()
        WHERE id = ?
        RETURNING id as "id!", session_id, job_type as "job_type!", status as "status!",
                  parameters as "parameters!", result, retry_count as "retry_count!: i32",
                  max_retries as "max_retries!: i32", scheduled_at as "scheduled_at!",
                  started_at, completed_at, error_message, created_by
        "#,
        job_id
    )
    .fetch_one(&pool)
    .await
    {
        Ok(j) => j,
        Err(e) => {
            return GrimoireResponse::failure("failed to mark job as started", vec![e.into()])
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

    let job = match sqlx::query_as!(
        Job,
        r#"
        UPDATE jobz
        SET status = 'Completed', completed_at = unixepoch(), result = ?
        WHERE id = ?
        RETURNING id as "id!", session_id, job_type as "job_type!", status as "status!",
                  parameters as "parameters!", result, retry_count as "retry_count!: i32",
                  max_retries as "max_retries!: i32", scheduled_at as "scheduled_at!",
                  started_at, completed_at, error_message, created_by
        "#,
        result_json,
        job_id
    )
    .fetch_one(&pool)
    .await
    {
        Ok(j) => j,
        Err(e) => {
            return GrimoireResponse::failure("failed to mark job as completed", vec![e.into()])
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

    let job = match sqlx::query_as!(
        Job,
        r#"
        UPDATE jobz
        SET status = ?, retry_count = ?, error_message = ?, scheduled_at = ?,
            completed_at = CASE WHEN ? = 'Failed' THEN unixepoch() ELSE completed_at END
        WHERE id = ?
        RETURNING id as "id!", session_id, job_type as "job_type!", status as "status!",
                  parameters as "parameters!", result, retry_count as "retry_count!: i32",
                  max_retries as "max_retries!: i32", scheduled_at as "scheduled_at!",
                  started_at, completed_at, error_message, created_by
        "#,
        status,
        new_retry_count,
        error_message,
        scheduled_at,
        status,
        job_id
    )
    .fetch_one(&pool)
    .await
    {
        Ok(j) => j,
        Err(e) => return GrimoireResponse::failure("failed to mark job as failed", vec![e.into()]),
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

    let job = match sqlx::query_as!(
        Job,
        r#"
        UPDATE jobz
        SET status = 'Cancelled', completed_at = unixepoch()
        WHERE id = ? AND status IN ('Pending', 'Running')
        RETURNING id as "id!", session_id, job_type as "job_type!", status as "status!",
                  parameters as "parameters!", result, retry_count as "retry_count!: i32",
                  max_retries as "max_retries!: i32", scheduled_at as "scheduled_at!",
                  started_at, completed_at, error_message, created_by
        "#,
        job_id
    )
    .fetch_one(&pool)
    .await
    {
        Ok(j) => j,
        Err(e) => return GrimoireResponse::failure("failed to cancel job", vec![e.into()]),
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

    let session = match sqlx::query_as!(
        JobSession,
        r#"
        UPDATE job_sessionz
        SET progress = ?, last_checkpoint = ?
        WHERE id = ?
        RETURNING id as "id!", job_type as "job_type!", status as "status!",
                  progress as "progress!", last_checkpoint, batch_size as "batch_size!",
                  created_at as "created_at!", updated_at as "updated_at!", created_by
        "#,
        progress_json,
        checkpoint,
        session_id
    )
    .fetch_one(&pool)
    .await
    {
        Ok(s) => s,
        Err(e) => {
            return GrimoireResponse::failure("failed to update session progress", vec![e.into()])
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

    let session = match sqlx::query_as!(
        JobSession,
        r#"
        UPDATE job_sessionz
        SET status = 'Completed'
        WHERE id = ?
        RETURNING id as "id!", job_type as "job_type!", status as "status!",
                  progress as "progress!", last_checkpoint, batch_size as "batch_size!",
                  created_at as "created_at!", updated_at as "updated_at!", created_by
        "#,
        session_id
    )
    .fetch_one(&pool)
    .await
    {
        Ok(s) => s,
        Err(e) => return GrimoireResponse::failure("failed to complete session", vec![e.into()]),
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

    let session = match sqlx::query_as!(
        JobSession,
        r#"
        UPDATE job_sessionz
        SET status = 'Failed'
        WHERE id = ?
        RETURNING id as "id!", job_type as "job_type!", status as "status!",
                  progress as "progress!", last_checkpoint, batch_size as "batch_size!",
                  created_at as "created_at!", updated_at as "updated_at!", created_by
        "#,
        session_id
    )
    .fetch_one(&pool)
    .await
    {
        Ok(s) => s,
        Err(e) => {
            return GrimoireResponse::failure("failed to mark session as failed", vec![e.into()])
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

    let stats = match sqlx::query!(
        r#"
        SELECT
            COALESCE(SUM(CASE WHEN status = 'Pending' THEN 1 ELSE 0 END), 0) as "pending_jobs!",
            COALESCE(SUM(CASE WHEN status = 'Running' THEN 1 ELSE 0 END), 0) as "running_jobs!",
            COALESCE(SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END), 0) as "completed_jobs!",
            COALESCE(SUM(CASE WHEN status = 'Failed' THEN 1 ELSE 0 END), 0) as "failed_jobs!",
            (SELECT COUNT(*) FROM job_sessionz WHERE status = 'Active') as "active_sessions!"
        FROM jobz
        "#
    )
    .fetch_one(&pool)
    .await
    {
        Ok(row) => QueueStats {
            pending_jobs: row.pending_jobs as u64,
            running_jobs: row.running_jobs as u64,
            completed_jobs: row.completed_jobs as u64,
            failed_jobs: row.failed_jobs as u64,
            active_sessions: row.active_sessions as u64,
        },
        Err(e) => {
            return GrimoireResponse::failure("failed to fetch queue statistics", vec![e.into()])
        }
    };

    GrimoireResponse::success("Retrieved queue statistics", stats)
}

/// list jobs with optional filtering using COALESCE for dynamic filters
pub async fn list_jobs(
    session_id: Option<&str>,
    status: Option<JobStatus>,
    limit: Option<u32>,
    offset: Option<u32>,
) -> GrimoireResponse<Vec<Job>> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("failed to connect to database", vec![e.into()])
        }
    };

    let status_str = status.map(|s| match serde_json::to_string(&s) {
        Ok(str) => str.trim_matches('"').to_string(),
        Err(_) => "".to_string(),
    });

    let limit_val = limit.unwrap_or(100) as i64;
    let offset_val = offset.unwrap_or(0) as i64;

    let jobs = match sqlx::query_as!(
        Job,
        r#"
        SELECT id as "id!", session_id, job_type as "job_type!", status as "status!",
               parameters as "parameters!", result, retry_count as "retry_count!: i32",
               max_retries as "max_retries!: i32", scheduled_at as "scheduled_at!",
               started_at, completed_at, error_message, created_by
        FROM jobz
        WHERE (? IS NULL OR session_id = ?)
          AND (? IS NULL OR status = ?)
        ORDER BY scheduled_at DESC
        LIMIT ?
        OFFSET ?
        "#,
        session_id,
        session_id,
        status_str,
        status_str,
        limit_val,
        offset_val
    )
    .fetch_all(&pool)
    .await
    {
        Ok(j) => j,
        Err(e) => return GrimoireResponse::failure("failed to list jobs", vec![e.into()]),
    };

    GrimoireResponse::success("jobs retrieved successfully", jobs)
}
