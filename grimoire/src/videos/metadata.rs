//! Video metadata extraction
//!
//! This module provides video metadata extraction functionality using FFmpeg/FFprobe
//! for extracting technical information from video files including duration, resolution,
//! codecs, and other video properties.

use crate::videos::models::VideoMetadata;
use serde_json::Value;
use std::path::Path;
use std::process::Command;
use tracing::{debug, error};

#[derive(Debug, thiserror::Error)]
pub enum VideoMetadataError {
    #[error("FFprobe not found or not executable")]
    FFprobeNotFound,
    #[error("FFprobe execution failed: {0}")]
    FFprobeExecutionFailed(String),
    #[error("Invalid JSON output from FFprobe: {0}")]
    InvalidJson(#[from] serde_json::Error),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("File not found: {0}")]
    FileNotFound(String),
    #[error("Unsupported video format: {0}")]
    UnsupportedFormat(String),
    #[error("Video analysis failed: {0}")]
    AnalysisFailed(String),
}

pub type Result<T> = std::result::Result<T, VideoMetadataError>;

/// Video metadata extractor using FFmpeg/FFprobe
pub struct VideoMetadataExtractor {
    ffprobe_path: String,
    timeout_seconds: u64,
}

impl VideoMetadataExtractor {
    /// Create a new video metadata extractor
    pub fn new() -> Self {
        Self {
            ffprobe_path: "ffprobe".to_string(),
            timeout_seconds: 30,
        }
    }

    /// Create a new extractor with custom FFprobe path
    pub fn with_ffprobe_path(ffprobe_path: String) -> Self {
        Self {
            ffprobe_path,
            timeout_seconds: 30,
        }
    }

    /// Create a new extractor with custom timeout
    pub fn with_timeout(mut self, timeout_seconds: u64) -> Self {
        self.timeout_seconds = timeout_seconds;
        self
    }

    /// Check if FFprobe is available
    pub fn is_available(&self) -> bool {
        Command::new(&self.ffprobe_path)
            .arg("-version")
            .output()
            .map(|output| output.status.success())
            .unwrap_or(false)
    }

    /// Extract metadata from a video file
    pub async fn extract_metadata(&self, file_path: &Path) -> Result<VideoMetadata> {
        if !file_path.exists() {
            return Err(VideoMetadataError::FileNotFound(
                file_path.to_string_lossy().to_string(),
            ));
        }

        debug!("Extracting video metadata from: {}", file_path.display());

        let ffprobe_output = self.run_ffprobe(file_path).await?;
        let metadata = VideoMetadata::from_ffprobe(&ffprobe_output);

        debug!("Extracted metadata: {:?}", metadata);
        Ok(metadata)
    }

    /// Run FFprobe to get video information
    async fn run_ffprobe(&self, file_path: &Path) -> Result<Value> {
        let output = tokio::process::Command::new(&self.ffprobe_path)
            .args([
                "-v",
                "quiet",
                "-print_format",
                "json",
                "-show_format",
                "-show_streams",
                file_path.to_str().unwrap(),
            ])
            .output()
            .await?;

        if !output.status.success() {
            let error_msg = String::from_utf8_lossy(&output.stderr);
            let stdout_msg = String::from_utf8_lossy(&output.stdout);
            error!("FFprobe failed with exit code: {:?}", output.status.code());
            error!("FFprobe stderr: {}", error_msg);
            error!("FFprobe stdout: {}", stdout_msg);
            error!("FFprobe command: ffprobe -v quiet -print_format json -show_format -show_streams {}", file_path.display());
            return Err(VideoMetadataError::FFprobeExecutionFailed(format!(
                "Exit code: {:?}, stderr: {}, stdout: {}",
                output.status.code(),
                error_msg,
                stdout_msg
            )));
        }

        let json_output = String::from_utf8_lossy(&output.stdout);
        debug!("FFprobe output: {}", json_output);

        let parsed: Value = serde_json::from_str(&json_output)?;
        Ok(parsed)
    }

