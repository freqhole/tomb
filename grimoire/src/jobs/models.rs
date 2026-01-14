//! job system models for unified background task processing
//! supports both individual jobs and large batch operations via sessions

use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use zod_gen_derive::ZodSchema;

/// Job types supported by the queue
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ZodSchema)]
pub enum JobType {
    // filesystem operations
    ScanDirectory,
    ProcessFile,

    // media operations
    FetchMedia,

    // upload processing
    ConvertWebp,
    ImportMusic,
}

/// job status lifecycle
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum JobStatus {
    Pending,
    Running,
    Completed,
    Failed,
    Cancelled,
}

/// session status for batch operations
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum SessionStatus {
    Active,
    Paused,
    Completed,
    Failed,
    Cancelled,
}

/// progress tracking for jobs and sessions
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobProgress {
    pub current: u64,
    pub total: u64,
    pub message: Option<String>,
}

impl JobProgress {
    pub fn new(current: u64, total: u64) -> Self {
        Self {
            current,
            total,
            message: None,
        }
    }

    pub fn with_message(current: u64, total: u64, message: String) -> Self {
        Self {
            current,
            total,
            message: Some(message),
        }
    }

    pub fn percentage(&self) -> f64 {
        if self.total == 0 {
            0.0
        } else {
            (self.current as f64 / self.total as f64) * 100.0
        }
    }
}

/// job session for managing large batch operations
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct JobSession {
    pub id: String,
    pub job_type: String,                // serialized JobType
    pub status: String,                  // serialized SessionStatus
    pub progress: String,                // JSON serialized JobProgress
    pub last_checkpoint: Option<String>, // for resume capability
    pub batch_size: i64,
    pub created_at: i64,
    pub updated_at: i64,
    pub created_by: Option<String>,
}

impl JobSession {
    pub fn job_type(&self) -> Result<JobType, serde_json::Error> {
        serde_json::from_str(&format!("\"{}\"", self.job_type))
    }

    pub fn status(&self) -> Result<SessionStatus, serde_json::Error> {
        serde_json::from_str(&format!("\"{}\"", self.status))
    }

    pub fn progress(&self) -> Result<JobProgress, serde_json::Error> {
        serde_json::from_str(&self.progress)
    }
}

/// Individual job within the queue
#[derive(Debug, Clone, Serialize, Deserialize, FromRow, ZodSchema)]
pub struct Job {
    pub id: String,
    pub session_id: Option<String>,
    pub job_type: String,       // serialized JobType
    pub status: String,         // serialized JobStatus
    pub parameters: String,     // JSON parameters
    pub result: Option<String>, // JSON result
    pub retry_count: i32,
    pub max_retries: i32,
    pub scheduled_at: i64,
    pub started_at: Option<i64>,
    pub completed_at: Option<i64>,
    pub error_message: Option<String>,
    pub created_by: Option<String>,
}

impl Job {
    pub fn job_type(&self) -> Result<JobType, serde_json::Error> {
        serde_json::from_str(&format!("\"{}\"", self.job_type))
    }

    pub fn status(&self) -> Result<JobStatus, serde_json::Error> {
        serde_json::from_str(&format!("\"{}\"", self.status))
    }

    pub fn parameters<T>(&self) -> Result<T, serde_json::Error>
    where
        T: for<'de> Deserialize<'de>,
    {
        serde_json::from_str(&self.parameters)
    }

    pub fn result<T>(&self) -> Result<Option<T>, serde_json::Error>
    where
        T: for<'de> Deserialize<'de>,
    {
        match &self.result {
            Some(result_str) => Ok(Some(serde_json::from_str(result_str)?)),
            None => Ok(None),
        }
    }
}

/// Request for creating a new job session
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateJobSessionRequest {
    pub job_type: JobType,
    pub batch_size: Option<usize>,
    pub created_by: Option<String>,
}

/// Request for creating a new individual job
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct CreateJobRequest {
    pub job_type: JobType,
    pub session_id: Option<String>,
    pub parameters: serde_json::Value,
    pub max_retries: Option<i32>,
    pub scheduled_at: Option<i64>, // unix timestamp, None = immediate
    pub created_by: Option<String>,
}

/// request for getting a job by id
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct GetJobRequest {
    pub job_id: String,
}

/// request for listing jobs with filters
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct ListJobsRequest {
    pub session_id: Option<String>,
    pub status: Option<String>, // serialized JobStatus
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

/// job processing result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobResult {
    pub job: Job,
    pub output: Option<serde_json::Value>,
    pub processing_time_ms: u64,
}

/// job processing errors
#[derive(Debug, thiserror::Error)]
pub enum JobError {
    #[error("job not found: {id}")]
    JobNotFound { id: String },

    #[error("job session not found: {id}")]
    SessionNotFound { id: String },

    #[error("job processing failed: {reason}")]
    ProcessingFailed { reason: String },

    #[error("job cancelled by user")]
    Cancelled,

    #[error("job timeout exceeded")]
    Timeout,

    #[error("maximum retries exceeded")]
    MaxRetriesExceeded,

    #[error("invalid job parameters: {reason}")]
    InvalidParameters { reason: String },

    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),

    #[error("serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("grimoire error: {0}")]
    Grimoire(#[from] crate::error::GrimoireError),
}

/// job queue statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueStats {
    pub pending_jobs: u64,
    pub running_jobs: u64,
    pub completed_jobs: u64,
    pub failed_jobs: u64,
    pub active_sessions: u64,
}

// ============================================================================
// CLI response types
// ============================================================================

/// response for listing jobs (CLI output)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobListResponse {
    pub id: String,
    pub job_type: String,
    pub status: String,
    pub retry_count: i32,
    pub max_retries: i32,
    pub created_at: String,
}

/// response for job queue statistics (CLI output)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobStatsResponse {
    pub pending_jobs: u64,
    pub running_jobs: u64,
    pub completed_jobs: u64,
    pub failed_jobs: u64,
    pub active_sessions: u64,
    pub total_jobs: u64,
    pub success_rate: Option<f64>,
}

/// response for job processor execution (CLI output)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessorResponse {
    pub mode: String,
    pub max_jobs: usize,
    pub completed: bool,
}
