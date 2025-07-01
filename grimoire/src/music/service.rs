//! Music service layer for managing music library operations
//!
//! This module provides high-level service functions for music scanning,
//! session management, and file processing. It acts as the interface between
//! the CLI and the lower-level music processing modules.

use crate::music::jobs::ScanSessionStatus;
use crate::music::{Scanner, ScannerConfig};
use crate::{AppConfig, DatabaseConnection};
use serde::{Deserialize, Serialize};
use std::path::Path;
use thiserror::Error;
use time::OffsetDateTime;
use uuid::Uuid;

/// Errors that can occur in the music service
#[derive(Debug, Error)]
pub enum MusicServiceError {
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("Scanner error: {0}")]
    Scanner(String),
    #[error("Session not found: {0}")]
    SessionNotFound(Uuid),
    #[error("Invalid session state: {0}")]
    InvalidSessionState(String),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Configuration error: {0}")]
    Configuration(String),
}

/// Configuration for starting a music scan
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanConfig {
    /// Base path to scan
    pub base_path: String,
    /// Optional session name
    pub session_name: Option<String>,
    /// Scanner configuration
    pub scanner_config: ScannerConfig,
    /// Maximum file size to process (in bytes)
    pub max_file_size: Option<u64>,
    /// User ID initiating the scan
    pub user_id: Option<Uuid>,
}

/// Result of starting a scan
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanResult {
    /// Created session ID
    pub session_id: Uuid,
    /// Total files discovered
    pub total_files: usize,
    /// Session name
    pub session_name: String,
}

/// Scan session statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionStats {
    pub session_id: Uuid,
    pub base_path: String,
    pub session_name: Option<String>,
    pub status: ScanSessionStatus,
    pub progress_percentage: Option<f32>,
    pub processed_files: i32,
    pub total_files: Option<i32>,
    pub songs_added: i32,
    pub songs_updated: i32,
    pub songs_skipped: i32,
    pub errors_encountered: i32,
    pub elapsed_time_minutes: Option<i32>,
    pub estimated_remaining_minutes: Option<i32>,
    pub jobs_pending: i64,
    pub jobs_in_progress: i64,
    pub jobs_completed: i64,
    pub jobs_failed: i64,
    pub started_at: OffsetDateTime,
    pub completed_at: Option<OffsetDateTime>,
}

/// Summary of cleanup operation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CleanupResult {
    pub sessions_deleted: i32,
    pub jobs_deleted: i32,
}

/// Service-specific session data (simplified from database model)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceSession {
    pub id: Uuid,
    pub base_path: String,
    pub session_name: Option<String>,
    pub status: String,
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

impl ServiceSession {
    pub fn status(&self) -> ScanSessionStatus {
        ScanSessionStatus::from_str(&self.status).unwrap_or(ScanSessionStatus::Failed)
    }

    pub fn can_resume(&self) -> bool {
        matches!(
            self.status(),
            ScanSessionStatus::Paused | ScanSessionStatus::Failed
        )
    }
}

/// Music service for high-level operations
pub struct MusicService<'a> {
    db: &'a DatabaseConnection,
    config: &'a AppConfig,
}

impl<'a> MusicService<'a> {
    /// Create a new music service
    pub fn new(db: &'a DatabaseConnection, config: &'a AppConfig) -> Self {
        Self { db, config }
    }