    /// Extract basic video information without full metadata
    pub async fn extract_basic_info(&self, file_path: &Path) -> Result<BasicVideoInfo> {
        let output = tokio::process::Command::new(&self.ffprobe_path)
            .args([
                "-v",
                "quiet",
                "-print_format",
                "json",
                "-show_format",
                "-show_streams",
                file_path.to_str().unwrap(),
            ])
            .output()
            .await?;

        if !output.status.success() {
            let error_msg = String::from_utf8_lossy(&output.stderr);
            let stdout_msg = String::from_utf8_lossy(&output.stdout);
            error!(
                "FFprobe (basic info) failed with exit code: {:?}",
                output.status.code()
            );
            error!("FFprobe stderr: {}", error_msg);
            error!("FFprobe stdout: {}", stdout_msg);
            return Err(VideoMetadataError::FFprobeExecutionFailed(format!(
                "Exit code: {:?}, stderr: {}, stdout: {}",
                output.status.code(),
                error_msg,
                stdout_msg
            )));
        }

        let json_output = String::from_utf8_lossy(&output.stdout);
        let parsed: Value = serde_json::from_str(&json_output)?;

        Ok(BasicVideoInfo::from_ffprobe(&parsed))
    }

    /// Check if a file is a supported video format
    pub async fn is_supported_video(&self, file_path: &Path) -> bool {
        self.extract_basic_info(file_path).await.is_ok()
    }

    /// Get video duration in seconds
    pub async fn get_duration(&self, file_path: &Path) -> Result<f64> {
        let output = tokio::process::Command::new(&self.ffprobe_path)
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
            let stdout_msg = String::from_utf8_lossy(&output.stdout);
            error!(
                "FFprobe (duration) failed with exit code: {:?}",
                output.status.code()
            );
            error!("FFprobe stderr: {}", error_msg);
            error!("FFprobe stdout: {}", stdout_msg);
            return Err(VideoMetadataError::FFprobeExecutionFailed(format!(
                "Exit code: {:?}, stderr: {}, stdout: {}",
                output.status.code(),
                error_msg,
                stdout_msg
            )));
        }

        let duration_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
        duration_str
            .parse::<f64>()
            .map_err(|_| VideoMetadataError::AnalysisFailed("Invalid duration format".to_string()))
    }

    /// Get video resolution
    pub async fn get_resolution(&self, file_path: &Path) -> Result<(i32, i32)> {
        let output = tokio::process::Command::new(&self.ffprobe_path)
            .args([
                "-v",
                "quiet",
                "-show_entries",
                "stream=width,height",
                "-of",
                "csv=p=0",
                file_path.to_str().unwrap(),
            ])
            .output()
            .await?;

        if !output.status.success() {
            let error_msg = String::from_utf8_lossy(&output.stderr);
            let stdout_msg = String::from_utf8_lossy(&output.stdout);
            error!(
                "FFprobe (resolution) failed with exit code: {:?}",
                output.status.code()
            );
            error!("FFprobe stderr: {}", error_msg);
            error!("FFprobe stdout: {}", stdout_msg);
            return Err(VideoMetadataError::FFprobeExecutionFailed(format!(
                "Exit code: {:?}, stderr: {}, stdout: {}",
                output.status.code(),
                error_msg,
                stdout_msg
            )));
        }

        let resolution_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let parts: Vec<&str> = resolution_str.split(',').collect();

        if parts.len() != 2 {
            return Err(VideoMetadataError::AnalysisFailed(
                "Invalid resolution format".to_string(),
            ));
        }

        let width = parts[0]
            .parse::<i32>()
            .map_err(|_| VideoMetadataError::AnalysisFailed("Invalid width".to_string()))?;
        let height = parts[1]
            .parse::<i32>()
            .map_err(|_| VideoMetadataError::AnalysisFailed("Invalid height".to_string()))?;

        Ok((width, height))
    }
}

impl Default for VideoMetadataExtractor {
    fn default() -> Self {
        Self::new()
    }
}

/// Basic video information for quick checks
#[derive(Debug, Clone)]
pub struct BasicVideoInfo {
    pub duration: Option<f64>,
    pub width: Option<i32>,
    pub height: Option<i32>,
    pub codec: Option<String>,
    pub format: Option<String>,
}

impl BasicVideoInfo {
    /// Create from FFprobe output
    pub fn from_ffprobe(ffprobe_output: &Value) -> Self {
        let format = ffprobe_output.get("format").and_then(|f| f.as_object());
        let streams = ffprobe_output.get("streams").and_then(|s| s.as_array());

        let video_stream = streams.and_then(|streams| {
            streams
                .iter()
                .find(|stream| stream.get("codec_type").and_then(|ct| ct.as_str()) == Some("video"))
        });

        let duration = format
            .and_then(|f| f.get("duration"))
            .and_then(|d| d.as_str())
            .and_then(|d| d.parse::<f64>().ok());

        let width = video_stream
            .and_then(|vs| vs.get("width"))
            .and_then(|w| w.as_i64())
            .map(|w| w as i32);

        let height = video_stream
            .and_then(|vs| vs.get("height"))
            .and_then(|h| h.as_i64())
            .map(|h| h as i32);

        let codec = video_stream
            .and_then(|vs| vs.get("codec_name"))
            .and_then(|cn| cn.as_str())
            .map(|cn| cn.to_string());

        let format_name = format
            .and_then(|f| f.get("format_name"))
            .and_then(|fn_| fn_.as_str())
            .map(|fn_| fn_.to_string());

        Self {
            duration,
            width,
            height,
            codec,
            format: format_name,
        }
    }

