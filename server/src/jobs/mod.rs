//! Job queue module for thumbnail generation
//!
//! This module provides the infrastructure for managing thumbnail generation
//! jobs using a simple worker pool that polls the database directly.

pub mod queue;
pub mod thumbnail_job;

// Re-export main types
pub use queue::{QueueStats, ThumbnailJobQueue, ThumbnailJobQueueError};
pub use thumbnail_job::{JobExecutionResult, ThumbnailJobError, ThumbnailJobProcessor};
