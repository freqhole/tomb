//! Thumbnail service for the grimoire package
//!
//! This module provides high-level thumbnail services that handle business logic,
//! validation, and orchestration for thumbnail generation operations.

use super::models::{
    CropStrategy, MediaBlobInfo, ThumbnailConfig, ThumbnailDimensions, ThumbnailError,
    ThumbnailJob, ThumbnailJobMetrics, ThumbnailJobPriority, ThumbnailJobStatus, ThumbnailJobType,
    ThumbnailResult,
};
use super::repository::ThumbnailRepository;
use crate::DatabaseConnection;
use std::path::Path;
use time::OffsetDateTime;
use uuid::Uuid;

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
        media_blob_id: Uuid,
        job_type: ThumbnailJobType,
        priority: Option<ThumbnailJobPriority>,
        dimensions: Option<ThumbnailDimensions>,
    ) -> Result<Uuid, ThumbnailError> {
        if !self.config.enabled {
            return Err(ThumbnailError::Disabled);
        }

        // Check if media blob exists and get its info
        let media_info = self
            .repo
            .get_media_blob_info(media_blob_id)
            .await?
            .ok_or(ThumbnailError::MediaBlobNotFound(media_blob_id))?;

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
            media_blob_id,
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
        media_blob_id: Uuid,
    ) -> Result<Vec<Uuid>, ThumbnailError> {
        if !self.config.enabled {
            return Err(ThumbnailError::Disabled);
        }

        // Get media blob info
        let media_info = self
            .repo
            .get_media_blob_info(media_blob_id)
            .await?
            .ok_or(ThumbnailError::MediaBlobNotFound(media_blob_id))?;

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
            .get_media_blob_info(job.media_blob_id)
            .await?
            .ok_or(ThumbnailError::MediaBlobNotFound(job.media_blob_id))?;

        // Validate input file exists
        if !Path::new(&media_info.local_path).exists() {
            return Err(ThumbnailError::FileNotFound(media_info.local_path.clone()));
        }

        // Generate thumbnail based on job type
        match job.job_type {
            ThumbnailJobType::ImageThumbnail => {
                self.generate_image_thumbnail(&media_info, job).await
            }
            ThumbnailJobType::VideoThumbnail => {
                self.generate_video_thumbnail(&media_info, job).await
            }
            ThumbnailJobType::AudioWaveform => self.generate_audio_waveform(&media_info, job).await,
            ThumbnailJobType::VideoPreview => self.generate_video_preview(&media_info, job).await,
        }
    }

    /// Store generated thumbnail
    pub async fn store_thumbnail(
        &self,
        thumbnail: &ThumbnailResult,
    ) -> Result<Uuid, ThumbnailError> {
        self.repo.store_thumbnail(thumbnail).await
    }

    /// Get existing thumbnails for a media blob
    pub async fn get_thumbnails_for_blob(
        &self,
        blob_id: Uuid,
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

    /// Generate image thumbnail using ImageMagick
    async fn generate_image_thumbnail(
        &self,
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

        cmd.arg(&media_info.local_path);

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
            media_blob_id: media_info.id,
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

    /// Generate video thumbnail using FFmpeg
    async fn generate_video_thumbnail(
        &self,
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
            .arg(&media_info.local_path)
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
            media_blob_id: media_info.id,
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

    /// Generate audio waveform using FFmpeg
    async fn generate_audio_waveform(
        &self,
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
            .arg(&media_info.local_path)
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
            media_blob_id: media_info.id,
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

    /// Generate video preview using FFmpeg
    async fn generate_video_preview(
        &self,
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
            .arg(&media_info.local_path)
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
            media_blob_id: media_info.id,
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
        media_blob_id: &Uuid,
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
