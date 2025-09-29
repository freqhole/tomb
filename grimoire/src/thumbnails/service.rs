//! Thumbnail service for the grimoire package
//!
//! This module provides high-level thumbnail services that handle business logic,
//! validation, and orchestration for thumbnail generation operations.

use super::models::{
    CropStrategy, MediaBlobInfo, ThumbnailConfig, ThumbnailDimensions, ThumbnailError,
    ThumbnailJob, ThumbnailJobMetrics, ThumbnailJobPriority, ThumbnailJobStatus, ThumbnailJobType,
    ThumbnailResult,
};
use super::repository::{DuplicateGroupRow, ThumbnailRepository};
use crate::DatabaseConnection;

use std::path::Path;
use time::OffsetDateTime;
use uuid::Uuid;

/// Health status for the thumbnail system
#[derive(Debug, Clone)]
pub struct ThumbnailSystemHealth {
    pub status: String,
    pub pending_jobs_count: i64,
    pub stuck_jobs_count: i64,
    pub recent_failures_count: i64,
    pub avg_queue_time_minutes: f64,
    pub recommendations: Vec<String>,
}

/// Thumbnail service that provides business logic for thumbnail operations
pub struct ThumbnailService<'a> {
    repo: ThumbnailRepository<'a>,
    config: ThumbnailConfig,
}

impl<'a> ThumbnailService<'a> {
    /// Create a new ThumbnailService
    pub fn new(db: &'a DatabaseConnection, config: ThumbnailConfig) -> Self {
        Self {
            repo: ThumbnailRepository::new(db),
            config,
        }
    }

    /// Create a new ThumbnailService with default configuration
    pub fn new_with_defaults(db: &'a DatabaseConnection) -> Self {
        Self::new(db, ThumbnailConfig::default())
    }

    /// Enqueue a thumbnail generation job for a media blob
    pub async fn enqueue_thumbnail_job(
        &self,
        media_blob_id: &str,
        job_type: ThumbnailJobType,
        priority: Option<ThumbnailJobPriority>,
        dimensions: Option<ThumbnailDimensions>,
    ) -> Result<Uuid, ThumbnailError> {
        if !self.config.enabled {
            return Err(ThumbnailError::Disabled);
        }

        // Check if media blob exists and get its info
        // Get media blob info to validate it exists
        let media_info = self
            .repo
            .get_media_blob_info(media_blob_id)
            .await?
            .ok_or(ThumbnailError::MediaBlobNotFound(media_blob_id.to_string()))?;

        // Validate that the media type supports the requested job type
        self.validate_media_type_for_job(&media_info.mime_type, &job_type)?;

        // Check if a job already exists for this blob and type
        if self
            .repo
            .job_exists_for_blob(media_blob_id, &job_type)
            .await?
        {
            return Err(ThumbnailError::InvalidConfiguration(
                "Job already exists for this media blob and type".to_string(),
            ));
        }

        // Create the job
        let job = ThumbnailJob {
            id: Uuid::new_v4(),
            media_blob_id: media_blob_id.to_string(),
            job_type,
            target_dimensions: dimensions.or_else(|| Some(self.config.default_dimensions.clone())),
            status: ThumbnailJobStatus::Pending,
            priority: priority.unwrap_or_default(),
            created_at: OffsetDateTime::now_utc(),
            updated_at: OffsetDateTime::now_utc(),
            scheduled_at: OffsetDateTime::now_utc(),
            retry_count: 0,
            max_retries: 3,
            error_message: None,
            worker_id: None,
            metadata: None,
        };

        // Enqueue the job
        self.repo.enqueue_job(&job).await?;

        Ok(job.id)
    }

    /// Automatically determine and enqueue appropriate thumbnail jobs for a media blob
    pub async fn auto_enqueue_for_media_blob(
        &self,
        media_blob_id: &str,
    ) -> Result<Vec<Uuid>, ThumbnailError> {
        if !self.config.enabled {
            return Err(ThumbnailError::Disabled);
        }

        // Get media blob info
        let media_info = self
            .repo
            .get_media_blob_info(media_blob_id)
            .await?
            .ok_or(ThumbnailError::MediaBlobNotFound(media_blob_id.to_string()))?;

        let mut job_ids = Vec::new();

        // Determine appropriate job types based on MIME type
        let job_types = self.determine_job_types_for_mime(&media_info.mime_type)?;

        for job_type in job_types {
            // Skip if job already exists
            if self
                .repo
                .job_exists_for_blob(media_blob_id, &job_type)
                .await?
            {
                continue;
            }

            let job_id = self
                .enqueue_thumbnail_job(
                    media_blob_id,
                    job_type,
                    Some(ThumbnailJobPriority::Normal),
                    None,
                )
                .await?;
            job_ids.push(job_id);
        }

        Ok(job_ids)
    }

