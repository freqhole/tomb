//! thumbnail generation and management module
//! handles image processing for album art, waveforms, and media previews

mod models;
mod service;

// re-export public types
pub use models::{
    CropStrategy, ThumbnailConfig, ThumbnailDimensions, ThumbnailFormat, ThumbnailJob,
    ThumbnailJobStatus, ThumbnailRequest, ThumbnailResult,
};
pub use service::{
    generate_thumbnail, get_thumbnail_job, list_thumbnail_jobs, queue_thumbnail_job,
};

// placeholder for future thumbnail functionality
// TODO: migrate from legacylib/src/thumbnails/
// - image processing pipeline
// - job queue management
// - format conversion
// - crop/resize strategies
