//! Job processing system with unified queue and session-based batch operations
//!
//! General infrastructure:
//! - models: JobType enum, request/response types
//! - service: CRUD operations for jobs and sessions
//! - runner: job dispatching and queue processing loop
//!
//! Music-specific processors in music/ submodule:
//! - scan_processor: directory scanning for audio files
//! - file_processor: audio file import and metadata extraction
//! - fetch_processor: downloading from external sources (YouTube, etc.)
//! - upload_processors: user upload handling (WebP conversion, music import)

mod models;
mod music;
mod runner;
mod service;

// re-export public types
pub use models::{
    CreateJobRequest, CreateJobSessionRequest, GetJobRequest, Job, JobError, JobListResponse,
    JobProgress, JobResult, JobSession, JobStatsResponse, JobStatus, JobType, ListJobsRequest,
    ProcessorResponse, QueueStats, SessionStatus,
};

// re-export music job types for backward compatibility
pub use music::{
    ProcessFileParams, ProcessFileResult, ProcessJobCreatedResponse, ScanDirectoryParams,
    ScanDirectoryResult, ScanJobCreatedResponse,
};

// re-export scanned directories functions
pub use music::{
    get_deduplicated_directories, get_scanned_directory_paths, list_scanned_directories,
    record_scanned_directory, remove_scanned_directory, ScannedDirectory,
};

// re-export directory tag rules
pub use music::{
    add_directory_tags, apply_directory_tags_for_file, apply_directory_tags_to_album,
    clear_directory_tags, clear_tags_from_directory, get_tags_for_file_path,
    list_directory_tag_rules, list_directory_tags, remove_directory_tags,
    strip_tags_from_directory, DirectoryTagRule,
};

pub use runner::{process_job, run_job_processor, run_job_processor_once};
pub use service::{
    cancel_job, complete_session, create_job, create_job_session, fail_session, get_job,
    get_job_session, get_next_pending_job, get_queue_stats, list_jobs, mark_job_completed,
    mark_job_failed, mark_job_started, update_session_progress,
};

// re-export music job processors (used by runner module)
pub use music::{
    process_convert_webp_job, process_fetch_media_job, process_file_job, process_import_music_job,
    process_scan_directory_job,
};
