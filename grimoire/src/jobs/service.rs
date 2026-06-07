//! job processing service for unified background task processing
//! handles job queue management, execution, and session-based batch operations
//!
//! this module provides CRUD operations for jobs and sessions.
//! most job processors are in the music/ submodule.

use rand::Rng;
use serde_json::Value;

use crate::database;
use crate::error::ErrorDetail;
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
    let priority = request.priority.unwrap_or(0);

    let job = match sqlx::query_as!(
        Job,
        r#"
        INSERT INTO jobz (session_id, job_type, status, parameters, max_retries, scheduled_at, created_by, priority)
        VALUES (?, ?, 'Pending', ?, ?, ?, ?, ?)
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
        request.created_by,
        priority
    )
    .fetch_one(&pool)
    .await
    {
        Ok(j) => j,
        Err(e) => {
            return GrimoireResponse::failure(
                format!("Failed to create job in database: {}", e),
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

/// Get multiple jobs by ID (batch status polling)
///
/// Returns a map of job_id -> JobResponse for all requested jobs.
/// Jobs that don't exist are silently omitted from the response.
pub async fn get_jobs_status(
    job_ids: &[String],
) -> GrimoireResponse<std::collections::HashMap<String, super::models::JobResponse>> {
    use super::models::JobResponse;

    if job_ids.is_empty() {
        return GrimoireResponse::success("no jobs requested", std::collections::HashMap::new());
    }

    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("failed to connect to database", vec![e.into()])
        }
    };

    // build IN clause with placeholders
    let placeholders: Vec<&str> = job_ids.iter().map(|_| "?").collect();
    let in_clause = placeholders.join(", ");
    let query = format!(
        r#"
        SELECT id, session_id, job_type, status,
               parameters, result, retry_count,
               max_retries, scheduled_at,
               started_at, completed_at, error_message, created_by
        FROM jobz WHERE id IN ({})
        "#,
        in_clause
    );

    // build query with dynamic bind
    let mut query_builder = sqlx::query_as::<_, Job>(&query);
    for job_id in job_ids {
        query_builder = query_builder.bind(job_id);
    }

    let jobs: Vec<Job> = match query_builder.fetch_all(&pool).await {
        Ok(jobs) => jobs,
        Err(e) => return GrimoireResponse::failure("failed to fetch jobs", vec![e.into()]),
    };

    // convert to HashMap<job_id, JobResponse>
    let result: std::collections::HashMap<String, JobResponse> = jobs
        .into_iter()
        .map(|job| {
            let id = job.id.clone();
            (id, JobResponse::from(job))
        })
        .collect();

    GrimoireResponse::success(format!("retrieved {} jobs", result.len()), result)
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
            ORDER BY priority DESC, scheduled_at ASC
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

/// peek the top `limit` pending jobs (priority desc, scheduled_at asc)
/// without claiming any of them. used by the parallel worker pool to
/// scan for a job whose conflict key isn't busy in another worker; the
/// actual claim happens via `try_claim_pending_job`.
pub async fn peek_pending_jobs(limit: u32) -> GrimoireResponse<Vec<Job>> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("Failed to connect to database", vec![e.into()])
        }
    };

    let jobs = match sqlx::query_as!(
        Job,
        r#"
        SELECT id as "id!", session_id, job_type as "job_type!", status as "status!",
               parameters as "parameters!", result, retry_count as "retry_count!: i32",
               max_retries as "max_retries!: i32", scheduled_at as "scheduled_at!",
               started_at, completed_at, error_message, created_by
        FROM jobz
        WHERE status = 'Pending' AND scheduled_at <= unixepoch()
        ORDER BY priority DESC, scheduled_at ASC
        LIMIT ?
        "#,
        limit
    )
    .fetch_all(&pool)
    .await
    {
        Ok(j) => j,
        Err(e) => return GrimoireResponse::failure("failed to peek pending jobs", vec![e.into()]),
    };

    GrimoireResponse::success("peeked pending jobs", jobs)
}

/// attempt to atomically claim a specific pending job by id. returns
/// `Ok(None)` if the row is no longer Pending (another worker won the
/// race). returns the claimed (Running) Job on success.
pub async fn try_claim_pending_job(job_id: &str) -> GrimoireResponse<Option<Job>> {
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
        WHERE id = ? AND status = 'Pending'
        RETURNING id as "id!", session_id, job_type as "job_type!", status as "status!",
                  parameters as "parameters!", result, retry_count as "retry_count!: i32",
                  max_retries as "max_retries!: i32", scheduled_at as "scheduled_at!",
                  started_at, completed_at, error_message, created_by
        "#,
        job_id
    )
    .fetch_optional(&pool)
    .await
    {
        Ok(j) => j,
        Err(e) => return GrimoireResponse::failure("failed to claim pending job", vec![e.into()]),
    };

    GrimoireResponse::success("attempted to claim pending job", job)
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