    /// Get pending jobs ready for processing
    pub async fn get_pending_jobs(&self, limit: i32) -> Result<Vec<ThumbnailJob>, ThumbnailError> {
        self.repo.get_pending_jobs(limit).await
    }

    /// Update job status
    pub async fn update_job_status(
        &self,
        job_id: Uuid,
        status: ThumbnailJobStatus,
        error_message: Option<String>,
        worker_id: Option<String>,
    ) -> Result<(), ThumbnailError> {
        self.repo
            .update_job_status(job_id, status, error_message, worker_id)
            .await
    }

    /// Generate thumbnail for a specific job
    pub async fn generate_thumbnail(
        &self,
        job: &ThumbnailJob,
    ) -> Result<ThumbnailResult, ThumbnailError> {
        if !self.config.enabled {
            return Err(ThumbnailError::Disabled);
        }

        // Get media blob info
        let media_info = self
            .repo
            .get_media_blob_info(&job.media_blob_id)
            .await?
            .ok_or(ThumbnailError::MediaBlobNotFound(job.media_blob_id.clone()))?;

        // Validate media data is available
        if !media_info.has_data() {
            return Err(ThumbnailError::FileNotFound(
                "Media blob has no data available (neither local_path nor data field)".to_string(),
            ));
        }

        // Prepare input file path (either existing file or temporary file from data)
        let input_path = self.prepare_input_file(&media_info).await?;

        // Generate thumbnail based on job type
        let result = match job.job_type {
            ThumbnailJobType::ImageThumbnail => {
                self.generate_image_thumbnail_with_path(&input_path, &media_info, job)
                    .await
            }
            ThumbnailJobType::VideoThumbnail => {
                self.generate_video_thumbnail_with_path(&input_path, &media_info, job)
                    .await
            }
            ThumbnailJobType::AudioWaveform => {
                self.generate_audio_waveform_with_path(&input_path, &media_info, job)
                    .await
            }
            ThumbnailJobType::VideoPreview => {
                self.generate_video_preview_with_path(&input_path, &media_info, job)
                    .await
            }
        };

        // Clean up temporary file if we created one
        if media_info.is_small_file() {
            if let Err(e) = std::fs::remove_file(&input_path) {
                tracing::warn!("Failed to clean up temporary file {}: {}", input_path, e);
            }
        }

        result
    }

    /// Store generated thumbnail
    pub async fn store_thumbnail(
        &self,
        thumbnail: &ThumbnailResult,
    ) -> Result<String, ThumbnailError> {
        self.repo.store_thumbnail(thumbnail).await
    }

    /// Get existing thumbnails for a media blob
    pub async fn get_thumbnails_for_blob(
        &self,
        blob_id: &str,
    ) -> Result<Vec<MediaBlobInfo>, ThumbnailError> {
        self.repo.get_thumbnails_for_blob(blob_id).await
    }

    /// Get job metrics for monitoring
    pub async fn get_job_metrics(&self) -> Result<ThumbnailJobMetrics, ThumbnailError> {
        self.repo.get_job_metrics().await
    }

    /// Clean up old completed jobs
    pub async fn cleanup_old_jobs(
        &self,
        older_than: OffsetDateTime,
    ) -> Result<u64, ThumbnailError> {
        self.repo.cleanup_old_jobs(older_than).await
    }

    /// Retry failed jobs
    pub async fn retry_failed_jobs(&self) -> Result<u64, ThumbnailError> {
        self.repo
            .retry_failed_jobs(self.config.max_concurrent_jobs as i32)
            .await
    }

    /// Get jobs by status
    pub async fn get_jobs_by_status(
        &self,
        status: ThumbnailJobStatus,
        limit: i32,
    ) -> Result<Vec<ThumbnailJob>, ThumbnailError> {
        self.repo.get_jobs_by_status(status, limit).await
    }

    /// Get comprehensive health check of the thumbnail system
    pub async fn get_system_health(&self) -> Result<ThumbnailSystemHealth, ThumbnailError> {
        let health_summary = self.repo.get_system_health().await?;

        Ok(ThumbnailSystemHealth {
            status: health_summary.status,
            pending_jobs_count: health_summary.pending_jobs_count,
            stuck_jobs_count: health_summary.stuck_jobs_count,
            recent_failures_count: health_summary.recent_failures_count,
            avg_queue_time_minutes: health_summary.avg_queue_time_minutes,
            recommendations: health_summary.recommendations,
        })
    }

    /// Cancel stale jobs that have been processing too long
    pub async fn cancel_stale_jobs(&self, timeout_minutes: i32) -> Result<u64, ThumbnailError> {
        self.repo.cancel_stale_jobs(timeout_minutes).await
    }

