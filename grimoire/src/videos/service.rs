//! Video service for video processing and storage
//!
//! This service provides video processing functionality including:
//! - Video file processing and storage
//! - Video metadata extraction and storage
//! - Video thumbnail generation (10 evenly spaced screenshots)
//! - Video playlist management
//! - Database integration

use crate::media::CreateMediaBlob;
use crate::videos::models::{CreateVideoPlaylist, Video, VideoPlaylist};
use crate::videos::{
    extract_full_video_metadata, VideoMetadataError, VideoRepository, VideoRepositoryError,
};
use futures_util::future;
use sqlx::PgPool;
use std::path::Path;
use std::process::Command;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Semaphore;
use tracing::{debug, error, info, warn};
use uuid::Uuid;

#[derive(Debug, thiserror::Error)]
pub enum VideoServiceError {
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("Repository error: {0}")]
    Repository(#[from] VideoRepositoryError),
    #[error("Media blob service error: {0}")]
    MediaBlob(#[from] crate::media::MediaServiceError),
    #[error("Metadata extraction error: {0}")]
    MetadataExtraction(#[from] VideoMetadataError),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Validation error: {0}")]
    Validation(String),
    #[error("Thumbnail generation error: {0}")]
    ThumbnailGeneration(String),
    #[error("FFmpeg not found or not executable")]
    FFmpegNotFound,
}

pub type Result<T> = std::result::Result<T, VideoServiceError>;

/// Video service for video operations
pub struct VideoService {
    repository: VideoRepository,
    ffmpeg_path: String,
    // Semaphore to limit concurrent FFmpeg processes
    ffmpeg_semaphore: Arc<Semaphore>,
}

impl VideoService {
    /// Create a new video service
    pub fn new(pool: PgPool) -> Self {
        let repository = VideoRepository::new(pool);
        Self {
            repository,
            ffmpeg_path: "ffmpeg".to_string(),
            // Limit to 2 concurrent FFmpeg processes to prevent resource exhaustion
            ffmpeg_semaphore: Arc::new(Semaphore::new(2)),
        }
    }

    /// Create a new video service with custom FFmpeg path
    pub fn with_ffmpeg_path(pool: PgPool, ffmpeg_path: String) -> Self {
        let repository = VideoRepository::new(pool);
        Self {
            repository,
            ffmpeg_path,
            // Limit to 2 concurrent FFmpeg processes to prevent resource exhaustion
            ffmpeg_semaphore: Arc::new(Semaphore::new(2)),
        }
    }

    /// Process a video file and save it to the database
    /// This is the main method that integrates scanning with storage
    pub async fn process_and_store_video(
        &self,
        file_path: &Path,
        _session_id: Option<Uuid>,
        client_id: Option<&str>,
    ) -> Result<Video> {
        debug!("Processing video file: {}", file_path.display());

        // Validate file exists and is readable
        if !file_path.exists() {
            return Err(VideoServiceError::Validation(format!(
                "File not found: {}",
                file_path.display()
            )));
        }

        let file_size = std::fs::metadata(file_path)?.len();
        debug!("File size: {} bytes", file_size);

        // Extract metadata from the video
        let video_metadata = extract_full_video_metadata(file_path)
            .await
            .map_err(VideoServiceError::MetadataExtraction)?;

        debug!(
            "Extracted metadata: codec={:?}, dimensions={:?}x{:?}, duration={:?}",
            video_metadata.video_codec,
            video_metadata.width_px,
            video_metadata.height_px,
            video_metadata.duration
        );

        // Calculate file hash for deduplication
        let file_hash = self.calculate_file_hash(file_path).await?;
        debug!("File hash: {}", file_hash);

        // Check if we already have this video (by hash)
        if self.repository.exists_by_hash(&file_hash).await? {
            warn!("Video already exists with hash {}, skipping", file_hash);
            return Err(VideoServiceError::Validation(
                "Video already exists in database".to_string(),
            ));
        }

        // Detect MIME type
        let mime_type = self.detect_mime_type(file_path);
        debug!("Detected MIME type: {}", mime_type);

        // Create video record first (without thumbnails)
        let video = self
            .repository
            .create_video_with_blob(
                &file_path.to_string_lossy(),
                file_hash,
                file_size as i64,
                mime_type,
                video_metadata,
                client_id,
                None, // thumbnail_blob_id - will be updated after thumbnail creation
                None, // thumbnail_blob_ids - will be updated after thumbnail creation
            )
            .await?;

        // Generate thumbnails using the video's media blob ID
        let thumbnail_blob_ids = self
            .generate_and_store_thumbnails(file_path, &video.media_blob_id, client_id)
            .await
            .map_err(|e| {
                warn!("Failed to generate thumbnails: {}", e);
                e
            })
            .ok(); // Make thumbnail generation non-fatal

        // Select primary thumbnail (2nd thumbnail if available, otherwise first)
        let primary_thumbnail_blob_id = thumbnail_blob_ids.as_ref().and_then(|ids| {
            if ids.len() >= 2 {
                ids.get(1).cloned()
            } else {
                ids.first().cloned()
            }
        });

        // Update video with thumbnail information if generation succeeded
        if let (Some(primary_thumb), Some(thumb_array)) =
            (&primary_thumbnail_blob_id, &thumbnail_blob_ids)
        {
            self.repository
                .update_video_thumbnails(video.id, primary_thumb.clone(), thumb_array.clone())
                .await
                .map_err(|e| {
                    warn!("Failed to update video with thumbnails: {}", e);
                    e
                })?;
            debug!(
                "Updated video {} with {} thumbnails",
                video.id,
                thumb_array.len()
            );
        }

        info!("Created video record with ID: {}", video.id);

        Ok(video)
    }

    /// List recent videos
    pub async fn list_recent_videos(&self, limit: i64) -> Result<Vec<Video>> {
        let videos = self.repository.list_videos(None, Some(limit), None).await?;
        Ok(videos)
    }

    /// Get a video by ID
    pub async fn get_video(&self, id: Uuid) -> Result<Video> {
        let video = self.repository.get_video(id).await?;
        Ok(video)
    }

    /// Create a new playlist
    pub async fn create_playlist(
        &self,
        create_playlist: CreateVideoPlaylist,
    ) -> Result<VideoPlaylist> {
        let playlist = self.repository.create_playlist(create_playlist).await?;
        Ok(playlist)
    }

    /// Add videos to a playlist
    pub async fn add_videos_to_playlist(
        &self,
        playlist_id: Uuid,
        video_ids: &[Uuid],
    ) -> Result<()> {
        for video_id in video_ids {
            self.repository
                .add_video_to_playlist(playlist_id, *video_id, None)
                .await?;
        }
        Ok(())
    }

    /// Remove videos from a playlist
    pub async fn remove_videos_from_playlist(
        &self,
        playlist_id: Uuid,
        video_ids: &[Uuid],
    ) -> Result<()> {
        for video_id in video_ids {
            self.repository
                .remove_video_from_playlist(playlist_id, *video_id)
                .await?;
        }
        Ok(())
    }

    /// List playlists
    pub async fn list_playlists(&self, limit: i64) -> Result<Vec<VideoPlaylist>> {
        let playlists = self
            .repository
            .list_playlists(None, Some(limit), None)
            .await?;
        Ok(playlists)
    }

    /// Get a playlist by ID
    pub async fn get_playlist(&self, id: Uuid) -> Result<VideoPlaylist> {
        let playlist = self.repository.get_playlist(id).await?;
        Ok(playlist)
    }

    /// Get videos in a playlist
    pub async fn get_playlist_videos(&self, playlist_id: Uuid, limit: i64) -> Result<Vec<Video>> {
        let videos = self
            .repository
            .get_playlist_videos(playlist_id, Some(limit), None)
            .await?;
        Ok(videos)
    }

    /// Find playlists by title (case-insensitive partial match)
    pub async fn find_playlists_by_title(&self, title_pattern: &str) -> Result<Vec<VideoPlaylist>> {
        let playlists = self
            .repository
            .find_playlists_by_title(title_pattern)
            .await?;
        Ok(playlists)
    }

    /// Delete playlist (soft delete)
    pub async fn delete_playlist(&self, playlist_id: Uuid) -> Result<()> {
        self.repository.delete_playlist(playlist_id, None).await?;
        Ok(())
    }

    /// Get video statistics
    pub async fn get_video_stats(&self) -> Result<VideoStats> {
        let total_videos = self.repository.count_videos(None).await?;
        let total_playlists = self.repository.count_playlists(None).await?;

        Ok(VideoStats {
            total_videos,
            total_playlists,
            total_favorites: 0, // TODO: implement favorites count
            storage_used_mb: 0, // TODO: implement storage calculation
        })
    }

    // Private helper methods

    /// Calculate SHA256 hash of a file
    async fn calculate_file_hash(&self, file_path: &Path) -> Result<String> {
        use sha2::{Digest, Sha256};
        use tokio::io::AsyncReadExt;

        let mut file = tokio::fs::File::open(file_path).await?;
        let mut hasher = Sha256::new();
        let mut buffer = [0u8; 8192];

        loop {
            let bytes_read = file.read(&mut buffer).await?;
            if bytes_read == 0 {
                break;
            }
            hasher.update(&buffer[..bytes_read]);
        }

        let hash = hasher.finalize();
        Ok(format!("{:x}", hash))
    }

    /// Detect MIME type from file extension
    fn detect_mime_type(&self, file_path: &Path) -> String {
        mime_guess::from_path(file_path)
            .first()
            .map(|mime| mime.to_string())
            .unwrap_or_else(|| "application/octet-stream".to_string())
    }

    /// Check if FFmpeg is available
    fn is_ffmpeg_available(&self) -> bool {
        Command::new(&self.ffmpeg_path)
            .arg("-version")
            .output()
            .map(|output| output.status.success())
            .unwrap_or(false)
    }

    /// Generate and store 10 evenly spaced thumbnails for a video with optimizations
    async fn generate_and_store_thumbnails(
        &self,
        file_path: &Path,
        parent_blob_id: &str,
        client_id: Option<&str>,
    ) -> Result<Vec<String>> {
        debug!(
            "Generating 10 optimized thumbnails for: {}",
            file_path.display()
        );

        // Check if FFmpeg is available
        if !self.is_ffmpeg_available() {
            return Err(VideoServiceError::FFmpegNotFound);
        }

        // Get video duration first
        let duration = self.get_video_duration(file_path).await?;
        debug!("Video duration: {} seconds", duration);

        // Use optimized single-pass generation for large videos
        self.generate_thumbnails_optimized(file_path, duration, parent_blob_id, client_id)
            .await
    }

    /// Generate thumbnails with concurrent processing and resource limits
    async fn generate_thumbnails_optimized(
        &self,
        file_path: &Path,
        duration: f64,
        parent_blob_id: &str,
        client_id: Option<&str>,
    ) -> Result<Vec<String>> {
        debug!(
            "Concurrent thumbnail generation for: {}",
            file_path.display()
        );

        // Calculate all timestamps first
        let timestamps: Vec<f64> = (1..=10)
            .map(|i| {
                let percentage = if i == 10 { 0.95 } else { i as f64 / 10.0 };
                duration * percentage
            })
            .collect();

        // Use concurrent generation for better performance
        self.generate_thumbnails_concurrent(file_path, &timestamps, parent_blob_id, client_id)
            .await
    }

    /// Generate multiple thumbnails concurrently with semaphore limiting
    async fn generate_thumbnails_concurrent(
        &self,
        file_path: &Path,
        timestamps: &[f64],
        parent_blob_id: &str,
        client_id: Option<&str>,
    ) -> Result<Vec<String>> {
        debug!(
            "Concurrent generating {} thumbnails for: {}",
            timestamps.len(),
            file_path.display()
        );

        // Create futures for all thumbnails
        let futures: Vec<_> = timestamps
            .iter()
            .enumerate()
            .map(|(i, &timestamp)| {
                let file_path = file_path.to_path_buf();
                let parent_blob_id = parent_blob_id.to_string();
                let client_id = client_id.map(|s| s.to_string());
                let semaphore = self.ffmpeg_semaphore.clone();
                let ffmpeg_path = self.ffmpeg_path.clone();

                async move {
                    // Acquire semaphore to limit concurrent FFmpeg processes
                    let _permit = semaphore.acquire().await.unwrap();

                    let temp_file = std::env::temp_dir().join(format!(
                        "thumb_{}_{}_frame_{}.jpg",
                        std::process::id(),
                        std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap()
                            .as_millis(),
                        i
                    ));

                    let mut cmd = tokio::process::Command::new(&ffmpeg_path);
                    cmd.args([
                        "-ss",
                        &format!("{:.2}", timestamp),
                        "-i",
                        file_path.to_str().unwrap(),
                        "-vframes",
                        "1",
                        "-vf",
                        "scale=320:240:force_original_aspect_ratio=decrease",
                        "-q:v",
                        "8",
                        "-preset",
                        "ultrafast",
                        "-threads",
                        "1",
                        "-y",
                        temp_file.to_str().unwrap(),
                    ]);

                    // Set timeout for individual thumbnail
                    let output = tokio::time::timeout(Duration::from_secs(10), cmd.output()).await;

                    let output = match output {
                        Ok(result) => result.map_err(|e| format!("FFmpeg error: {}", e))?,
                        Err(_) => {
                            warn!(
                                "FFmpeg timeout for thumbnail {} at {:.2}s",
                                i + 1,
                                timestamp
                            );
                            return Err(format!("Timeout at {:.2}s", timestamp));
                        }
                    };

                    if !output.status.success() {
                        let error_msg = String::from_utf8_lossy(&output.stderr);
                        warn!(
                            "FFmpeg failed for thumbnail {} at {:.2}s: {}",
                            i + 1,
                            timestamp,
                            error_msg
                        );
                        let _ = tokio::fs::remove_file(&temp_file).await;
                        return Err(format!("FFmpeg failed: {}", error_msg));
                    }

                    // Read and process the thumbnail file
                    if temp_file.exists() {
                        let result = self
                            .process_thumbnail_file(
                                &temp_file,
                                timestamp,
                                &parent_blob_id,
                                client_id.as_deref(),
                            )
                            .await;

                        // Clean up temp file
                        let _ = tokio::fs::remove_file(&temp_file).await;

                        result.map_err(|e| format!("Process error: {}", e))
                    } else {
                        Err("Thumbnail file not created".to_string())
                    }
                }
            })
            .collect();

        // Execute all futures concurrently
        let results = future::join_all(futures).await;

        // Collect successful results
        let mut thumbnail_blob_ids = Vec::new();
        for (i, result) in results.into_iter().enumerate() {
            match result {
                Ok(blob_id) => {
                    thumbnail_blob_ids.push(blob_id);
                }
                Err(e) => {
                    warn!("Failed to generate thumbnail {}: {}", i + 1, e);
                }
            }
        }

        if thumbnail_blob_ids.is_empty() {
            return Err(VideoServiceError::ThumbnailGeneration(
                "Failed to generate any thumbnails concurrently".to_string(),
            ));
        }

        info!(
            "Generated {} thumbnails concurrently for video: {}",
            thumbnail_blob_ids.len(),
            file_path.display()
        );

        Ok(thumbnail_blob_ids)
    }

    /// Generate a single thumbnail with performance optimizations
    /// Process a thumbnail file on disk and create a media blob
    async fn process_thumbnail_file(
        &self,
        thumb_path: &Path,
        timestamp: f64,
        parent_blob_id: &str,
        client_id: Option<&str>,
    ) -> Result<String> {
        // Read the thumbnail file
        let thumbnail_data = tokio::fs::read(thumb_path).await?;

        // Calculate thumbnail hash
        let thumbnail_hash = self.calculate_data_hash(&thumbnail_data).await?;

        // Create media blob for thumbnail
        let create_blob = CreateMediaBlob {
            data: Some(thumbnail_data),
            sha256: thumbnail_hash,
            size: None,
            mime: Some("image/jpeg".to_string()),
            source_client_id: client_id.map(|s| s.to_string()),
            local_path: None,
            parent_blob_id: Some(parent_blob_id.to_string()),
            blob_type: Some("thumbnail".to_string()),
            metadata: serde_json::json!({
                "width": 320,
                "height": 240,
                "format": "jpeg",
                "timestamp": timestamp,
                "batch_generated": true
            }),
        };

        let media_blob = self
            .repository
            .media_blob_service
            .create_media_blob(create_blob)
            .await?;

        debug!(
            "Created batch thumbnail blob with ID: {} for timestamp {:.2}s",
            media_blob.id, timestamp
        );
        Ok(media_blob.id)
    }

    /// Fallback method for single thumbnail generation (kept for compatibility)
    #[allow(dead_code)]
    async fn generate_thumbnail_optimized(
        &self,
        file_path: &Path,
        timestamp: f64,
        parent_blob_id: &str,
        client_id: Option<&str>,
    ) -> Result<String> {
        // Acquire semaphore to limit concurrent FFmpeg processes
        let _permit = self.ffmpeg_semaphore.acquire().await.unwrap();

        // Optimized FFmpeg command with fast seeking, reduced quality, and resource limits
        let mut cmd = tokio::process::Command::new(&self.ffmpeg_path);
        cmd.args([
            "-ss",
            &format!("{:.2}", timestamp), // Seek BEFORE input for faster performance
            "-i",
            file_path.to_str().unwrap(),
            "-vframes",
            "1",
            "-f",
            "image2",
            "-vf",
            "scale=320:240:force_original_aspect_ratio=decrease",
            "-q:v",
            "8", // Lower quality for faster processing
            "-preset",
            "ultrafast", // Fastest encoding preset
            "-threads",
            "1", // Limit thread usage for single thumbnail
            "-",
        ]);

        // Set timeout to prevent hanging
        let output = tokio::time::timeout(Duration::from_secs(15), cmd.output()).await;

        let output = match output {
            Ok(result) => result?,
            Err(_) => {
                return Err(VideoServiceError::ThumbnailGeneration(format!(
                    "FFmpeg timed out at timestamp {:.2}s",
                    timestamp
                )));
            }
        };

        if !output.status.success() {
            let error_msg = String::from_utf8_lossy(&output.stderr);
            let stdout_msg = String::from_utf8_lossy(&output.stdout);
            return Err(VideoServiceError::ThumbnailGeneration(format!(
                "FFmpeg failed at timestamp {:.2}s: stderr: {}, stdout: {}",
                timestamp, error_msg, stdout_msg
            )));
        }

        let thumbnail_data = output.stdout;

        // Calculate thumbnail hash
        let thumbnail_hash = self.calculate_data_hash(&thumbnail_data).await?;

        // Create media blob for thumbnail
        let create_blob = CreateMediaBlob {
            data: Some(thumbnail_data),
            sha256: thumbnail_hash,
            size: None,
            mime: Some("image/jpeg".to_string()),
            source_client_id: client_id.map(|s| s.to_string()),
            local_path: None,
            parent_blob_id: Some(parent_blob_id.to_string()),
            blob_type: Some("thumbnail".to_string()),
            metadata: serde_json::json!({
                "width": 320,
                "height": 240,
                "format": "jpeg",
                "timestamp": timestamp,
                "optimized": true
            }),
        };

        let media_blob = self
            .repository
            .media_blob_service
            .create_media_blob(create_blob)
            .await?;

        debug!(
            "Created optimized thumbnail blob with ID: {}",
            media_blob.id
        );
        Ok(media_blob.id)
    }

    /// Get video duration using FFprobe
    async fn get_video_duration(&self, file_path: &Path) -> Result<f64> {
        let output = tokio::process::Command::new("ffprobe")
            .args([
                "-v",
                "quiet",
                "-show_entries",
                "format=duration",
                "-of",
                "csv=p=0",
                file_path.to_str().unwrap(),
            ])
            .output()
            .await?;

        if !output.status.success() {
            let error_msg = String::from_utf8_lossy(&output.stderr);
            return Err(VideoServiceError::ThumbnailGeneration(format!(
                "FFprobe failed: {}",
                error_msg
            )));
        }

        let duration_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
        duration_str.parse::<f64>().map_err(|_| {
            VideoServiceError::ThumbnailGeneration("Invalid duration format".to_string())
        })
    }

    /// Calculate SHA256 hash of data
    async fn calculate_data_hash(&self, data: &[u8]) -> Result<String> {
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        hasher.update(data);
        let hash = hasher.finalize();
        Ok(format!("{:x}", hash))
    }
}

/// Video statistics
#[derive(Debug, Clone)]
pub struct VideoStats {
    pub total_videos: i64,
    pub total_playlists: i64,
    pub total_favorites: i64,
    pub storage_used_mb: i64,
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::path::PathBuf;

    #[test]
    fn test_video_service_creation() {
        // This test would need a real database connection
        // For now, just test the structure
        let service = VideoService::with_ffmpeg_path(
            // This would need a real PgPool
            unsafe { std::mem::zeroed() },
            "/usr/bin/ffmpeg".to_string(),
        );
        assert_eq!(service.ffmpeg_path, "/usr/bin/ffmpeg");
    }

    #[test]
    fn test_mime_type_detection() {
        let service =
            VideoService::with_ffmpeg_path(unsafe { std::mem::zeroed() }, "ffmpeg".to_string());

        let mp4_path = PathBuf::from("test.mp4");
        let mime_type = service.detect_mime_type(&mp4_path);
        assert_eq!(mime_type, "video/mp4");

        let mov_path = PathBuf::from("test.mov");
        let mime_type = service.detect_mime_type(&mov_path);
        assert_eq!(mime_type, "video/quicktime");
    }

    #[tokio::test]
    async fn test_calculate_data_hash() {
        let service =
            VideoService::with_ffmpeg_path(unsafe { std::mem::zeroed() }, "ffmpeg".to_string());

        let data = b"hello world";
        let hash = service.calculate_data_hash(data).await.unwrap();

        // SHA256 hash of "hello world"
        assert_eq!(
            hash,
            "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
        );
    }

    #[test]
    fn test_video_stats() {
        let stats = VideoStats {
            total_videos: 100,
            total_playlists: 10,
            total_favorites: 25,
            storage_used_mb: 5000,
        };

        assert_eq!(stats.total_videos, 100);
        assert_eq!(stats.total_playlists, 10);
        assert_eq!(stats.total_favorites, 25);
        assert_eq!(stats.storage_used_mb, 5000);
    }
}
