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
//!
//! Media-specific processors in media/ submodule:
//! - photo_processor: image thumbnail generation and EXIF metadata extraction
//! - video_processor: video frame capture and ffprobe metadata extraction
//! - document_processor: PDF first-page thumbnail and metadata extraction
//! - audio_processor: general audio waveform generation and metadata extraction

mod media;
mod models;
mod music;
mod runner;
mod service;

// re-export public types
pub use models::{
    CreateJobRequest, CreateJobSessionRequest, GetJobRequest, GetJobsStatusRequest,
    GetJobsStatusResponse, Job, JobError, JobListResponse, JobProgress, JobResponse, JobResult,
    JobSession, JobStatsResponse, JobStatus, JobType, ListJobsRequest, ProcessorResponse,
    QueueStats, SessionStatus,
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

pub use runner::{
    process_job, run_job_processor, run_job_processor_once, run_job_processor_with_token,
};

// re-export CancellationToken for use with run_job_processor_with_token
pub use tokio_util::sync::CancellationToken;

pub use service::{
    cancel_job, complete_session, create_job, create_job_session, delete_job, fail_session,
    get_job, get_job_session, get_jobs_status, get_next_pending_job, get_queue_stats,
    get_session_job_counts, list_jobs, mark_job_completed, mark_job_failed, mark_job_started,
    update_session_progress, SessionJobCounts,
};

// re-export music job processors (used by runner module)
pub use music::{
    process_convert_webp_job, process_fetch_media_job, process_file_job, process_import_music_job,
    process_scan_directory_job,
};

// re-export media job processors (used by runner module)
pub use media::audio_processor::process_media_file_job;
pub use media::document_processor::process_generate_document_thumbnail_job;
pub use media::pdf_page_renderer::process_render_document_pages_job;
pub use media::photo_processor::process_generate_photo_thumbnail_job;
pub use media::video_processor::process_generate_video_thumbnail_job;