    /// Check if thumbnails are enabled
    pub fn is_enabled(&self) -> bool {
        self.config.enabled
    }

    /// Get current configuration
    pub fn config(&self) -> &ThumbnailConfig {
        &self.config
    }

    /// Update configuration
    pub fn update_config(&mut self, config: ThumbnailConfig) {
        self.config = config;
    }

    /// Validate external tool availability
    pub async fn validate_tools(&self) -> Result<(), ThumbnailError> {
        // Check ImageMagick
        let imagemagick_cmd = self.config.imagemagick_path.as_deref().unwrap_or("convert");
        if !self.is_tool_available(imagemagick_cmd).await {
            return Err(ThumbnailError::ExternalToolNotFound(
                "ImageMagick (convert)".to_string(),
            ));
        }

        // Check FFmpeg
        let ffmpeg_cmd = self.config.ffmpeg_path.as_deref().unwrap_or("ffmpeg");
        if !self.is_tool_available(ffmpeg_cmd).await {
            return Err(ThumbnailError::ExternalToolNotFound("FFmpeg".to_string()));
        }

        Ok(())
    }

    /// Validate media type supports the requested job type
    fn validate_media_type_for_job(
        &self,
        mime_type: &str,
        job_type: &ThumbnailJobType,
    ) -> Result<(), ThumbnailError> {
        Self::validate_media_type_for_job_static(mime_type, job_type)
    }

    /// Static version for testing - validate media type supports the requested job type
    fn validate_media_type_for_job_static(
        mime_type: &str,
        job_type: &ThumbnailJobType,
    ) -> Result<(), ThumbnailError> {
        match job_type {
            ThumbnailJobType::ImageThumbnail => {
                if !mime_type.starts_with("image/") {
                    return Err(ThumbnailError::UnsupportedMediaType(mime_type.to_string()));
                }
            }
            ThumbnailJobType::VideoThumbnail | ThumbnailJobType::VideoPreview => {
                if !mime_type.starts_with("video/") {
                    return Err(ThumbnailError::UnsupportedMediaType(mime_type.to_string()));
                }
            }
            ThumbnailJobType::AudioWaveform => {
                if !mime_type.starts_with("audio/") {
                    return Err(ThumbnailError::UnsupportedMediaType(mime_type.to_string()));
                }
            }
        }
        Ok(())
    }

    /// Determine appropriate job types for a MIME type
    fn determine_job_types_for_mime(
        &self,
        mime_type: &str,
    ) -> Result<Vec<ThumbnailJobType>, ThumbnailError> {
        Self::determine_job_types_for_mime_static(mime_type)
    }

    /// Static version for testing - determine appropriate job types for a MIME type
    fn determine_job_types_for_mime_static(
        mime_type: &str,
    ) -> Result<Vec<ThumbnailJobType>, ThumbnailError> {
        let mut job_types = Vec::new();

        if mime_type.starts_with("image/") {
            job_types.push(ThumbnailJobType::ImageThumbnail);
        } else if mime_type.starts_with("video/") {
            job_types.push(ThumbnailJobType::VideoThumbnail);
            job_types.push(ThumbnailJobType::VideoPreview);
        } else if mime_type.starts_with("audio/") {
            job_types.push(ThumbnailJobType::AudioWaveform);
        } else {
            return Err(ThumbnailError::UnsupportedMediaType(mime_type.to_string()));
        }

        Ok(job_types)
    }

    /// Check if external tool is available
    async fn is_tool_available(&self, tool_command: &str) -> bool {
        // Try to run the tool with --version or --help to check availability
        tokio::process::Command::new(tool_command)
            .arg("--version")
            .output()
            .await
            .is_ok()
    }

    /// Prepare input file path for processing
    /// - For files stored on disk: returns the existing path
    /// - For files stored in database: creates a temporary file and returns its path
    async fn prepare_input_file(
        &self,
        media_info: &MediaBlobInfo,
    ) -> Result<String, ThumbnailError> {
        if media_info.is_large_file() {
            // File is stored on disk, construct full path from relative database path
            let relative_path = media_info.local_path.as_ref().unwrap();
            // Database stores relative paths like "private/uploads/filename"
            // We need to construct the full path using the configured upload directory
            let full_path = if relative_path.starts_with(&self.config.upload_directory) {
                relative_path.clone()
            } else {
                // If the stored path is relative, prepend the upload directory
                if relative_path.starts_with("private/uploads/")
                    || relative_path.starts_with("uploads/")
                {
                    // Legacy path format - use the configured upload directory
                    let filename = relative_path.split('/').last().unwrap();
                    format!("{}/{}", self.config.upload_directory, filename)
                } else {
                    // Assume it's already relative to upload directory
                    format!("{}/{}", self.config.upload_directory, relative_path)
                }
            };

            if !Path::new(&full_path).exists() {
                return Err(ThumbnailError::FileNotFound(full_path));
            }
            Ok(full_path)
        } else if media_info.is_small_file() {
            // File is stored in database, create temporary file
            let data = media_info.data.as_ref().unwrap();

            // Determine file extension from MIME type
            let extension = self.get_extension_from_mime(&media_info.mime_type);

            // Create temporary file path in system temp directory
            let temp_dir = std::env::temp_dir();
            let temp_filename = if extension.is_empty() {
                format!("thumbnail_input_{}", uuid::Uuid::new_v4())
            } else {
                format!("thumbnail_input_{}.{}", uuid::Uuid::new_v4(), extension)
            };
            let temp_path = temp_dir.join(temp_filename);

            // Write data to temporary file
            std::fs::write(&temp_path, data).map_err(|e| ThumbnailError::Io(e))?;

            Ok(temp_path.to_string_lossy().to_string())
        } else {
            Err(ThumbnailError::FileNotFound(
                "Media blob has no valid data source".to_string(),
            ))
        }
    }