    /// Check if this is a valid video file
    pub fn is_valid(&self) -> bool {
        self.duration.is_some() && self.width.is_some() && self.height.is_some()
    }
}

/// Extract full video metadata from a file
pub async fn extract_full_video_metadata(file_path: &Path) -> Result<VideoMetadata> {
    let extractor = VideoMetadataExtractor::new();

    if !extractor.is_available() {
        return Err(VideoMetadataError::FFprobeNotFound);
    }

    extractor.extract_metadata(file_path).await
}

/// Check if FFprobe is available on the system
pub fn is_ffprobe_available() -> bool {
    VideoMetadataExtractor::new().is_available()
}

/// Get supported video file extensions
pub fn supported_video_extensions() -> Vec<&'static str> {
    vec![
        "mp4", "mov", "avi", "mkv", "webm", "flv", "wmv", "m4v", "3gp", "ogv", "mpg", "mpeg",
        "m2v", "asf", "rm", "rmvb", "divx", "xvid", "ts", "mts", "m2ts", "vob", "f4v", "swf", "qt",
        "dv", "amv", "mp2", "mpe", "mpv",
    ]
}

/// Check if a file extension is supported
pub fn is_supported_extension(extension: &str) -> bool {
    let ext = extension.to_lowercase();
    supported_video_extensions().contains(&ext.as_str())
}

/// Extract metadata from multiple video files concurrently
pub async fn extract_metadata_batch(
    file_paths: &[&Path],
    max_concurrent: usize,
) -> Vec<Result<VideoMetadata>> {
    use futures_util::stream::{FuturesUnordered, StreamExt};

    let extractor = VideoMetadataExtractor::new();
    let mut futures = FuturesUnordered::new();
    let mut results = Vec::with_capacity(file_paths.len());

    for chunk in file_paths.chunks(max_concurrent) {
        for &path in chunk {
            futures.push(extractor.extract_metadata(path));
        }

        while let Some(result) = futures.next().await {
            results.push(result);
        }
    }

    results
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_supported_extensions() {
        assert!(is_supported_extension("mp4"));
        assert!(is_supported_extension("MP4"));
        assert!(is_supported_extension("mov"));
        assert!(is_supported_extension("avi"));
        assert!(!is_supported_extension("txt"));
        assert!(!is_supported_extension("jpg"));
    }

    #[test]
    fn test_ffprobe_availability() {
        let extractor = VideoMetadataExtractor::new();
        // This test depends on system having FFprobe installed
        // In CI/CD, this might fail, so we just check the method exists
        let _ = extractor.is_available();
    }

    #[test]
    fn test_extractor_configuration() {
        let extractor = VideoMetadataExtractor::new()
            .with_ffprobe_path("/usr/bin/ffprobe".to_string())
            .with_timeout(60);

        assert_eq!(extractor.ffprobe_path, "/usr/bin/ffprobe");
        assert_eq!(extractor.timeout_seconds, 60);
    }

    #[tokio::test]
    async fn test_nonexistent_file() {
        let extractor = VideoMetadataExtractor::new();
        let result = extractor
            .extract_metadata(Path::new("/nonexistent/file.mp4"))
            .await;

        assert!(matches!(result, Err(VideoMetadataError::FileNotFound(_))));
    }

    #[test]
    fn test_basic_video_info_validity() {
        let valid_info = BasicVideoInfo {
            duration: Some(120.0),
            width: Some(1920),
            height: Some(1080),
            codec: Some("h264".to_string()),
            format: Some("mp4".to_string()),
        };

        assert!(valid_info.is_valid());

        let invalid_info = BasicVideoInfo {
            duration: None,
            width: Some(1920),
            height: Some(1080),
            codec: Some("h264".to_string()),
            format: Some("mp4".to_string()),
        };

        assert!(!invalid_info.is_valid());
    }
}
