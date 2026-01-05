//! simplified job processing module
//! handles background tasks with a cleaner, more straightforward approach

mod models;
mod service;

// re-export public types
pub use models::{
    CreateJobRequest, Job, JobData, JobError, JobPriority, JobResult, JobStatus, JobType,
};
pub use service::{
    cancel_job, create_job, get_job, list_jobs, mark_job_completed, mark_job_failed,
    mark_job_started, process_next_job,
};

// placeholder for simplified job functionality
// TODO: refactor from legacylib job system
// - simpler job queue (no complex state machines)
// - basic priority levels (high, normal, low)
// - clear job lifecycle (pending -> running -> completed/failed)
// - job data as simple JSON blob
// - retry mechanism with exponential backoff
// - job cleanup and archival
// - progress tracking for long-running jobs