    /// Get file extension from MIME type
    fn get_extension_from_mime(&self, mime_type: &str) -> String {
        match mime_type {
            "image/jpeg" => "jpg",
            "image/png" => "png",
            "image/gif" => "gif",
            "image/webp" => "webp",
            "image/bmp" => "bmp",
            "image/tiff" => "tiff",
            "video/mp4" => "mp4",
            "video/mpeg" => "mpeg",
            "video/quicktime" => "mov",
            "video/x-msvideo" => "avi",
            "video/webm" => "webm",
            "audio/mpeg" => "mp3",
            "audio/wav" => "wav",
            "audio/ogg" => "ogg",
            "audio/flac" => "flac",
            "audio/x-aiff" => "aif",
            // "audio/ogg" => "opus",
            "audio/aac" => "aac",
            "audio/alac" => "alac", // audio/mp4 maybe better?
            _ => "",
        }
        .to_string()
    }

    /// Generate image thumbnail using ImageMagick with provided input path
    async fn generate_image_thumbnail_with_path(
        &self,
        input_path: &str,
        media_info: &MediaBlobInfo,
        job: &ThumbnailJob,
    ) -> Result<ThumbnailResult, ThumbnailError> {
        let dimensions = job
            .target_dimensions
            .as_ref()
            .unwrap_or(&self.config.default_dimensions);

        // Create output path
        let output_path = self.create_output_path(
            &media_info.id,
            "thumbnail",
            &self.config.formats.image_format,
        )?;

        // Build ImageMagick command
        let imagemagick_cmd = self.config.imagemagick_path.as_deref().unwrap_or("convert");
        let mut cmd = tokio::process::Command::new(imagemagick_cmd);

        cmd.arg(input_path);

        // Add resize parameters based on crop strategy
        match dimensions.crop_strategy {
            CropStrategy::Fit => {
                cmd.arg("-resize")
                    .arg(format!("{}x{}", dimensions.width, dimensions.height));
            }
            CropStrategy::Fill | CropStrategy::Center => {
                cmd.arg("-resize")
                    .arg(format!("{}x{}^", dimensions.width, dimensions.height))
                    .arg("-gravity")
                    .arg("center")
                    .arg("-extent")
                    .arg(format!("{}x{}", dimensions.width, dimensions.height));
            }
            _ => {
                cmd.arg("-resize")
                    .arg(format!("{}x{}", dimensions.width, dimensions.height));
            }
        }

        // Add quality setting
        cmd.arg("-quality").arg(self.config.quality.to_string());

        // Set output path
        cmd.arg(&output_path);

        // Execute command with timeout
        let output = tokio::time::timeout(
            tokio::time::Duration::from_secs(self.config.timeouts.image_processing_seconds as u64),
            cmd.output(),
        )
        .await
        .map_err(|_| ThumbnailError::Timeout)?
        .map_err(|e| ThumbnailError::ExternalToolFailed(e.to_string()))?;

        if !output.status.success() {
            let error_msg = String::from_utf8_lossy(&output.stderr);
            return Err(ThumbnailError::ExternalToolFailed(error_msg.to_string()));
        }

        // Get file size
        let metadata = tokio::fs::metadata(&output_path).await?;

        Ok(ThumbnailResult {
            media_blob_id: media_info.id.clone(),
            local_path: output_path,
            mime_type: format!("image/{}", self.config.formats.image_format),
            size: metadata.len() as i64,
            dimensions: dimensions.clone(),
            blob_type: "thumbnail".to_string(),
            metadata: serde_json::json!({
                "original_mime": media_info.mime_type,
                "processing_tool": "imagemagick",
                "quality": self.config.quality
            }),
        })
    }

