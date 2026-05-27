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

pub mod job_events;
mod models;
mod music;
pub mod rate_limit;
mod runner;
mod service;

// re-export public types
pub use models::{
    CreateJobRequest, CreateJobSessionRequest, EnrichmentSource, GetJobRequest,
    GetJobsStatusRequest, GetJobsStatusResponse, Job, JobError, JobListResponse, JobProgress,
    JobResponse, JobResult, JobSession, JobStatsResponse, JobStatus, JobType, ListJobsRequest,
    ProcessorResponse, QueueStats, SessionStatus,
};

// re-export music job types for backward compatibility
pub use music::{
    AlbumEnrichmentPipelineParams, AlbumEnrichmentPipelineResult, AlbumEnrichmentProgress,
    AudioDbAlbumDetailParams, AudioDbAlbumDetailResult, AudioDbArtistDetailParams,
    AudioDbArtistDetailResult, AutoApplyAlbumEnrichmentParams, AutoApplyAlbumEnrichmentResult,
    BulkEnrichmentRequest, BulkEnrichmentResponse, CancelBulkEnrichmentRequest,
    CancelBulkEnrichmentResponse, EnqueueAudioDbAlbumDetailRequest,
    EnqueueAudioDbAlbumDetailResponse, EnqueueLastFmAlbumDetailRequest,
    EnqueueLastFmAlbumDetailResponse, EnqueueMbAlbumSearchRequest, EnqueueMbAlbumSearchResponse,
    EnrichmentSourceStatus, GetEnrichmentProgressRequest, GetEnrichmentProgressResponse,
    LastFmAlbumDetailParams, LastFmAlbumDetailResult, LastFmArtistDetailParams,
    LastFmArtistDetailResult, MbAlbumDetailParams, MbAlbumDetailResult, MbAlbumSearchParams,
    MbAlbumSearchResult, ProcessFileParams, ProcessFileResult, ProcessJobCreatedResponse,
    RequeryEnrichmentRequest, RequeryEnrichmentResponse, RequeryOverride, ScanDirectoryParams,
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
    peek_pending_jobs, try_claim_pending_job, update_session_progress, SessionJobCounts,
};

// re-export music job processors (used by runner module)
pub use music::{
    process_convert_webp_job, process_fetch_media_job, process_file_job, process_import_music_job,
    process_scan_directory_job,
};
