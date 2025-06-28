//! Music job system types and enums
//!
//! This module provides Rust types that correspond to the music job system
//! database schema, including job types, statuses, and data structures.

use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use uuid::Uuid;

/// Music job types for processing audio files
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MusicJobType {
    /// Scan and analyze a single audio file
    ScanFile,
    /// Extract metadata from an audio file
    ExtractMetadata,
    /// Generate thumbnail from embedded album art
    GenerateThumbnail,
    /// Generate waveform visualization
    GenerateWaveform,
    /// Complete song processing pipeline
    ProcessSong,
}

impl MusicJobType {
    /// Get the string representation for database storage
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::ScanFile => "scan_file",
            Self::ExtractMetadata => "extract_metadata",
            Self::GenerateThumbnail => "generate_thumbnail",
            Self::GenerateWaveform => "generate_waveform",
            Self::ProcessSong => "process_song",
        }
    }

    /// Parse from database string representation
    pub fn from_str(s: &str) -> Result<Self, String> {
        match s {
            "scan_file" => Ok(Self::ScanFile),
            "extract_metadata" => Ok(Self::ExtractMetadata),
            "generate_thumbnail" => Ok(Self::GenerateThumbnail),
            "generate_waveform" => Ok(Self::GenerateWaveform),
            "process_song" => Ok(Self::ProcessSong),
            _ => Err(format!("Unknown music job type: {}", s)),
        }
    }

    /// Get all available job types
    pub fn all() -> Vec<Self> {
        vec![
            Self::ScanFile,
            Self::ExtractMetadata,
            Self::GenerateThumbnail,
            Self::GenerateWaveform,
            Self::ProcessSong,
        ]
    }

    /// Get the default priority for this job type
    pub fn default_priority(&self) -> JobPriority {
        match self {
            Self::ScanFile => JobPriority::High,    // User-initiated scans
            Self::ProcessSong => JobPriority::High, // Main processing pipeline
            Self::ExtractMetadata => JobPriority::Normal, // Secondary processing
            Self::GenerateThumbnail => JobPriority::Low, // Background generation
            Self::GenerateWaveform => JobPriority::Low, // Background generation
        }
    }

    /// Get the default maximum retries for this job type
    pub fn default_max_retries(&self) -> i32 {
        match self {
            Self::ScanFile => 2,          // File system operations
            Self::ExtractMetadata => 3,   // Metadata extraction can be flaky
            Self::GenerateThumbnail => 2, // Image processing
            Self::GenerateWaveform => 2,  // Audio processing
            Self::ProcessSong => 1,       // High-level pipeline
        }
    }
}

/// Job execution status
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JobStatus {
    Pending,
    InProgress,
    Completed,
    Failed,
    FailedPermanently,
    Cancelled,
}

impl JobStatus {
    /// Get the string representation for database storage
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::InProgress => "in_progress",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::FailedPermanently => "failed_permanently",
            Self::Cancelled => "cancelled",
        }
    }

    /// Parse from database string representation
    pub fn from_str(s: &str) -> Result<Self, String> {
        match s {
            "pending" => Ok(Self::Pending),
            "in_progress" => Ok(Self::InProgress),
            "completed" => Ok(Self::Completed),
            "failed" => Ok(Self::Failed),
            "failed_permanently" => Ok(Self::FailedPermanently),
            "cancelled" => Ok(Self::Cancelled),
            _ => Err(format!("Unknown job status: {}", s)),
        }
    }

    /// Check if this status represents a completed state
    pub fn is_completed(&self) -> bool {
        matches!(
            self,
            Self::Completed | Self::Failed | Self::FailedPermanently | Self::Cancelled
        )
    }

    /// Check if this status represents a failure state
    pub fn is_failed(&self) -> bool {
        matches!(self, Self::Failed | Self::FailedPermanently)
    }

    /// Check if this status allows retrying
    pub fn can_retry(&self) -> bool {
        matches!(self, Self::Failed)
    }
}

/// Job processing priority
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JobPriority {
    Low,
    Normal,
    High,
    Critical,
}

impl JobPriority {
    /// Get the string representation for database storage
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Low => "low",
            Self::Normal => "normal",
            Self::High => "high",
            Self::Critical => "critical",
        }
    }

    /// Parse from database string representation
    pub fn from_str(s: &str) -> Result<Self, String> {
        match s {
            "low" => Ok(Self::Low),
            "normal" => Ok(Self::Normal),
            "high" => Ok(Self::High),
            "critical" => Ok(Self::Critical),
            _ => Err(format!("Unknown job priority: {}", s)),
        }
    }
}

/// Scan session status
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScanSessionStatus {
    Running,
    Completed,
    Failed,
    Paused,
    Cancelled,
}

