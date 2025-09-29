//! Download job queue system for processing URL downloads with yt-dlp

use grimoire::DatabaseConnection;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{broadcast, RwLock};
use tokio::task::JoinHandle;
use tokio::time::sleep;
use tracing::{error, info, warn};

use super::jobs::{get_pending_jobs, process_download_job};
use crate::error::AppError;

/// Download job queue statistics
#[derive(Debug, Clone)]
pub struct DownloadQueueStats {
    pub jobs_processed: u64,
    pub jobs_succeeded: u64,
    pub jobs_failed: u64,
    pub active_workers: usize,
}

impl DownloadQueueStats {
    fn new() -> Self {
        Self {
            jobs_processed: 0,
            jobs_succeeded: 0,
            jobs_failed: 0,
            active_workers: 0,
        }
    }
}

/// Download job queue manager
pub struct DownloadJobQueue {
    db: DatabaseConnection,
    download_dir: String,
    ytdlp_command: String,
    worker_handles: Arc<RwLock<Vec<JoinHandle<()>>>>,
    shutdown_tx: Option<broadcast::Sender<()>>,
    stats: Arc<RwLock<DownloadQueueStats>>,
    notification_tx: Option<broadcast::Sender<String>>,
}

impl DownloadJobQueue {
    /// Create a new download job queue
    pub fn new(db: DatabaseConnection, download_dir: String, ytdlp_command: String) -> Self {
        Self {
            db,
            download_dir,
            ytdlp_command,
            worker_handles: Arc::new(RwLock::new(Vec::new())),
            shutdown_tx: None,
            stats: Arc::new(RwLock::new(DownloadQueueStats::new())),
            notification_tx: None,
        }
    }

    /// Create a new download job queue with notification support
    pub fn new_with_notifications(
        db: DatabaseConnection,
        download_dir: String,
        ytdlp_command: String,
        notification_tx: broadcast::Sender<String>,
    ) -> Self {
        Self {
            db,
            download_dir,
            ytdlp_command,
            worker_handles: Arc::new(RwLock::new(Vec::new())),
            shutdown_tx: None,
            stats: Arc::new(RwLock::new(DownloadQueueStats::new())),
            notification_tx: Some(notification_tx),
        }
    }

    /// Start download job workers
    pub async fn start_workers(&mut self, worker_count: usize) -> Result<(), AppError> {
        info!("Starting {} download job workers", worker_count);

        let (shutdown_tx, _) = broadcast::channel(16);
        self.shutdown_tx = Some(shutdown_tx.clone());

        let mut handles = self.worker_handles.write().await;

        // Spawn worker tasks
        for worker_id in 0..worker_count {
            let db = self.db.clone();
            let download_dir = self.download_dir.clone();
            let ytdlp_command = self.ytdlp_command.clone();
            let mut shutdown_rx = shutdown_tx.subscribe();
            let stats = self.stats.clone();
            let notification_tx = self.notification_tx.clone();

            let handle = tokio::spawn(async move {
                info!(worker_id = worker_id, "Starting download worker");

                loop {
                    tokio::select! {
                        _ = shutdown_rx.recv() => {
                            info!(worker_id = worker_id, "Shutting down download worker");
                            break;
                        }
                        _ = Self::worker_loop(&db, &download_dir, &ytdlp_command, worker_id, &stats, &notification_tx) => {}
                    }
                }
            });

            handles.push(handle);
        }

        // Update stats
        {
            let mut stats_guard = self.stats.write().await;
            stats_guard.active_workers = worker_count;
        }

        info!("Download job workers started successfully");
        Ok(())
    }

    /// Main worker loop
    async fn worker_loop(
        db: &DatabaseConnection,
        download_dir: &str,
        ytdlp_command: &str,
        worker_id: usize,
        stats: &Arc<RwLock<DownloadQueueStats>>,
        notification_tx: &Option<broadcast::Sender<String>>,
    ) {
        loop {
            // Get pending jobs
            match get_pending_jobs(db, 1).await {
                Ok(jobs) => {
                    if let Some(job) = jobs.first() {
                        info!(
                            worker_id = worker_id,
                            job_id = %job.id,
                            url = %job.url,
                            "Processing download job"
                        );

                        // Process the job
                        let job_result =
                            process_download_job(db, job, download_dir, ytdlp_command).await;

                        // Update stats
                        {
                            let mut stats_guard = stats.write().await;
                            stats_guard.jobs_processed += 1;
                            match &job_result {
                                Ok(_) => stats_guard.jobs_succeeded += 1,
                                Err(_) => stats_guard.jobs_failed += 1,
                            }
                        }

                        match job_result {
                            Ok(downloaded_files) => {
                                info!(
                                    worker_id = worker_id,
                                    job_id = %job.id,
                                    file_count = downloaded_files.len(),
                                    "Download job completed successfully"
                                );

                                // Process downloaded files directly
                                for file_path in &downloaded_files {
                                    if let Err(e) =
                                        Self::process_downloaded_file(db, &file_path).await
                                    {
                                        warn!(
                                            job_id = %job.id,
                                            file_path = %file_path,
                                            error = %e,
                                            "Failed to process downloaded file"
                                        );
                                    }
                                }

                                // Send notification
                                if let Some(ref tx) = notification_tx {
                                    let notification = serde_json::json!({
                                        "event_type": "download_completed",
                                        "job_id": job.id.to_string(),
                                        "url": job.url,
                                        "file_count": downloaded_files.len()
                                    });

                                    if let Ok(notification_str) =
                                        serde_json::to_string(&notification)
                                    {
                                        let _ = tx.send(notification_str);
                                    }
                                }
                            }
                            Err(error) => {
                                error!(
                                    worker_id = worker_id,
                                    job_id = %job.id,
                                    error = %error,
                                    "Download job failed"
                                );
                            }
                        }
                    } else {
                        // No jobs available, sleep for a bit
                        sleep(Duration::from_secs(5)).await;
                    }
                }
                Err(e) => {
                    error!(
                        worker_id = worker_id,
                        error = %e,
                        "Failed to fetch download jobs"
                    );
                    sleep(Duration::from_secs(10)).await;
                }
            }
        }
    }

