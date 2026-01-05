//! simplified job models placeholder
//! TODO: refactor from legacylib job system

use serde::{Deserialize, Serialize};

/// job priority levels
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum JobPriority {
    High,
    Normal,
    Low,
}

/// job status lifecycle
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum JobStatus {
    Pending,
    Running,
    Completed,
    Failed,
    Cancelled,
}

/// job types
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum JobType {
    ThumbnailGeneration,
    MetadataExtraction,
    FileImport,
    DirectoryScan,
    SearchIndexUpdate,
}

/// job data payload as JSON
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobData {
    #[serde(flatten)]
    pub data: serde_json::Value,
}

/// simplified job model
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Job {
    pub rowid: i64,
    pub id: String,
    pub job_type: JobType,
    pub status: JobStatus,
    pub priority: JobPriority,
    pub data: JobData,
    pub created_at: i64,
    pub started_at: Option<i64>,
    pub completed_at: Option<i64>,
    pub error_message: Option<String>,
    pub retry_count: i32,
    pub max_retries: i32,
    pub created_by_rowid: Option<i64>,
}

/// request for creating a new job
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateJobRequest {
    pub job_type: JobType,
    pub priority: Option<JobPriority>,
    pub data: serde_json::Value,
    pub max_retries: Option<i32>,
    pub created_by_rowid: Option<i64>,
}

/// job processing result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobResult {
    pub job: Job,
    pub output: Option<serde_json::Value>,
    pub processing_time_ms: u64,
}

/// job processing error
#[derive(Debug, thiserror::Error)]
pub enum JobError {
    #[error("Job not found: {id}")]
    JobNotFound { id: String },
    #[error("Job processing failed: {reason}")]
    ProcessingFailed { reason: String },
    #[error("Job cancelled by user")]
    Cancelled,
    #[error("Job timeout exceeded")]
    Timeout,
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),
}