    /// Get database connection
    pub fn db(&self) -> &'a DatabaseConnection {
        self.db
    }

    /// Get configuration
    pub fn config(&self) -> &'a AppConfig {
        self.config
    }

    /// Start a new music scan
    pub async fn start_scan(
        &self,
        scan_config: ScanConfig,
    ) -> Result<ScanResult, MusicServiceError> {
        let path = Path::new(&scan_config.base_path);

        // Validate path
        if !path.exists() {
            return Err(MusicServiceError::Configuration(format!(
                "Directory does not exist: {}",
                scan_config.base_path
            )));
        }

        if !path.is_dir() {
            return Err(MusicServiceError::Configuration(format!(
                "Path is not a directory: {}",
                scan_config.base_path
            )));
        }

        // Create scanner and count files
        let scanner = Scanner::with_config(self.config, scan_config.scanner_config.clone());
        let total_files = scanner
            .count_audio_files(path)
            .await
            .map_err(|e| MusicServiceError::Scanner(e.to_string()))?;

        // Generate session details
        let session_id = Uuid::new_v4();
        let session_name = scan_config.session_name.clone().unwrap_or_else(|| {
            format!(
                "Scan of {}",
                path.file_name().unwrap_or_default().to_string_lossy()
            )
        });

        // Create session in database
        let config_json = serde_json::to_value(&scan_config).unwrap_or_default();
        sqlx::query!(
            r#"
            INSERT INTO music_scan_sessions (
                id, base_path, session_name, status, total_files,
                initiated_by_user_id, configuration
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            "#,
            session_id,
            scan_config.base_path,
            session_name,
            ScanSessionStatus::Running.as_str(),
            total_files as i32,
            scan_config.user_id,
            config_json
        )
        .execute(self.db.pool())
        .await?;

        Ok(ScanResult {
            session_id,
            total_files,
            session_name,
        })
    }

    /// Get scan session by ID
    pub async fn get_session(&self, session_id: Uuid) -> Result<ServiceSession, MusicServiceError> {
        let session = sqlx::query_as!(
            ServiceSession,
            r#"
            SELECT
                id, base_path, session_name,
                status as "status: String",
                total_files, processed_files, last_processed_path,
                songs_added, songs_updated, songs_skipped, errors_encountered,
                started_at, completed_at, estimated_completion, error_message,
                client_id, initiated_by_user_id, configuration,
                created_at, updated_at
            FROM music_scan_sessions
            WHERE id = $1
            "#,
            session_id
        )
        .fetch_optional(self.db.pool())
        .await?;

        session.ok_or(MusicServiceError::SessionNotFound(session_id))
    }

    /// Get detailed session statistics
    pub async fn get_session_stats(
        &self,
        session_id: Uuid,
    ) -> Result<SessionStats, MusicServiceError> {
        let stats = sqlx::query!("SELECT * FROM get_scan_session_stats($1)", session_id)
            .fetch_optional(self.db.pool())
            .await?;

        let stats = stats.ok_or(MusicServiceError::SessionNotFound(session_id))?;

        // Also get the basic session info for additional fields
        let session = self.get_session(session_id).await?;

        Ok(SessionStats {
            session_id: stats.session_id.unwrap_or(session_id),
            base_path: stats.base_path.unwrap_or_default(),
            session_name: session.session_name.clone(),
            status: session.status(),
            progress_percentage: stats
                .progress_percentage
                .map(|d| d.to_string().parse::<f32>().unwrap_or(0.0)),
            processed_files: stats.processed_files.unwrap_or(0),
            total_files: stats.total_files,
            songs_added: stats.songs_added.unwrap_or(0),
            songs_updated: stats.songs_updated.unwrap_or(0),
            songs_skipped: stats.songs_skipped.unwrap_or(0),
            errors_encountered: stats.errors_encountered.unwrap_or(0),
            elapsed_time_minutes: stats.elapsed_time_minutes,
            estimated_remaining_minutes: stats.estimated_remaining_minutes,
            jobs_pending: stats.jobs_pending.unwrap_or(0),
            jobs_in_progress: stats.jobs_in_progress.unwrap_or(0),
            jobs_completed: stats.jobs_completed.unwrap_or(0),
            jobs_failed: stats.jobs_failed.unwrap_or(0),
            started_at: session.started_at,
            completed_at: session.completed_at,
        })
    }

    /// List all scan sessions
    pub async fn list_sessions(
        &self,
        active_only: bool,
    ) -> Result<Vec<ServiceSession>, MusicServiceError> {
        let sessions = if active_only {
            sqlx::query_as!(
                ServiceSession,
                r#"
                SELECT
                    id, base_path, session_name,
                    status as "status: String",
                    total_files, processed_files, last_processed_path,
                    songs_added, songs_updated, songs_skipped, errors_encountered,
                    started_at, completed_at, estimated_completion, error_message,
                    client_id, initiated_by_user_id, configuration,
                    created_at, updated_at
                FROM music_scan_sessions
                WHERE status IN ('running', 'paused')
                ORDER BY started_at DESC
                "#
            )
            .fetch_all(self.db.pool())
            .await?
        } else {
            sqlx::query_as!(
                ServiceSession,
                r#"
                SELECT
                    id, base_path, session_name,
                    status as "status: String",
                    total_files, processed_files, last_processed_path,
                    songs_added, songs_updated, songs_skipped, errors_encountered,
                    started_at, completed_at, estimated_completion, error_message,
                    client_id, initiated_by_user_id, configuration,
                    created_at, updated_at
                FROM music_scan_sessions
                ORDER BY started_at DESC
                "#
            )
            .fetch_all(self.db.pool())
            .await?
        };

        Ok(sessions)
    }

    /// Update scan progress
    pub async fn update_progress(
        &self,
        session_id: Uuid,
        processed_files: i32,
        last_processed_path: Option<String>,
        songs_added_delta: i32,
        songs_updated_delta: i32,
        songs_skipped_delta: i32,
        errors_delta: i32,
    ) -> Result<bool, MusicServiceError> {
        let result = sqlx::query!(
            "SELECT update_scan_session_progress($1, $2, $3, $4, $5, $6, $7) as success",
            session_id,
            processed_files,
            last_processed_path,
            songs_added_delta,
            songs_updated_delta,
            songs_skipped_delta,
            errors_delta
        )
        .fetch_one(self.db.pool())
        .await?;

        Ok(result.success.unwrap_or(false))
    }

    /// Complete or update session status
    pub async fn complete_session(
        &self,
        session_id: Uuid,
        status: ScanSessionStatus,
        error_message: Option<String>,
    ) -> Result<bool, MusicServiceError> {
        let result = sqlx::query!(
            "SELECT complete_scan_session($1, $2, $3) as success",
            session_id,
            status.as_str(),
            error_message
        )
        .fetch_one(self.db.pool())
        .await?;

        Ok(result.success.unwrap_or(false))
    }

    /// Cancel a running session
    pub async fn cancel_session(&self, session_id: Uuid) -> Result<bool, MusicServiceError> {
        self.complete_session(
            session_id,
            ScanSessionStatus::Cancelled,
            Some("Cancelled by user".to_string()),
        )
        .await
    }

    /// Pause a running session
    pub async fn pause_session(&self, session_id: Uuid) -> Result<bool, MusicServiceError> {
        self.complete_session(
            session_id,
            ScanSessionStatus::Paused,
            Some("Paused by user".to_string()),
        )
        .await
    }

    /// Resume a paused session
    pub async fn resume_session(&self, session_id: Uuid) -> Result<ScanResult, MusicServiceError> {
        let session = self.get_session(session_id).await?;

        if !session.can_resume() {
            return Err(MusicServiceError::InvalidSessionState(format!(
                "Session cannot be resumed. Current status: {}",
                session.status.as_str()
            )));
        }

        // Update status back to running
        sqlx::query!(
            "UPDATE music_scan_sessions SET status = $1, updated_at = NOW() WHERE id = $2",
            ScanSessionStatus::Running.as_str(),
            session_id
        )
        .execute(self.db.pool())
        .await?;

        Ok(ScanResult {
            session_id,
            total_files: session.total_files.unwrap_or(0) as usize,
            session_name: session.session_name.unwrap_or_default(),
        })
    }

    /// Clean up old completed sessions
    pub async fn cleanup_old_sessions(
        &self,
        days_to_keep: i32,
    ) -> Result<CleanupResult, MusicServiceError> {
        let result = sqlx::query!("SELECT * FROM cleanup_old_music_data($1)", days_to_keep)
            .fetch_one(self.db.pool())
            .await?;

        Ok(CleanupResult {
            sessions_deleted: result.deleted_sessions.unwrap_or(0),
            jobs_deleted: result.deleted_jobs.unwrap_or(0),
        })
    }

    /// Get music job health statistics
    pub async fn get_job_health(&self) -> Result<serde_json::Value, MusicServiceError> {
        let health = sqlx::query!("SELECT * FROM get_music_job_health()")
            .fetch_one(self.db.pool())
            .await?;

        Ok(serde_json::json!({
            "total_jobs": health.total_jobs,
            "pending_jobs": health.pending_jobs,
            "in_progress_jobs": health.in_progress_jobs,
            "completed_jobs": health.completed_jobs,
            "failed_jobs": health.failed_jobs,
            "avg_processing_time_minutes": health.avg_processing_time_minutes.map(|d| d.to_string().parse::<f64>().unwrap_or(0.0)),
            "active_sessions": health.active_sessions,
            "stale_jobs": health.stale_jobs,
            "oldest_pending_age_minutes": health.oldest_pending_age_minutes
        }))
    }

    /// Create scanner with configuration
    pub fn create_scanner(&self, config: ScannerConfig) -> Scanner {
        Scanner::with_config(self.config, config)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    // use crate::test_helpers::*;

    // TODO: Re-enable when test_helpers module is created
    // #[sqlx::test]
    // async fn test_music_service_creation() {
    //     let pool = setup_test_database().await;
    //     let db = DatabaseConnection::new(pool);
    //     let config = AppConfig::default();

    //     let service = MusicService::new(&db, &config);

    //     // Service should be created successfully
    //     assert!(std::ptr::eq(service.db, &db));
    //     assert!(std::ptr::eq(service.config, &config));
    // }

    #[test]
    fn test_scan_config_serialization() {
        let config = ScanConfig {
            base_path: "/test/music".to_string(),
            session_name: Some("Test Scan".to_string()),
            scanner_config: ScannerConfig::default(),
            max_file_size: Some(100 * 1024 * 1024), // 100MB
            user_id: Some(Uuid::new_v4()),
        };

        let json = serde_json::to_string(&config).unwrap();
        let deserialized: ScanConfig = serde_json::from_str(&json).unwrap();

        assert_eq!(deserialized.base_path, config.base_path);
        assert_eq!(deserialized.session_name, config.session_name);
        assert_eq!(deserialized.max_file_size, config.max_file_size);
        assert_eq!(deserialized.user_id, config.user_id);
    }

    #[test]
    fn test_session_stats_structure() {
        let stats = SessionStats {
            session_id: Uuid::new_v4(),
            base_path: "/test".to_string(),
            session_name: Some("Test".to_string()),
            status: ScanSessionStatus::Running,
            progress_percentage: Some(50.0),
            processed_files: 100,
            total_files: Some(200),
            songs_added: 80,
            songs_updated: 15,
            songs_skipped: 5,
            errors_encountered: 0,
            elapsed_time_minutes: Some(30),
            estimated_remaining_minutes: Some(30),
            jobs_pending: 10,
            jobs_in_progress: 2,
            jobs_completed: 88,
            jobs_failed: 0,
            started_at: OffsetDateTime::now_utc(),
            completed_at: None,
        };

        assert_eq!(stats.processed_files, 100);
        assert_eq!(stats.progress_percentage, Some(50.0));
        assert_eq!(stats.status, ScanSessionStatus::Running);
    }
}
