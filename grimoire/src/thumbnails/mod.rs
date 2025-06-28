//! Thumbnails domain module
//!
//! This module contains all thumbnail-related domain logic including
//! services, models, repositories for thumbnail generation and job management.

pub mod models;
pub mod repository;
pub mod service;

// Re-export core thumbnail types
pub use models::{
    CropStrategy, MediaBlobInfo, ThumbnailConfig, ThumbnailDimensions, ThumbnailError,
    ThumbnailFormats, ThumbnailJob, ThumbnailJobMetrics, ThumbnailJobPriority, ThumbnailJobStatus,
    ThumbnailJobType, ThumbnailResult, ThumbnailTimeouts,
};
pub use repository::ThumbnailRepository;
pub use service::{CleanupResult, DuplicateGroup, KeepStrategy, ThumbnailService};