impl ScanSessionStatus {
    /// Get the string representation for database storage
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Running => "running",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Paused => "paused",
            Self::Cancelled => "cancelled",
        }
    }

    /// Parse from database string representation
    pub fn from_str(s: &str) -> Result<Self, String> {
        match s {
            "running" => Ok(Self::Running),
            "completed" => Ok(Self::Completed),
            "failed" => Ok(Self::Failed),
            "paused" => Ok(Self::Paused),
            "cancelled" => Ok(Self::Cancelled),
            _ => Err(format!("Unknown scan session status: {}", s)),
        }
    }

    /// Check if this status represents an active session
    pub fn is_active(&self) -> bool {
        matches!(self, Self::Running | Self::Paused)
    }

    /// Check if this status represents a completed session
    pub fn is_completed(&self) -> bool {
        matches!(self, Self::Completed | Self::Failed | Self::Cancelled)
    }
}

/// Music scan session data structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MusicScanSession {
    pub id: Uuid,
    pub base_path: String,
    pub session_name: Option<String>,
    pub status: ScanSessionStatus,
    pub total_files: Option<i32>,
    pub processed_files: i32,
    pub last_processed_path: Option<String>,
    pub songs_added: i32,
    pub songs_updated: i32,
    pub songs_skipped: i32,
    pub errors_encountered: i32,
    pub started_at: OffsetDateTime,
    pub completed_at: Option<OffsetDateTime>,
    pub estimated_completion: Option<OffsetDateTime>,
    pub error_message: Option<String>,
    pub client_id: Option<String>,
    pub initiated_by_user_id: Option<Uuid>,
    pub configuration: serde_json::Value,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
}

impl MusicScanSession {
    /// Calculate progress percentage if total files is known
    pub fn progress_percentage(&self) -> Option<f32> {
        self.total_files.map(|total| {
            if total > 0 {
                (self.processed_files as f32 / total as f32) * 100.0
            } else {
                0.0
            }
        })
    }

    /// Check if this session can be resumed
    pub fn can_resume(&self) -> bool {
        matches!(
            self.status,
            ScanSessionStatus::Paused | ScanSessionStatus::Failed
        )
    }

    /// Get elapsed time since session started
    pub fn elapsed_duration(&self) -> std::time::Duration {
        let now = OffsetDateTime::now_utc();
        (now - self.started_at).try_into().unwrap_or_default()
    }
}

/// Music job data structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MusicJob {
    pub id: Uuid,
    pub job_type: MusicJobType,
    pub scan_session_id: Option<Uuid>,
    pub file_path: String,
    pub media_blob_id: Option<Uuid>,
    pub song_id: Option<Uuid>,
    pub status: JobStatus,
    pub priority: JobPriority,
    pub worker_id: Option<String>,
    pub parameters: serde_json::Value,
    pub result: serde_json::Value,
    pub scheduled_at: OffsetDateTime,
    pub started_at: Option<OffsetDateTime>,
    pub completed_at: Option<OffsetDateTime>,
    pub retry_count: i32,
    pub max_retries: i32,
    pub error_message: Option<String>,
    pub error_details: Option<serde_json::Value>,
    pub progress_percentage: Option<f32>,
    pub progress_message: Option<String>,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
}

impl MusicJob {
    /// Check if this job can be retried
    pub fn can_retry(&self) -> bool {
        self.status.can_retry() && self.retry_count < self.max_retries
    }

    /// Get processing duration if job has completed
    pub fn processing_duration(&self) -> Option<std::time::Duration> {
        if let (Some(started), Some(completed)) = (&self.started_at, &self.completed_at) {
            (*completed - *started).try_into().ok()
        } else {
            None
        }
    }

    /// Get queue wait time if job has started
    pub fn queue_wait_time(&self) -> Option<std::time::Duration> {
        if let Some(started) = &self.started_at {
            (*started - self.created_at).try_into().ok()
        } else {
            None
        }
    }

    /// Check if this job is overdue for processing
    pub fn is_overdue(&self, timeout_minutes: i32) -> bool {
        if let Some(started) = &self.started_at {
            let elapsed = OffsetDateTime::now_utc() - *started;
            elapsed.whole_minutes() > timeout_minutes as i64
        } else {
            false
        }
    }
}

/// Parameters for different job types
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "job_type", rename_all = "snake_case")]
pub enum JobParameters {
    ScanFile {
        check_duplicates: bool,
        extract_metadata: bool,
    },
    ExtractMetadata {
        overwrite_existing: bool,
        extract_thumbnails: bool,
    },
    GenerateThumbnail {
        target_width: Option<i32>,
        target_height: Option<i32>,
        quality: Option<i32>,
    },
    GenerateWaveform {
        width: i32,
        height: i32,
        color: Option<String>,
        background_color: Option<String>,
    },
    ProcessSong {
        generate_thumbnail: bool,
        generate_waveform: bool,
        extract_metadata: bool,
    },
}

