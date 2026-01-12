//! Job queue module for thumbnail generation
//!
//! This module provides the infrastructure for managing thumbnail generation
//! jobs using a simple worker pool that polls the database directly.

pub mod analytics_job_queue;
pub mod music_job_queue;
pub mod queue;
pub mod thumbnail_job;

// Re-export main types
pub use analytics_job_queue::{
    AnalyticsJobData, AnalyticsJobQueue, AnalyticsJobQueueError, AnalyticsJobType,
    QueueStats as AnalyticsQueueStats,
};
pub use music_job_queue::{MusicJobQueue, MusicJobQueueError, QueueStats as MusicQueueStats};
pub use queue::{QueueStats, ThumbnailJobQueue, ThumbnailJobQueueError};
pub use thumbnail_job::{JobExecutionResult, ThumbnailJobError, ThumbnailJobProcessor};
