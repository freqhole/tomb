//! Job system models for unified background task processing
//! Supports both individual jobs and large batch operations via sessions

use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use zod_gen_derive::ZodSchema;

/// Job types supported by the queue
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, ZodSchema)]
pub enum JobType {
    // Filesystem operations
    ScanDirectory,
    ProcessFile,

    // Media operations
    ExtractMetadata,
    GenerateThumbnail,
    GenerateWaveform,
    FetchMedia,

    // Upload processing
    ConvertWebp,
    ImportMusic,
}

/// Job status lifecycle
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum JobStatus {
    Pending,
    Running,
    Completed,
    Failed,
    Cancelled,
}

/// Session status for batch operations
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum SessionStatus {
    Active,
    Paused,
    Completed,
    Failed,
    Cancelled,
}

/// Progress tracking for jobs and sessions
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

/// Job session for managing large batch operations
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct JobSession {
    pub id: String,
    pub job_type: String,                // Serialized JobType
    pub status: String,                  // Serialized SessionStatus
    pub progress: String,                // JSON serialized JobProgress
    pub last_checkpoint: Option<String>, // For resume capability
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
    pub job_type: String,       // Serialized JobType
    pub status: String,         // Serialized JobStatus
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
    pub scheduled_at: Option<i64>, // Unix timestamp, None = immediate
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

/// Job processing result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobResult {
    pub job: Job,
    pub output: Option<serde_json::Value>,
    pub processing_time_ms: u64,
}

/// Job processing errors
#[derive(Debug, thiserror::Error)]
pub enum JobError {
    #[error("Job not found: {id}")]
    JobNotFound { id: String },

    #[error("Job session not found: {id}")]
    SessionNotFound { id: String },

    #[error("Job processing failed: {reason}")]
    ProcessingFailed { reason: String },

    #[error("Job cancelled by user")]
    Cancelled,

    #[error("Job timeout exceeded")]
    Timeout,

    #[error("Maximum retries exceeded")]
    MaxRetriesExceeded,

    #[error("Invalid job parameters: {reason}")]
    InvalidParameters { reason: String },

    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),

    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Grimoire error: {0}")]
    Grimoire(#[from] crate::error::GrimoireError),
}

/// Job queue statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueStats {
    pub pending_jobs: u64,
    pub running_jobs: u64,
    pub completed_jobs: u64,
    pub failed_jobs: u64,
    pub active_sessions: u64,
}

/// Parameters for directory scan jobs
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanDirectoryParams {
    pub directory_path: String,
    pub recursive: bool,
    pub max_depth: Option<u32>,
    pub file_extensions: Option<Vec<String>>, // If None, use default audio extensions
}

/// Parameters for file processing jobs
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessFileParams {
    pub file_path: String,
    pub extract_metadata: bool,
    pub generate_thumbnail: bool,
    pub generate_waveform: bool,
}

/// Parameters for metadata extraction jobs
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractMetadataParams {
    pub file_path: String,
    pub media_blob_id: String,
}

/// Parameters for thumbnail generation jobs
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerateThumbnailParams {
    pub source_blob_id: String,
    pub target_width: Option<u32>,
    pub target_height: Option<u32>,
    pub quality: Option<u8>,
}

/// Parameters for waveform generation jobs
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerateWaveformParams {
    pub audio_blob_id: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub samples: Option<u32>,
}

/// Results from directory scan jobs
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanDirectoryResult {
    pub files_discovered: u64,
    pub jobs_created: u64,
    pub errors: Vec<String>,
}

/// Results from file processing jobs
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessFileResult {
    pub media_blob_id: String,
    pub song_id: Option<String>,
    pub artist_id: Option<String>,
    pub album_id: Option<String>,
    pub metadata_extracted: bool,
    pub thumbnail_generated: bool,
    pub waveform_generated: bool,
}

/// Results from metadata extraction jobs
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractMetadataResult {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub genre: Option<String>,
    pub year: Option<i32>,
    pub track_number: Option<i32>,
    pub disc_number: Option<i32>,
    pub duration: Option<i64>,
    pub bpm: Option<i32>,
    pub key_signature: Option<String>,
}

/// Results from thumbnail generation jobs
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerateThumbnailResult {
    pub thumbnail_blob_id: String,
    pub width: u32,
    pub height: u32,
    pub format: String, // Always "webp"
    pub file_size: u64,
}

/// Results from waveform generation jobs
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerateWaveformResult {
    pub waveform_blob_id: String,
    pub width: u32,
    pub height: u32,
    pub samples: u32,
    pub format: String, // e.g., "svg", "png"
    pub file_size: u64,
}

// ============================================================================
// CLI Response Types
// ============================================================================

/// Response for listing jobs (CLI output)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobListResponse {
    pub id: String,
    pub job_type: String,
    pub status: String,
    pub retry_count: i32,
    pub max_retries: i32,
    pub created_at: String,
}

/// Response for job queue statistics (CLI output)
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

/// Response for scan job creation (CLI output)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanJobCreatedResponse {
    pub job_id: String,
    pub session_id: String,
    pub path: String,
    pub recursive: bool,
    pub max_depth: Option<usize>,
}

/// Response for process file job creation (CLI output)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessJobCreatedResponse {
    pub job_id: String,
    pub file_path: String,
}

/// Response for job processor execution (CLI output)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessorResponse {
    pub mode: String,
    pub max_jobs: usize,
    pub completed: bool,
}
