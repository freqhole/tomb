//! Download module for URL-based music downloads using yt-dlp
//!
//! This module provides functionality to download music from URLs using yt-dlp
//! and then process them through the existing music job pipeline.

pub mod jobs;
pub mod queue;
pub mod routes;

// Re-export commonly used types
pub use jobs::{
    create_download_job, get_pending_jobs, process_download_job, update_job_status, DownloadJob,
    DownloadJobStatus,
};
pub use queue::{DownloadJobQueue, DownloadQueueStats};
pub use routes::{create_routes, DownloadJobInfo, DownloadUrlsRequest, DownloadUrlsResponse};