    /// Generate video thumbnail using FFmpeg with provided input path
    async fn generate_video_thumbnail_with_path(
        &self,
        input_path: &str,
        media_info: &MediaBlobInfo,
        job: &ThumbnailJob,
    ) -> Result<ThumbnailResult, ThumbnailError> {
        let dimensions = job
            .target_dimensions
            .as_ref()
            .unwrap_or(&self.config.default_dimensions);

        // Create output path
        let output_path = self.create_output_path(
            &media_info.id,
            "thumbnail",
            &self.config.formats.video_format,
        )?;

        // Build FFmpeg command to extract frame at 10% of video duration
        let ffmpeg_cmd = self.config.ffmpeg_path.as_deref().unwrap_or("ffmpeg");
        let mut cmd = tokio::process::Command::new(ffmpeg_cmd);

        cmd.arg("-i")
            .arg(input_path)
            .arg("-ss")
            .arg("00:00:01") // Seek to 1 second
            .arg("-vframes")
            .arg("1")
            .arg("-vf")
            .arg(format!("scale={}:{}", dimensions.width, dimensions.height))
            .arg("-y") // Overwrite output file
            .arg(&output_path);

        // Execute command with timeout
        let output = tokio::time::timeout(
            tokio::time::Duration::from_secs(self.config.timeouts.video_processing_seconds as u64),
            cmd.output(),
        )
        .await
        .map_err(|_| ThumbnailError::Timeout)?
        .map_err(|e| ThumbnailError::ExternalToolFailed(e.to_string()))?;

        if !output.status.success() {
            let error_msg = String::from_utf8_lossy(&output.stderr);
            return Err(ThumbnailError::ExternalToolFailed(error_msg.to_string()));
        }

        // Get file size
        let metadata = tokio::fs::metadata(&output_path).await?;

        Ok(ThumbnailResult {
            media_blob_id: media_info.id.clone(),
            local_path: output_path,
            mime_type: format!("image/{}", self.config.formats.video_format),
            size: metadata.len() as i64,
            dimensions: dimensions.clone(),
            blob_type: "thumbnail".to_string(),
            metadata: serde_json::json!({
                "original_mime": media_info.mime_type,
                "processing_tool": "ffmpeg",
                "seek_time": "00:00:01"
            }),
        })
    }

    /// Generate audio waveform using FFmpeg with provided input path
    async fn generate_audio_waveform_with_path(
        &self,
        input_path: &str,
        media_info: &MediaBlobInfo,
        job: &ThumbnailJob,
    ) -> Result<ThumbnailResult, ThumbnailError> {
        let dimensions = job
            .target_dimensions
            .as_ref()
            .unwrap_or(&self.config.default_dimensions);

        // Create output path
        let output_path = self.create_output_path(
            &media_info.id,
            "waveform",
            &self.config.formats.waveform_format,
        )?;

        // Build FFmpeg command to generate waveform
        let ffmpeg_cmd = self.config.ffmpeg_path.as_deref().unwrap_or("ffmpeg");
        let mut cmd = tokio::process::Command::new(ffmpeg_cmd);

        cmd.arg("-i")
            .arg(input_path)
            .arg("-filter_complex")
            .arg(format!(
                "showwavespic=s={}x{}:colors=0x3b82f6",
                dimensions.width, dimensions.height
            ))
            .arg("-frames:v")
            .arg("1")
            .arg("-y")
            .arg(&output_path);

        // Execute command with timeout
        let output = tokio::time::timeout(
            tokio::time::Duration::from_secs(self.config.timeouts.audio_processing_seconds as u64),
            cmd.output(),
        )
        .await
        .map_err(|_| ThumbnailError::Timeout)?
        .map_err(|e| ThumbnailError::ExternalToolFailed(e.to_string()))?;

        if !output.status.success() {
            let error_msg = String::from_utf8_lossy(&output.stderr);
            return Err(ThumbnailError::ExternalToolFailed(error_msg.to_string()));
        }

        // Get file size
        let metadata = tokio::fs::metadata(&output_path).await?;

        Ok(ThumbnailResult {
            media_blob_id: media_info.id.clone(),
            local_path: output_path,
            mime_type: format!("image/{}", self.config.formats.waveform_format),
            size: metadata.len() as i64,
            dimensions: dimensions.clone(),
            blob_type: "waveform".to_string(),
            metadata: serde_json::json!({
                "original_mime": media_info.mime_type,
                "processing_tool": "ffmpeg",
                "visualization": "waveform"
            }),
        })
    }