    /// Create music job for downloaded file (reuse existing system)
    async fn process_downloaded_file(
        db: &DatabaseConnection,
        file_path: &str,
    ) -> Result<(), AppError> {
        use crate::media::music_jobs;
        use grimoire::media::CreateMediaBlob;
        use sha2::{Digest, Sha256};
        use std::path::Path;

        let path = Path::new(file_path);
        let filename = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("unknown");

        info!(
            file_path = %file_path,
            "Creating media blob and music job for downloaded file"
        );

        // Read file for hash calculation
        let file_data = match tokio::fs::read(file_path).await {
            Ok(data) => data,
            Err(e) => {
                error!("Failed to read downloaded file {}: {}", file_path, e);
                return Err(AppError::InternalServerError(
                    "Failed to read downloaded file".to_string(),
                ));
            }
        };

        // Calculate file hash and size
        let file_size = file_data.len() as i64;
        let mut hasher = Sha256::new();
        hasher.update(&file_data);
        let sha256 = format!("{:x}", hasher.finalize());

        // Use the absolute path as stored by yt-dlp
        let absolute_path = file_path.to_string();

        // Create media blob first
        let create_blob = CreateMediaBlob {
            data: None, // File is already on disk
            sha256,
            size: Some(file_size),
            mime: Some("audio/mpeg".to_string()), // Assume MP3 from yt-dlp
            source_client_id: Some("download_worker".to_string()),
            local_path: Some(absolute_path),
            parent_blob_id: None,
            blob_type: Some("original".to_string()),
            metadata: serde_json::json!({
                "source": "url_download",
                "original_filename": filename
            }),
        };

        // Create media blob using repository
        let media_repository = crate::media::MediaRepository::new(db);
        let media_config = grimoire::config::MediaConfig {
            max_blob_file_size: 10 * 1024 * 1024,
            max_fs_file_size: 1024 * 1024 * 1024,
            supported_audio_formats: vec!["mp3".to_string()],
            thumbnails: grimoire::config::app_config::ThumbnailConfig::default(),
            playback: grimoire::config::app_config::AudioPlaybackConfig::default(),
            downloads: grimoire::config::app_config::DownloadConfig::default(),
        };

        let media_blob = match media_repository.create(create_blob, &media_config).await {
            Ok(blob) => blob,
            Err(e) => {
                error!("Failed to create media blob for downloaded file: {}", e);
                return Err(AppError::InternalServerError(
                    "Failed to create media blob".to_string(),
                ));
            }
        };

        // Create upload metadata to trigger web defaults
        let upload_metadata = serde_json::json!({
            "process_music": true,
            "source": "url_download"
        });

        // Create music job using existing system (this will handle thumbnails too)
        match music_jobs::create_music_job(
            db,
            &media_blob.id,
            file_path,
            Some(filename),
            Some(&upload_metadata),
        )
        .await
        {
            Ok(job_id) => {
                info!(
                    file_path = %file_path,
                    job_id = %job_id,
                    media_blob_id = %media_blob.id,
                    "Created music job for downloaded file"
                );
                Ok(())
            }
            Err(e) => {
                error!("Failed to create music job for downloaded file: {}", e);
                Err(e)
            }
        }
    }

    /// Stop all workers
    pub async fn stop_workers(&mut self) -> Result<(), AppError> {
        info!("Stopping download job workers");

        if let Some(shutdown_tx) = &self.shutdown_tx {
            let _ = shutdown_tx.send(());
        }

        let mut handles = self.worker_handles.write().await;
        for handle in handles.drain(..) {
            if let Err(e) = handle.await {
                warn!("Error waiting for worker to shutdown: {}", e);
            }
        }

        // Update stats
        {
            let mut stats_guard = self.stats.write().await;
            stats_guard.active_workers = 0;
        }

        self.shutdown_tx = None;
        info!("Download job workers stopped");
        Ok(())
    }

    /// Get queue statistics
    pub async fn get_stats(&self) -> DownloadQueueStats {
        self.stats.read().await.clone()
    }

    /// Check if yt-dlp is available
    pub async fn check_ytdlp_available(ytdlp_command: &str) -> bool {
        match tokio::process::Command::new(ytdlp_command)
            .arg("--version")
            .output()
            .await
        {
            Ok(output) => output.status.success(),
            Err(_) => false,
        }
    }
}

impl Drop for DownloadJobQueue {
    fn drop(&mut self) {
        if self.shutdown_tx.is_some() {
            warn!("DownloadJobQueue dropped without proper shutdown");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_queue_stats() {
        let stats = DownloadQueueStats::new();
        assert_eq!(stats.jobs_processed, 0);
        assert_eq!(stats.jobs_succeeded, 0);
        assert_eq!(stats.jobs_failed, 0);
        assert_eq!(stats.active_workers, 0);
    }

    #[tokio::test]
    async fn test_ytdlp_check() {
        // This test might fail if yt-dlp is not installed
        // That's expected behavior
        let _available = DownloadJobQueue::check_ytdlp_available().await;
        // Just check that the function runs without panicking
    }
}
