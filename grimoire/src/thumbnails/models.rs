use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use uuid::Uuid;

/// Thumbnail generation job structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThumbnailJob {
    pub id: Uuid,
    pub media_blob_id: Uuid,
    pub job_type: ThumbnailJobType,
    pub target_dimensions: Option<ThumbnailDimensions>,
    pub status: ThumbnailJobStatus,
    pub priority: ThumbnailJobPriority,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
    pub scheduled_at: OffsetDateTime,
    pub retry_count: i32,
    pub max_retries: i32,
    pub error_message: Option<String>,
    pub worker_id: Option<String>,
    pub metadata: Option<serde_json::Value>,
}

/// Types of thumbnail generation jobs
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ThumbnailJobType {
    /// Generate image thumbnail using imagemagick
    ImageThumbnail,
    /// Generate video frame thumbnail using ffmpeg
    VideoThumbnail,
    /// Generate audio waveform using ffmpeg
    AudioWaveform,
    /// Generate preview/poster for video
    VideoPreview,
}

impl std::fmt::Display for ThumbnailJobType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ThumbnailJobType::ImageThumbnail => write!(f, "image_thumbnail"),
            ThumbnailJobType::VideoThumbnail => write!(f, "video_thumbnail"),
            ThumbnailJobType::AudioWaveform => write!(f, "audio_waveform"),
            ThumbnailJobType::VideoPreview => write!(f, "video_preview"),
        }
    }
}

impl ThumbnailJobType {
    /// Parse from string representation
    pub fn from_str(s: &str) -> Result<Self, ThumbnailError> {
        match s {
            "image_thumbnail" => Ok(ThumbnailJobType::ImageThumbnail),
            "video_thumbnail" => Ok(ThumbnailJobType::VideoThumbnail),
            "audio_waveform" => Ok(ThumbnailJobType::AudioWaveform),
            "video_preview" => Ok(ThumbnailJobType::VideoPreview),
            _ => Err(ThumbnailError::InvalidJobType(s.to_string())),
        }
    }
}

/// Job status tracking
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ThumbnailJobStatus {
    /// Job is queued and ready to process
    Pending,
    /// Job is currently being processed
    InProgress,
    /// Job completed successfully
    Completed,
    /// Job failed and will be retried
    Failed,
    /// Job failed permanently (max retries exceeded)
    FailedPermanently,
    /// Job was cancelled
    Cancelled,
}

impl std::fmt::Display for ThumbnailJobStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ThumbnailJobStatus::Pending => write!(f, "pending"),
            ThumbnailJobStatus::InProgress => write!(f, "in_progress"),
            ThumbnailJobStatus::Completed => write!(f, "completed"),
            ThumbnailJobStatus::Failed => write!(f, "failed"),
            ThumbnailJobStatus::FailedPermanently => write!(f, "failed_permanently"),
            ThumbnailJobStatus::Cancelled => write!(f, "cancelled"),
        }
    }
}

/// Job priority levels
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
pub enum ThumbnailJobPriority {
    Low = 1,
    Normal = 2,
    High = 3,
    Critical = 4,
}

impl Default for ThumbnailJobPriority {
    fn default() -> Self {
        ThumbnailJobPriority::Normal
    }
}

/// Target dimensions for thumbnail generation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThumbnailDimensions {
    pub width: u32,
    pub height: u32,
    pub maintain_aspect_ratio: bool,
    pub crop_strategy: CropStrategy,
}

impl Default for ThumbnailDimensions {
    fn default() -> Self {
        Self {
            width: 200,
            height: 200,
            maintain_aspect_ratio: true,
            crop_strategy: CropStrategy::Center,
        }
    }
}

/// Strategies for cropping thumbnails when aspect ratios don't match
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum CropStrategy {
    /// Crop from center
    Center,
    /// Crop from top
    Top,
    /// Crop from bottom
    Bottom,
    /// Crop from left
    Left,
    /// Crop from right
    Right,
    /// Scale to fit (may add padding)
    Fit,
    /// Scale to fill (may crop)
    Fill,
}

