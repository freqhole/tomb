//! Videos domain module
//!
//! This module provides video processing functionality including:
//! - Video file processing and storage
//! - Video metadata extraction
//! - Video playlist management
//! - Video thumbnail generation
//! - Database integration for videos

pub mod metadata;
pub mod models;
pub mod repository;
pub mod scanner;
pub mod service;

pub use metadata::{
    extract_full_video_metadata, extract_metadata_batch, is_ffprobe_available,
    is_supported_extension, supported_video_extensions, BasicVideoInfo, VideoMetadataError,
    VideoMetadataExtractor,
};
pub use models::*;
pub use repository::{VideoRepository, VideoRepositoryError};
pub use scanner::VideoScanner;
pub use service::{VideoService, VideoServiceError, VideoStats};