    /// Generate video preview using FFmpeg with provided input path
    async fn generate_video_preview_with_path(
        &self,
        input_path: &str,
        media_info: &MediaBlobInfo,
        job: &ThumbnailJob,
    ) -> Result<ThumbnailResult, ThumbnailError> {
        let dimensions = job
            .target_dimensions
            .as_ref()
            .unwrap_or(&self.config.default_dimensions);

        // Create output path
        let output_path =
            self.create_output_path(&media_info.id, "preview", &self.config.formats.video_format)?;

        // Build FFmpeg command to create preview (multiple frames combined)
        let ffmpeg_cmd = self.config.ffmpeg_path.as_deref().unwrap_or("ffmpeg");
        let mut cmd = tokio::process::Command::new(ffmpeg_cmd);

        cmd.arg("-i")
            .arg(input_path)
            .arg("-vf")
            .arg(format!(
                "select='not(mod(n\\,30))',scale={}:{},tile=3x3",
                dimensions.width / 3,
                dimensions.height / 3
            ))
            .arg("-frames:v")
            .arg("1")
            .arg("-y")
            .arg(&output_path);

        // Execute command with timeout
        let output = tokio::time::timeout(
            tokio::time::Duration::from_secs(self.config.timeouts.video_processing_seconds as u64),
            cmd.output(),
        )
        .await
        .map_err(|_| ThumbnailError::Timeout)?
        .map_err(|e| ThumbnailError::ExternalToolFailed(e.to_string()))?;

        if !output.status.success() {
            let error_msg = String::from_utf8_lossy(&output.stderr);
            return Err(ThumbnailError::ExternalToolFailed(error_msg.to_string()));
        }

        // Get file size
        let metadata = tokio::fs::metadata(&output_path).await?;

        Ok(ThumbnailResult {
            media_blob_id: media_info.id.clone(),
            local_path: output_path,
            mime_type: format!("image/{}", self.config.formats.video_format),
            size: metadata.len() as i64,
            dimensions: dimensions.clone(),
            blob_type: "preview".to_string(),
            metadata: serde_json::json!({
                "original_mime": media_info.mime_type,
                "processing_tool": "ffmpeg",
                "preview_type": "tile_3x3"
            }),
        })
    }

    /// Create output path for generated thumbnails
    fn create_output_path(
        &self,
        media_blob_id: &str,
        thumbnail_type: &str,
        format: &str,
    ) -> Result<String, ThumbnailError> {
        // Ensure storage directory exists
        std::fs::create_dir_all(&self.config.storage_path).map_err(|e| ThumbnailError::Io(e))?;

        let filename = format!("{}_{}.{}", media_blob_id, thumbnail_type, format);
        let path = Path::new(&self.config.storage_path).join(filename);

        Ok(path
            .to_str()
            .ok_or_else(|| {
                ThumbnailError::InvalidConfiguration("Invalid storage path".to_string())
            })?
            .to_string())
    }

    /// Find duplicate thumbnails grouped by parent blob and type
    pub async fn find_duplicate_thumbnails(&self) -> Result<Vec<DuplicateGroup>, ThumbnailError> {
        let duplicate_rows: Vec<DuplicateGroupRow> = self.repo.find_duplicate_thumbnails().await?;

        let duplicate_groups = duplicate_rows
            .into_iter()
            .map(|row| DuplicateGroup {
                parent_blob_id: row.parent_blob_id,
                blob_type: row.blob_type,
                duplicate_count: row.duplicate_count,
                thumbnail_ids: row.thumbnail_ids,
            })
            .collect();

        Ok(duplicate_groups)
    }