/// Configuration for thumbnail generation
#[derive(Debug, Clone)]
pub struct ThumbnailConfig {
    pub enabled: bool,
    pub imagemagick_path: Option<String>,
    pub ffmpeg_path: Option<String>,
    pub max_concurrent_jobs: u32,
    pub default_dimensions: ThumbnailDimensions,
    pub storage_path: String,
    pub quality: u8,
    pub formats: ThumbnailFormats,
    pub timeouts: ThumbnailTimeouts,
}

impl Default for ThumbnailConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            imagemagick_path: None, // Will use system PATH
            ffmpeg_path: None,      // Will use system PATH
            max_concurrent_jobs: 4,
            default_dimensions: ThumbnailDimensions::default(),
            storage_path: "/tmp/thumbnails".to_string(),
            quality: 85,
            formats: ThumbnailFormats::default(),
            timeouts: ThumbnailTimeouts::default(),
        }
    }
}

/// Supported output formats for thumbnails
#[derive(Debug, Clone)]
pub struct ThumbnailFormats {
    pub image_format: String,
    pub waveform_format: String,
    pub video_format: String,
}

impl Default for ThumbnailFormats {
    fn default() -> Self {
        Self {
            image_format: "webp".to_string(),
            waveform_format: "png".to_string(),
            video_format: "webp".to_string(),
        }
    }
}

/// Timeout configuration for different operations
#[derive(Debug, Clone)]
pub struct ThumbnailTimeouts {
    pub image_processing_seconds: u32,
    pub video_processing_seconds: u32,
    pub audio_processing_seconds: u32,
}

impl Default for ThumbnailTimeouts {
    fn default() -> Self {
        Self {
            image_processing_seconds: 30,
            video_processing_seconds: 60,
            audio_processing_seconds: 45,
        }
    }
}

/// Media blob information for thumbnail generation
#[derive(Debug, Clone)]
pub struct MediaBlobInfo {
    pub id: Uuid,
    pub local_path: String,
    pub mime_type: String,
    pub size: i64,
    pub metadata: Option<serde_json::Value>,
}

/// Generated thumbnail information
#[derive(Debug, Clone)]
pub struct ThumbnailResult {
    pub media_blob_id: Uuid,
    pub local_path: String,
    pub mime_type: String,
    pub size: i64,
    pub dimensions: ThumbnailDimensions,
    pub blob_type: String,
    pub metadata: serde_json::Value,
}

/// Job execution metrics for monitoring
#[derive(Debug, Clone, Serialize)]
pub struct ThumbnailJobMetrics {
    pub total_jobs: i64,
    pub pending_jobs: i64,
    pub in_progress_jobs: i64,
    pub completed_jobs: i64,
    pub failed_jobs: i64,
    pub average_processing_time_ms: f64,
    pub success_rate: f64,
    pub jobs_by_type: Vec<JobTypeMetric>,
}

/// Metrics for specific job types
#[derive(Debug, Clone, Serialize)]
pub struct JobTypeMetric {
    pub job_type: ThumbnailJobType,
    pub count: i64,
    pub average_processing_time_ms: f64,
    pub success_rate: f64,
}

/// Comprehensive error types for thumbnail operations
#[derive(Debug, thiserror::Error)]
pub enum ThumbnailError {
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),

    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Thumbnail generation is disabled")]
    Disabled,

    #[error("Invalid job type: {0}")]
    InvalidJobType(String),

    #[error("Invalid job status: {0}")]
    InvalidJobStatus(String),

    #[error("Media blob not found: {0}")]
    MediaBlobNotFound(Uuid),

    #[error("Invalid media type for thumbnail generation: {0}")]
    UnsupportedMediaType(String),

    #[error("External tool not found: {0}")]
    ExternalToolNotFound(String),

    #[error("External tool execution failed: {0}")]
    ExternalToolFailed(String),

    #[error("Invalid dimensions: width={0}, height={1}")]
    InvalidDimensions(u32, u32),

    #[error("File path does not exist: {0}")]
    FileNotFound(String),

    #[error("Invalid configuration: {0}")]
    InvalidConfiguration(String),

    #[error("Job timeout exceeded")]
    Timeout,

    #[error("Maximum retries exceeded for job: {0}")]
    MaxRetriesExceeded(Uuid),

    #[error("Concurrent job limit exceeded")]
    ConcurrencyLimitExceeded,

    #[error("Invalid UUID: {0}")]
    InvalidUuid(String),
}

