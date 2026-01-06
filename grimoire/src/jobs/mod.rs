//! simplified job processing module
//! handles background tasks with a cleaner, more straightforward approach

mod models;
mod service;

// re-export public types
pub use models::{
    CreateJobRequest, CreateJobSessionRequest, ExtractMetadataParams, ExtractMetadataResult,
    GenerateThumbnailParams, GenerateThumbnailResult, GenerateWaveformParams,
    GenerateWaveformResult, Job, JobError, JobProgress, JobResult, JobSession, JobStatus, JobType,
    ProcessFileParams, ProcessFileResult, QueueStats, ScanDirectoryParams, ScanDirectoryResult,
    SessionStatus,
};
pub use service::{
    cancel_job, complete_session, create_job, create_job_session, fail_session, get_job,
    get_job_session, get_next_pending_job, get_queue_stats, list_jobs, mark_job_completed,
    mark_job_failed, mark_job_started, process_job, run_job_processor, run_job_processor_once,
    update_session_progress,
};

// Job processing system with unified queue and session-based batch operations
// Features:
// - Universal job queue for all background tasks
// - Job sessions for large batch operations (e.g., directory scanning)
// - Automatic retry with exponential backoff
// - Progress tracking and resume capability
// - Clean job lifecycle: Pending -> Running -> Completed/Failed/Cancelled
// - Type-safe job parameters and results