    /// Delete duplicate thumbnails, keeping either the first (oldest) or last (newest)
    pub async fn cleanup_duplicate_thumbnails(
        &self,
        keep_strategy: KeepStrategy,
    ) -> Result<CleanupResult, ThumbnailError> {
        let duplicate_groups = self.find_duplicate_thumbnails().await?;

        if duplicate_groups.is_empty() {
            return Ok(CleanupResult {
                groups_processed: 0,
                thumbnails_deleted: 0,
            });
        }

        let mut total_deleted = 0;
        let groups_count = duplicate_groups.len();

        for group in duplicate_groups {
            let ids_to_delete: Vec<String> = match keep_strategy {
                KeepStrategy::First => {
                    // Keep the first (oldest), delete the rest
                    group.thumbnail_ids.into_iter().skip(1).collect()
                }
                KeepStrategy::Last => {
                    // Keep the last (newest), delete all but the last
                    let mut ids = group.thumbnail_ids;
                    ids.pop(); // Remove the last one to keep it
                    ids
                }
            };

            if !ids_to_delete.is_empty() {
                let deleted_count = self.repo.delete_thumbnails_by_ids(&ids_to_delete).await?;
                total_deleted += deleted_count as usize;
            }
        }

        Ok(CleanupResult {
            groups_processed: groups_count,
            thumbnails_deleted: total_deleted,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_determine_job_types_for_mime() {
        // Test image MIME types
        let job_types =
            ThumbnailService::<'_>::determine_job_types_for_mime_static("image/jpeg").unwrap();
        assert_eq!(job_types, vec![ThumbnailJobType::ImageThumbnail]);

        // Test video MIME types
        let job_types =
            ThumbnailService::<'_>::determine_job_types_for_mime_static("video/mp4").unwrap();
        assert_eq!(
            job_types,
            vec![
                ThumbnailJobType::VideoThumbnail,
                ThumbnailJobType::VideoPreview
            ]
        );

        // Test audio MIME types
        let job_types =
            ThumbnailService::<'_>::determine_job_types_for_mime_static("audio/mpeg").unwrap();
        assert_eq!(job_types, vec![ThumbnailJobType::AudioWaveform]);

        // Test unsupported MIME type
        let result = ThumbnailService::<'_>::determine_job_types_for_mime_static("application/pdf");
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_media_type_for_job() {
        // Valid combinations
        assert!(ThumbnailService::<'_>::validate_media_type_for_job_static(
            "image/jpeg",
            &ThumbnailJobType::ImageThumbnail
        )
        .is_ok());
        assert!(ThumbnailService::<'_>::validate_media_type_for_job_static(
            "video/mp4",
            &ThumbnailJobType::VideoThumbnail
        )
        .is_ok());
        assert!(ThumbnailService::<'_>::validate_media_type_for_job_static(
            "audio/mpeg",
            &ThumbnailJobType::AudioWaveform
        )
        .is_ok());

        // Invalid combinations
        assert!(ThumbnailService::<'_>::validate_media_type_for_job_static(
            "video/mp4",
            &ThumbnailJobType::ImageThumbnail
        )
        .is_err());
        assert!(ThumbnailService::<'_>::validate_media_type_for_job_static(
            "image/jpeg",
            &ThumbnailJobType::AudioWaveform
        )
        .is_err());
    }

    #[test]
    fn test_thumbnail_job_type_string_conversion() {
        assert_eq!(
            ThumbnailJobType::ImageThumbnail.to_string(),
            "image_thumbnail"
        );
        assert_eq!(
            ThumbnailJobType::VideoThumbnail.to_string(),
            "video_thumbnail"
        );
        assert_eq!(
            ThumbnailJobType::AudioWaveform.to_string(),
            "audio_waveform"
        );
        assert_eq!(ThumbnailJobType::VideoPreview.to_string(), "video_preview");

        assert_eq!(
            ThumbnailJobType::from_str("image_thumbnail").unwrap(),
            ThumbnailJobType::ImageThumbnail
        );
        assert_eq!(
            ThumbnailJobType::from_str("video_thumbnail").unwrap(),
            ThumbnailJobType::VideoThumbnail
        );
        assert!(ThumbnailJobType::from_str("invalid").is_err());
    }

    #[test]
    fn test_create_output_path() {
        let config = ThumbnailConfig {
            storage_path: "/tmp/test_thumbnails".to_string(),
            ..ThumbnailConfig::default()
        };
        let service = MockThumbnailService::new(config);

        let media_id = uuid::Uuid::new_v4();
        let path = service
            .create_output_path_test(&media_id, "thumbnail", "webp")
            .unwrap();

        assert!(path.starts_with("/tmp/test_thumbnails"));
        assert!(path.contains(&media_id.to_string()));
        assert!(path.ends_with("_thumbnail.webp"));
    }

    #[test]
    fn test_output_path_invalid_storage() {
        let config = ThumbnailConfig {
            storage_path: "".to_string(),
            ..ThumbnailConfig::default()
        };
        let service = MockThumbnailService::new(config);

        let media_id = uuid::Uuid::new_v4();
        let result = service.create_output_path_test(&media_id, "thumbnail", "webp");
        assert!(result.is_err());
    }

    #[test]
    fn test_thumbnail_config_validation() {
        // Valid config
        let config = ThumbnailConfig::default();
        let service = MockThumbnailService::new(config);
        assert!(service.config().enabled);
        assert_eq!(service.config().quality, 85);
        assert_eq!(service.config().max_concurrent_jobs, 4);

        // Test disabled config
        let disabled_config = ThumbnailConfig {
            enabled: false,
            ..ThumbnailConfig::default()
        };
        let disabled_service = MockThumbnailService::new(disabled_config);
        assert!(!disabled_service.is_enabled());
    }

    #[test]
    fn test_mime_type_validation_edge_cases() {
        // Test case sensitivity
        assert!(ThumbnailService::<'_>::validate_media_type_for_job_static(
            "Image/JPEG",
            &ThumbnailJobType::ImageThumbnail
        )
        .is_err());

        // Test partial matches
        assert!(ThumbnailService::<'_>::validate_media_type_for_job_static(
            "text/image",
            &ThumbnailJobType::ImageThumbnail
        )
        .is_err());

        // Test empty string
        assert!(ThumbnailService::<'_>::validate_media_type_for_job_static(
            "",
            &ThumbnailJobType::ImageThumbnail
        )
        .is_err());
    }

    #[test]
    fn test_job_type_determination_edge_cases() {
        // Test exact MIME type matches
        let image_jobs =
            ThumbnailService::<'_>::determine_job_types_for_mime_static("image/").unwrap();
        assert_eq!(image_jobs, vec![ThumbnailJobType::ImageThumbnail]);

        let video_jobs =
            ThumbnailService::<'_>::determine_job_types_for_mime_static("video/").unwrap();
        assert_eq!(
            video_jobs,
            vec![
                ThumbnailJobType::VideoThumbnail,
                ThumbnailJobType::VideoPreview
            ]
        );

        let audio_jobs =
            ThumbnailService::<'_>::determine_job_types_for_mime_static("audio/").unwrap();
        assert_eq!(audio_jobs, vec![ThumbnailJobType::AudioWaveform]);

        // Test specific MIME types
        let webp_jobs =
            ThumbnailService::<'_>::determine_job_types_for_mime_static("image/webp").unwrap();
        assert_eq!(webp_jobs, vec![ThumbnailJobType::ImageThumbnail]);

        let mp4_jobs =
            ThumbnailService::<'_>::determine_job_types_for_mime_static("video/mp4").unwrap();
        assert_eq!(
            mp4_jobs,
            vec![
                ThumbnailJobType::VideoThumbnail,
                ThumbnailJobType::VideoPreview
            ]
        );

        let flac_jobs =
            ThumbnailService::<'_>::determine_job_types_for_mime_static("audio/flac").unwrap();
        assert_eq!(flac_jobs, vec![ThumbnailJobType::AudioWaveform]);
    }

    #[test]
    fn test_multiple_media_type_validations() {
        let image_types = [
            "image/jpeg",
            "image/png",
            "image/gif",
            "image/webp",
            "image/tiff",
            "image/bmp",
        ];

        for mime_type in &image_types {
            assert!(ThumbnailService::<'_>::validate_media_type_for_job_static(
                mime_type,
                &ThumbnailJobType::ImageThumbnail
            )
            .is_ok());
        }

        let video_types = [
            "video/mp4",
            "video/avi",
            "video/mov",
            "video/webm",
            "video/mkv",
        ];

        for mime_type in &video_types {
            assert!(ThumbnailService::<'_>::validate_media_type_for_job_static(
                mime_type,
                &ThumbnailJobType::VideoThumbnail
            )
            .is_ok());
        }

        let audio_types = [
            "audio/mp3",
            "audio/wav",
            "audio/flac",
            "audio/ogg",
            "audio/aac",
        ];

        for mime_type in &audio_types {
            assert!(ThumbnailService::<'_>::validate_media_type_for_job_static(
                mime_type,
                &ThumbnailJobType::AudioWaveform
            )
            .is_ok());
        }
    }

    // Mock service for testing private methods
    struct MockThumbnailService {
        config: ThumbnailConfig,
    }

    impl MockThumbnailService {
        fn new(config: ThumbnailConfig) -> Self {
            Self { config }
        }

        fn config(&self) -> &ThumbnailConfig {
            &self.config
        }

        fn is_enabled(&self) -> bool {
            self.config.enabled
        }

        fn create_output_path_test(
            &self,
            media_blob_id: &uuid::Uuid,
            thumbnail_type: &str,
            format: &str,
        ) -> Result<String, ThumbnailError> {
            if self.config.storage_path.is_empty() {
                return Err(ThumbnailError::InvalidConfiguration(
                    "Invalid storage path".to_string(),
                ));
            }

            let filename = format!("{}_{}.{}", media_blob_id, thumbnail_type, format);
            let path = std::path::Path::new(&self.config.storage_path).join(filename);

            Ok(path
                .to_str()
                .ok_or_else(|| {
                    ThumbnailError::InvalidConfiguration("Invalid storage path".to_string())
                })?
                .to_string())
        }
    }
}

/// Strategy for which duplicate to keep
#[derive(Debug, Clone, Copy)]
pub enum KeepStrategy {
    /// Keep the first (oldest) thumbnail
    First,
    /// Keep the last (newest) thumbnail
    Last,
}

/// Information about a group of duplicate thumbnails
#[derive(Debug)]
pub struct DuplicateGroup {
    pub parent_blob_id: String,
    pub blob_type: String,
    pub duplicate_count: usize,
    pub thumbnail_ids: Vec<String>,
}

/// Result of duplicate cleanup operation
#[derive(Debug)]
pub struct CleanupResult {
    pub groups_processed: usize,
    pub thumbnails_deleted: usize,
}