/// Results for different job types
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "job_type", rename_all = "snake_case")]
pub enum JobResult {
    ScanFile {
        is_duplicate: bool,
        file_size: i64,
        content_hash: String,
        audio_format: String,
    },
    ExtractMetadata {
        metadata_extracted: bool,
        thumbnail_extracted: bool,
        metadata: serde_json::Value,
    },
    GenerateThumbnail {
        thumbnail_blob_id: Uuid,
        image_width: i32,
        image_height: i32,
        file_size: i32,
    },
    GenerateWaveform {
        waveform_blob_id: Uuid,
        image_width: i32,
        image_height: i32,
        file_size: i32,
    },
    ProcessSong {
        song_id: Uuid,
        thumbnail_generated: bool,
        waveform_generated: bool,
        metadata_extracted: bool,
    },
}

/// Scan session statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanSessionStats {
    pub session_id: Uuid,
    pub base_path: String,
    pub status: ScanSessionStatus,
    pub progress_percentage: Option<f32>,
    pub processed_files: i32,
    pub total_files: Option<i32>,
    pub songs_added: i32,
    pub songs_updated: i32,
    pub songs_skipped: i32,
    pub errors_encountered: i32,
    pub elapsed_time_minutes: i32,
    pub estimated_remaining_minutes: Option<i32>,
    pub jobs_pending: i64,
    pub jobs_in_progress: i64,
    pub jobs_completed: i64,
    pub jobs_failed: i64,
}

/// Music job queue health metrics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MusicJobHealth {
    pub total_jobs: i64,
    pub pending_jobs: i64,
    pub in_progress_jobs: i64,
    pub completed_jobs: i64,
    pub failed_jobs: i64,
    pub avg_processing_time_minutes: f32,
    pub active_sessions: i64,
    pub stale_jobs: i64,
    pub oldest_pending_age_minutes: i32,
}

impl MusicJobHealth {
    /// Calculate success rate percentage
    pub fn success_rate(&self) -> f32 {
        if self.total_jobs > 0 {
            (self.completed_jobs as f32 / self.total_jobs as f32) * 100.0
        } else {
            100.0
        }
    }

    /// Check if the job queue is healthy
    pub fn is_healthy(&self) -> bool {
        self.stale_jobs == 0 && self.oldest_pending_age_minutes < 60 && self.success_rate() > 90.0
    }

    /// Get health status description
    pub fn health_status(&self) -> &'static str {
        if self.is_healthy() {
            "healthy"
        } else if self.stale_jobs > 0 {
            "degraded"
        } else if self.pending_jobs > 100 {
            "overloaded"
        } else {
            "warning"
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_music_job_type_conversion() {
        for job_type in MusicJobType::all() {
            let as_str = job_type.as_str();
            let from_str = MusicJobType::from_str(as_str).unwrap();
            assert_eq!(job_type, from_str);
        }
    }

    #[test]
    fn test_job_status_properties() {
        assert!(JobStatus::Completed.is_completed());
        assert!(JobStatus::Failed.is_failed());
        assert!(JobStatus::Failed.can_retry());
        assert!(!JobStatus::FailedPermanently.can_retry());
        assert!(!JobStatus::Pending.is_completed());
    }

    #[test]
    fn test_scan_session_progress() {
        let session = MusicScanSession {
            id: Uuid::new_v4(),
            base_path: "/test".to_string(),
            session_name: None,
            status: ScanSessionStatus::Running,
            total_files: Some(100),
            processed_files: 25,
            last_processed_path: None,
            songs_added: 20,
            songs_updated: 3,
            songs_skipped: 2,
            errors_encountered: 0,
            started_at: OffsetDateTime::now_utc(),
            completed_at: None,
            estimated_completion: None,
            error_message: None,
            client_id: None,
            initiated_by_user_id: None,
            configuration: serde_json::json!({}),
            created_at: OffsetDateTime::now_utc(),
            updated_at: OffsetDateTime::now_utc(),
        };

        assert_eq!(session.progress_percentage(), Some(25.0));
        assert!(session.status.is_active());
        assert!(!session.status.is_completed());
    }

    #[test]
    fn test_job_priorities() {
        assert!(JobPriority::Critical > JobPriority::High);
        assert!(JobPriority::High > JobPriority::Normal);
        assert!(JobPriority::Normal > JobPriority::Low);
    }

    #[test]
    fn test_music_job_health() {
        let health = MusicJobHealth {
            total_jobs: 100,
            pending_jobs: 5,
            in_progress_jobs: 2,
            completed_jobs: 93,
            failed_jobs: 0,
            avg_processing_time_minutes: 2.5,
            active_sessions: 1,
            stale_jobs: 0,
            oldest_pending_age_minutes: 30,
        };

        assert_eq!(health.success_rate(), 93.0);
        assert!(health.is_healthy());
        assert_eq!(health.health_status(), "healthy");
    }
}