impl ThumbnailError {
    /// Check if the error is retryable
    pub fn is_retryable(&self) -> bool {
        match self {
            ThumbnailError::Database(_) => true,
            ThumbnailError::Io(_) => true,
            ThumbnailError::ExternalToolFailed(_) => true,
            ThumbnailError::Timeout => true,
            ThumbnailError::ConcurrencyLimitExceeded => true,
            _ => false,
        }
    }

    /// Check if the error is permanent
    pub fn is_permanent(&self) -> bool {
        !self.is_retryable()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_thumbnail_job_creation() {
        let job = ThumbnailJob {
            id: Uuid::new_v4(),
            media_blob_id: Uuid::new_v4(),
            job_type: ThumbnailJobType::ImageThumbnail,
            target_dimensions: Some(ThumbnailDimensions::default()),
            status: ThumbnailJobStatus::Pending,
            priority: ThumbnailJobPriority::Normal,
            created_at: OffsetDateTime::now_utc(),
            updated_at: OffsetDateTime::now_utc(),
            scheduled_at: OffsetDateTime::now_utc(),
            retry_count: 0,
            max_retries: 3,
            error_message: None,
            worker_id: None,
            metadata: None,
        };

        assert_eq!(job.job_type, ThumbnailJobType::ImageThumbnail);
        assert_eq!(job.status, ThumbnailJobStatus::Pending);
        assert_eq!(job.priority, ThumbnailJobPriority::Normal);
        assert_eq!(job.retry_count, 0);
        assert_eq!(job.max_retries, 3);
    }

    #[test]
    fn test_thumbnail_job_type_display() {
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
    }

    #[test]
    fn test_thumbnail_job_type_from_str() {
        assert_eq!(
            ThumbnailJobType::from_str("image_thumbnail").unwrap(),
            ThumbnailJobType::ImageThumbnail
        );
        assert_eq!(
            ThumbnailJobType::from_str("video_thumbnail").unwrap(),
            ThumbnailJobType::VideoThumbnail
        );
        assert_eq!(
            ThumbnailJobType::from_str("audio_waveform").unwrap(),
            ThumbnailJobType::AudioWaveform
        );
        assert_eq!(
            ThumbnailJobType::from_str("video_preview").unwrap(),
            ThumbnailJobType::VideoPreview
        );

        // Test invalid input
        assert!(ThumbnailJobType::from_str("invalid_type").is_err());
        assert!(matches!(
            ThumbnailJobType::from_str("invalid_type").unwrap_err(),
            ThumbnailError::InvalidJobType(_)
        ));
    }

    #[test]
    fn test_thumbnail_job_status_display() {
        assert_eq!(ThumbnailJobStatus::Pending.to_string(), "pending");
        assert_eq!(ThumbnailJobStatus::InProgress.to_string(), "in_progress");
        assert_eq!(ThumbnailJobStatus::Completed.to_string(), "completed");
        assert_eq!(ThumbnailJobStatus::Failed.to_string(), "failed");
        assert_eq!(
            ThumbnailJobStatus::FailedPermanently.to_string(),
            "failed_permanently"
        );
        assert_eq!(ThumbnailJobStatus::Cancelled.to_string(), "cancelled");
    }

    #[test]
    fn test_thumbnail_job_priority_ordering() {
        assert!(ThumbnailJobPriority::Low < ThumbnailJobPriority::Normal);
        assert!(ThumbnailJobPriority::Normal < ThumbnailJobPriority::High);
        assert!(ThumbnailJobPriority::High < ThumbnailJobPriority::Critical);

        let mut priorities = vec![
            ThumbnailJobPriority::Critical,
            ThumbnailJobPriority::Low,
            ThumbnailJobPriority::High,
            ThumbnailJobPriority::Normal,
        ];
        priorities.sort();

        assert_eq!(
            priorities,
            vec![
                ThumbnailJobPriority::Low,
                ThumbnailJobPriority::Normal,
                ThumbnailJobPriority::High,
                ThumbnailJobPriority::Critical,
            ]
        );
    }

    #[test]
    fn test_thumbnail_job_priority_default() {
        assert_eq!(
            ThumbnailJobPriority::default(),
            ThumbnailJobPriority::Normal
        );
    }

    #[test]
    fn test_thumbnail_dimensions_default() {
        let dimensions = ThumbnailDimensions::default();
        assert_eq!(dimensions.width, 200);
        assert_eq!(dimensions.height, 200);
        assert_eq!(dimensions.maintain_aspect_ratio, true);
        assert_eq!(dimensions.crop_strategy, CropStrategy::Center);
    }

    #[test]
    fn test_crop_strategy_variants() {
        let strategies = vec![
            CropStrategy::Center,
            CropStrategy::Top,
            CropStrategy::Bottom,
            CropStrategy::Left,
            CropStrategy::Right,
            CropStrategy::Fit,
            CropStrategy::Fill,
        ];

        // Just ensure all variants exist and can be created
        assert_eq!(strategies.len(), 7);
    }

    #[test]
    fn test_thumbnail_config_default() {
        let config = ThumbnailConfig::default();
        assert_eq!(config.enabled, true);
        assert_eq!(config.imagemagick_path, None);
        assert_eq!(config.ffmpeg_path, None);
        assert_eq!(config.max_concurrent_jobs, 4);
        assert_eq!(config.storage_path, "/tmp/thumbnails");
        assert_eq!(config.quality, 85);
        assert_eq!(config.default_dimensions.width, 200);
        assert_eq!(config.default_dimensions.height, 200);
        assert_eq!(config.formats.image_format, "webp");
        assert_eq!(config.formats.waveform_format, "png");
        assert_eq!(config.formats.video_format, "webp");
        assert_eq!(config.timeouts.image_processing_seconds, 30);
        assert_eq!(config.timeouts.video_processing_seconds, 60);
        assert_eq!(config.timeouts.audio_processing_seconds, 45);
    }

    #[test]
    fn test_thumbnail_formats_default() {
        let formats = ThumbnailFormats::default();
        assert_eq!(formats.image_format, "webp");
        assert_eq!(formats.waveform_format, "png");
        assert_eq!(formats.video_format, "webp");
    }

    #[test]
    fn test_thumbnail_timeouts_default() {
        let timeouts = ThumbnailTimeouts::default();
        assert_eq!(timeouts.image_processing_seconds, 30);
        assert_eq!(timeouts.video_processing_seconds, 60);
        assert_eq!(timeouts.audio_processing_seconds, 45);
    }

    #[test]
    fn test_media_blob_info_creation() {
        let blob_id = Uuid::new_v4();
        let media_info = MediaBlobInfo {
            id: blob_id,
            local_path: "/path/to/media.jpg".to_string(),
            mime_type: "image/jpeg".to_string(),
            size: 1024,
            metadata: Some(serde_json::json!({"width": 800, "height": 600})),
        };

        assert_eq!(media_info.id, blob_id);
        assert_eq!(media_info.local_path, "/path/to/media.jpg");
        assert_eq!(media_info.mime_type, "image/jpeg");
        assert_eq!(media_info.size, 1024);
        assert!(media_info.metadata.is_some());
    }

    #[test]
    fn test_thumbnail_result_creation() {
        let blob_id = Uuid::new_v4();
        let dimensions = ThumbnailDimensions {
            width: 150,
            height: 150,
            maintain_aspect_ratio: true,
            crop_strategy: CropStrategy::Center,
        };

        let result = ThumbnailResult {
            media_blob_id: blob_id,
            local_path: "/path/to/thumbnail.webp".to_string(),
            mime_type: "image/webp".to_string(),
            size: 512,
            dimensions: dimensions.clone(),
            blob_type: "thumbnail".to_string(),
            metadata: serde_json::json!({"quality": 85, "tool": "imagemagick"}),
        };

        assert_eq!(result.media_blob_id, blob_id);
        assert_eq!(result.local_path, "/path/to/thumbnail.webp");
        assert_eq!(result.mime_type, "image/webp");
        assert_eq!(result.size, 512);
        assert_eq!(result.dimensions.width, 150);
        assert_eq!(result.dimensions.height, 150);
        assert_eq!(result.blob_type, "thumbnail");
    }

    #[test]
    fn test_thumbnail_job_metrics_creation() {
        let metrics = ThumbnailJobMetrics {
            total_jobs: 100,
            pending_jobs: 10,
            in_progress_jobs: 5,
            completed_jobs: 80,
            failed_jobs: 5,
            average_processing_time_ms: 1500.0,
            success_rate: 0.94,
            jobs_by_type: vec![],
        };

        assert_eq!(metrics.total_jobs, 100);
        assert_eq!(metrics.pending_jobs, 10);
        assert_eq!(metrics.in_progress_jobs, 5);
        assert_eq!(metrics.completed_jobs, 80);
        assert_eq!(metrics.failed_jobs, 5);
        assert_eq!(metrics.average_processing_time_ms, 1500.0);
        assert_eq!(metrics.success_rate, 0.94);
    }

    #[test]
    fn test_job_type_metric_creation() {
        let metric = JobTypeMetric {
            job_type: ThumbnailJobType::ImageThumbnail,
            count: 50,
            average_processing_time_ms: 800.0,
            success_rate: 0.98,
        };

        assert_eq!(metric.job_type, ThumbnailJobType::ImageThumbnail);
        assert_eq!(metric.count, 50);
        assert_eq!(metric.average_processing_time_ms, 800.0);
        assert_eq!(metric.success_rate, 0.98);
    }

    #[test]
    fn test_thumbnail_error_retryability() {
        // Retryable errors
        assert!(ThumbnailError::Database(sqlx::Error::PoolClosed).is_retryable());
        assert!(
            ThumbnailError::Io(std::io::Error::new(std::io::ErrorKind::TimedOut, "timeout"))
                .is_retryable()
        );
        assert!(ThumbnailError::ExternalToolFailed("ffmpeg crashed".to_string()).is_retryable());
        assert!(ThumbnailError::Timeout.is_retryable());
        assert!(ThumbnailError::ConcurrencyLimitExceeded.is_retryable());

        // Non-retryable errors
        assert!(!ThumbnailError::Disabled.is_retryable());
        assert!(!ThumbnailError::InvalidJobType("invalid".to_string()).is_retryable());
        assert!(!ThumbnailError::MediaBlobNotFound(Uuid::new_v4()).is_retryable());
        assert!(
            !ThumbnailError::UnsupportedMediaType("application/pdf".to_string()).is_retryable()
        );
        assert!(!ThumbnailError::ExternalToolNotFound("ffmpeg".to_string()).is_retryable());
        assert!(!ThumbnailError::InvalidDimensions(0, 0).is_retryable());
        assert!(!ThumbnailError::FileNotFound("/nonexistent".to_string()).is_retryable());
        assert!(!ThumbnailError::InvalidConfiguration("bad config".to_string()).is_retryable());
        assert!(!ThumbnailError::MaxRetriesExceeded(Uuid::new_v4()).is_retryable());
        assert!(!ThumbnailError::InvalidUuid("not-a-uuid".to_string()).is_retryable());
    }

    #[test]
    fn test_thumbnail_error_permanence() {
        // Test that permanent errors are the inverse of retryable
        let retryable_error = ThumbnailError::Timeout;
        let permanent_error = ThumbnailError::Disabled;

        assert!(!retryable_error.is_permanent());
        assert!(permanent_error.is_permanent());
    }

    #[test]
    fn test_thumbnail_error_display() {
        let blob_id = Uuid::new_v4();

        assert_eq!(
            ThumbnailError::Disabled.to_string(),
            "Thumbnail generation is disabled"
        );
        assert_eq!(
            ThumbnailError::InvalidJobType("test".to_string()).to_string(),
            "Invalid job type: test"
        );
        assert_eq!(
            ThumbnailError::MediaBlobNotFound(blob_id).to_string(),
            format!("Media blob not found: {}", blob_id)
        );
        assert_eq!(
            ThumbnailError::UnsupportedMediaType("application/pdf".to_string()).to_string(),
            "Invalid media type for thumbnail generation: application/pdf"
        );
        assert_eq!(
            ThumbnailError::ExternalToolNotFound("ffmpeg".to_string()).to_string(),
            "External tool not found: ffmpeg"
        );
        assert_eq!(
            ThumbnailError::InvalidDimensions(0, 0).to_string(),
            "Invalid dimensions: width=0, height=0"
        );
        assert_eq!(ThumbnailError::Timeout.to_string(), "Job timeout exceeded");
    }

    #[test]
    fn test_thumbnail_job_serialization() {
        let job = ThumbnailJob {
            id: Uuid::new_v4(),
            media_blob_id: Uuid::new_v4(),
            job_type: ThumbnailJobType::ImageThumbnail,
            target_dimensions: Some(ThumbnailDimensions::default()),
            status: ThumbnailJobStatus::Pending,
            priority: ThumbnailJobPriority::Normal,
            created_at: OffsetDateTime::now_utc(),
            updated_at: OffsetDateTime::now_utc(),
            scheduled_at: OffsetDateTime::now_utc(),
            retry_count: 0,
            max_retries: 3,
            error_message: None,
            worker_id: None,
            metadata: Some(serde_json::json!({"test": "value"})),
        };

        // Test serialization
        let serialized = serde_json::to_string(&job).unwrap();
        assert!(serialized.contains("ImageThumbnail"));
        assert!(serialized.contains("Pending"));

        // Test deserialization
        let deserialized: ThumbnailJob = serde_json::from_str(&serialized).unwrap();
        assert_eq!(deserialized.id, job.id);
        assert_eq!(deserialized.job_type, job.job_type);
        assert_eq!(deserialized.status, job.status);
    }

    #[test]
    fn test_thumbnail_config_with_custom_paths() {
        let config = ThumbnailConfig {
            enabled: true,
            imagemagick_path: Some("/usr/local/bin/convert".to_string()),
            ffmpeg_path: Some("/usr/local/bin/ffmpeg".to_string()),
            max_concurrent_jobs: 8,
            storage_path: "/var/thumbnails".to_string(),
            default_dimensions: ThumbnailDimensions {
                width: 300,
                height: 300,
                maintain_aspect_ratio: false,
                crop_strategy: CropStrategy::Fill,
            },
            quality: 95,
            formats: ThumbnailFormats {
                image_format: "jpeg".to_string(),
                waveform_format: "svg".to_string(),
                video_format: "png".to_string(),
            },
            timeouts: ThumbnailTimeouts {
                image_processing_seconds: 60,
                video_processing_seconds: 120,
                audio_processing_seconds: 90,
            },
        };

        assert_eq!(
            config.imagemagick_path,
            Some("/usr/local/bin/convert".to_string())
        );
        assert_eq!(
            config.ffmpeg_path,
            Some("/usr/local/bin/ffmpeg".to_string())
        );
        assert_eq!(config.max_concurrent_jobs, 8);
        assert_eq!(config.storage_path, "/var/thumbnails");
        assert_eq!(config.default_dimensions.width, 300);
        assert_eq!(config.default_dimensions.height, 300);
        assert_eq!(config.default_dimensions.maintain_aspect_ratio, false);
        assert_eq!(config.quality, 95);
        assert_eq!(config.formats.image_format, "jpeg");
        assert_eq!(config.timeouts.image_processing_seconds, 60);
    }
}