/// mark a job as failed and handle retry logic
///
/// stores the full error details as JSON in the `result` field for structured
/// error handling, and stores the first error's detail in `error_message`
/// for backward compatibility and quick display.
///
/// if `retryable` is true and retry count hasn't exceeded max_retries,
/// the job will be rescheduled with exponential backoff.
/// if `retryable` is false, the job is immediately marked as Failed.
pub async fn mark_job_failed(
    job_id: &str,
    errors: Vec<ErrorDetail>,
    retryable: bool,
) -> GrimoireResponse<Job> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("Failed to connect to database", vec![e.into()])
        }
    };

    // extract error_message from first error for backward compatibility
    let error_message = errors
        .first()
        .map(|e| e.detail.clone())
        .unwrap_or_else(|| "unknown error".to_string());

    // serialize errors to JSON for structured storage in result field
    let errors_json = match serde_json::to_string(&errors) {
        Ok(s) => Some(s),
        Err(e) => return GrimoireResponse::failure("failed to serialize errors", vec![e.into()]),
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
    // only retry if error is retryable AND we haven't exceeded max retries
    let should_retry = retryable && new_retry_count < current_job.max_retries;

    if !retryable {
        tracing::info!(
            "job {} failed with non-retryable error (type: {}), marking as Failed immediately",
            job_id,
            errors
                .first()
                .map(|e| e.error_type.as_str())
                .unwrap_or("unknown")
        );
    } else if should_retry {
        tracing::info!(
            "job {} failed (retry {}/{}), scheduling retry",
            job_id,
            new_retry_count,
            current_job.max_retries
        );
    } else {
        tracing::info!(
            "job {} failed (retry {}/{}, max exceeded), marking as Failed",
            job_id,
            new_retry_count,
            current_job.max_retries
        );
    }

    let (status, scheduled_at) = if should_retry {
        // exponential backoff: base=5s, cap=300s, jitter=0..5s
        // formula: min(cap, base * 2^(retry_count-1)) + jitter
        // (scheduled_at is integer seconds so jitter rounds to seconds)
        const BASE_SECS: i64 = 5;
        const CAP_SECS: i64 = 300;
        let backoff =
            (BASE_SECS * 2_i64.pow(new_retry_count.saturating_sub(1) as u32)).min(CAP_SECS);
        let jitter: i64 = rand::thread_rng().gen_range(0..5);
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        let retry_at = now + backoff + jitter;
        ("Pending".to_string(), retry_at)
    } else {
        ("Failed".to_string(), current_job.scheduled_at)
    };

    let job = match sqlx::query_as!(
        Job,
        r#"
        UPDATE jobz
        SET status = ?, retry_count = ?, error_message = ?, result = ?, scheduled_at = ?,
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
        errors_json,
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

/// delete a job row from the database
pub async fn delete_job(job_id: &str) -> GrimoireResponse<()> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("failed to connect to database", vec![e.into()])
        }
    };

    match sqlx::query!("DELETE FROM jobz WHERE id = ?", job_id)
        .execute(&pool)
        .await
    {
        Ok(_) => GrimoireResponse::success("job deleted", ()),
        Err(e) => GrimoireResponse::failure("failed to delete job", vec![e.into()]),
    }
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

    // phase 9.0 - broadcast a typed progress event so live
    // subscribers (jobz alpn / tauri bridge) get an immediate signal
    // without polling. silent no-op when there are no subscribers.
    // p1: also tag with topic + created_by from the session row so
    // per-user filtering works; entity_ref is None (session aggregate).
    let topic = session
        .job_type()
        .unwrap_or(crate::jobs::models::JobType::ProcessFile);
    crate::jobs::job_events::emit(crate::jobs::job_events::JobEvent::Progress {
        session_id: session_id.to_string(),
        complete: progress.current as i64,
        total: progress.total as i64,
        topic,
        entity_ref: None,
        created_by: session.created_by.clone(),
        details: None,
    });

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

/// session job counts for progress tracking
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SessionJobCounts {
    pub pending: u32,
    pub running: u32,
    pub completed: u32,
    pub failed: u32,
    pub total: u32,
}

/// get job counts for a session (for progress tracking)
pub async fn get_session_job_counts(session_id: &str) -> GrimoireResponse<SessionJobCounts> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("failed to connect to database", vec![e.into()])
        }
    };

    let counts = match sqlx::query!(
        r#"
        SELECT
            COALESCE(SUM(CASE WHEN status = 'Pending' THEN 1 ELSE 0 END), 0) as "pending!: i64",
            COALESCE(SUM(CASE WHEN status = 'Running' THEN 1 ELSE 0 END), 0) as "running!: i64",
            COALESCE(SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END), 0) as "completed!: i64",
            COALESCE(SUM(CASE WHEN status = 'Failed' THEN 1 ELSE 0 END), 0) as "failed!: i64",
            COUNT(*) as "total!: i64"
        FROM jobz
        WHERE session_id = ?
        "#,
        session_id
    )
    .fetch_one(&pool)
    .await
    {
        Ok(row) => SessionJobCounts {
            pending: row.pending as u32,
            running: row.running as u32,
            completed: row.completed as u32,
            failed: row.failed as u32,
            total: row.total as u32,
        },
        Err(e) => {
            return GrimoireResponse::failure("failed to get session job counts", vec![e.into()])
        }
    };

    GrimoireResponse::success("session job counts retrieved", counts)
}
