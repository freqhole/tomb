//! Music directory scanner for discovering audio files
//!
//! This module provides functionality for traversing directories and discovering
//! supported audio files. It replaces the monolithic file_walker approach with
//! a cleaner, more focused implementation.

use std::path::{Path, PathBuf};
use thiserror::Error;
use tokio::fs;
use walkdir::{DirEntry, WalkDir};

use crate::config::AppConfig;
use crate::media::MediaTypeDetector;

/// Errors that can occur during music scanning
#[derive(Debug, Error)]
pub enum ScannerError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Path is not a directory: {0}")]
    NotADirectory(String),
    #[error("Media type detection error: {0}")]
    MediaTypeError(String),
    #[error("Walk directory error: {0}")]
    WalkDirError(String),
}

/// Configuration for the music scanner
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ScannerConfig {
    /// Maximum number of files to process in a single batch
    pub batch_size: usize,
    /// Maximum depth to traverse into subdirectories
    pub max_depth: Option<usize>,
    /// Whether to follow symbolic links
    pub follow_symlinks: bool,
    /// File extensions to include (if empty, uses detector)
    pub include_extensions: Vec<String>,
    /// File extensions to explicitly exclude
    pub exclude_extensions: Vec<String>,
}

impl Default for ScannerConfig {
    fn default() -> Self {
        Self {
            batch_size: 50,
            max_depth: None,
            follow_symlinks: false,
            include_extensions: Vec::new(),
            exclude_extensions: vec!["tmp".to_string(), "bak".to_string(), "backup".to_string()],
        }
    }
}

/// Music directory scanner
pub struct Scanner {
    config: ScannerConfig,
    detector: MediaTypeDetector,
}

impl Scanner {
    /// Create a new scanner with default configuration
    pub fn new(app_config: &AppConfig) -> Self {
        Self {
            config: ScannerConfig::default(),
            detector: MediaTypeDetector::from_config(app_config),
        }
    }

    /// Create a new scanner with custom configuration
    pub fn with_config(app_config: &AppConfig, config: ScannerConfig) -> Self {
        Self {
            config,
            detector: MediaTypeDetector::from_config(app_config),
        }
    }

    /// Scan a directory and return all discovered audio files
    pub async fn scan_directory<P: AsRef<Path>>(
        &self,
        base_path: P,
    ) -> Result<Vec<PathBuf>, ScannerError> {
        let base_path = base_path.as_ref();

        // Validate base path exists and is a directory
        let metadata = fs::metadata(base_path).await?;
        if !metadata.is_dir() {
            return Err(ScannerError::NotADirectory(base_path.display().to_string()));
        }

        let mut audio_files = Vec::new();

        for entry in self.iterate_files(base_path)? {
            let path = entry.path().to_path_buf();

            // Skip if excluded extension
            if let Some(ext) = path.extension() {
                let ext_str = ext.to_string_lossy().to_lowercase();
                if self.config.exclude_extensions.contains(&ext_str) {
                    continue;
                }
            }

            // Check if it's an audio file
            if self.is_audio_file(&path)? {
                audio_files.push(path);
            }
        }

        // Sort for consistent ordering
        audio_files.sort();

        Ok(audio_files)
    }

    /// Get an iterator over files in the directory, optionally resuming from a specific path
    pub fn scan_with_resume<P: AsRef<Path>>(
        &self,
        base_path: P,
        resume_from: Option<P>,
    ) -> Result<impl Iterator<Item = DirEntry>, ScannerError> {
        let base_path = base_path.as_ref();
        let mut entries: Vec<_> = self
            .iterate_files(base_path)?
            .filter(|e| self.is_audio_file(e.path()).unwrap_or(false))
            .collect();

        // Sort entries for consistent ordering
        entries.sort_by_key(|e| e.path().to_path_buf());

        // If resuming, skip files until we reach the resume point
        if let Some(resume_path) = resume_from {
            let resume_path = resume_path.as_ref();
            Ok(entries
                .into_iter()
                .skip_while(move |e| e.path() <= resume_path)
                .collect::<Vec<_>>()
                .into_iter())
        } else {
            Ok(entries.into_iter())
        }
    }

    /// Count total audio files in a directory (for progress tracking)
    pub async fn count_audio_files<P: AsRef<Path>>(
        &self,
        base_path: P,
    ) -> Result<usize, ScannerError> {
        let base_path = base_path.as_ref();

        let count = self
            .iterate_files(base_path)?
            .filter(|e| self.is_audio_file(e.path()).unwrap_or(false))
            .count();

        Ok(count)
    }

    /// Check if a file is an audio file
    pub fn is_audio_file<P: AsRef<Path>>(&self, path: P) -> Result<bool, ScannerError> {
        let path = path.as_ref();

        // Use include_extensions if specified
        if !self.config.include_extensions.is_empty() {
            if let Some(ext) = path.extension() {
                let ext_str = ext.to_string_lossy().to_lowercase();
                return Ok(self.config.include_extensions.contains(&ext_str));
            }
            return Ok(false);
        }

        // Otherwise use the media type detector
        self.detector
            .is_audio_file(path)
            .map_err(|e| ScannerError::MediaTypeError(e.to_string()))
    }

    /// Get supported audio file extensions
    pub fn supported_extensions(&self) -> Vec<&str> {
        if !self.config.include_extensions.is_empty() {
            self.config
                .include_extensions
                .iter()
                .map(|s| s.as_str())
                .collect()
        } else {
            self.detector
                .supported_audio_formats()
                .iter()
                .map(|s| s.as_str())
                .collect()
        }
    }

    /// Create file iterator with proper configuration
    fn iterate_files(
        &self,
        base_path: &Path,
    ) -> Result<impl Iterator<Item = DirEntry>, ScannerError> {
        let mut walker = WalkDir::new(base_path);

        if let Some(max_depth) = self.config.max_depth {
            walker = walker.max_depth(max_depth);
        }

        if !self.config.follow_symlinks {
            walker = walker.follow_links(false);
        }

        let entries = walker.into_iter().filter_map(|result| match result {
            Ok(entry) => {
                // Only include files (not directories)
                if entry.file_type().is_file() {
                    Some(entry)
                } else {
                    None
                }
            }
            Err(e) => {
                // Log error but continue scanning
                eprintln!("Warning: Failed to read directory entry: {}", e);
                None
            }
        });

        Ok(entries)
    }
}

/// Progress callback for scan operations
pub trait ScanProgress {
    /// Called when a file is processed
    fn on_file_processed(&mut self, path: &Path, total_processed: usize);

    /// Called when scan is complete
    fn on_scan_complete(&mut self, total_files: usize);

    /// Called when an error occurs processing a file
    fn on_file_error(&mut self, path: &Path, error: &ScannerError);
}

/// Simple console progress reporter
pub struct ConsoleScanProgress {
    last_reported: usize,
    report_interval: usize,
}

impl ConsoleScanProgress {
    pub fn new(report_interval: usize) -> Self {
        Self {
            last_reported: 0,
            report_interval,
        }
    }
}

impl ScanProgress for ConsoleScanProgress {
    fn on_file_processed(&mut self, path: &Path, total_processed: usize) {
        if total_processed - self.last_reported >= self.report_interval {
            println!(
                "Processed {} files (current: {})",
                total_processed,
                path.display()
            );
            self.last_reported = total_processed;
        }
    }

    fn on_scan_complete(&mut self, total_files: usize) {
        println!("Scan complete! Processed {} files total.", total_files);
    }

    fn on_file_error(&mut self, path: &Path, error: &ScannerError) {
        eprintln!("Error processing {}: {}", path.display(), error);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;
    use tokio::fs;

    #[tokio::test]
    async fn test_scanner_creation() {
        let config = AppConfig::default();
        let scanner = Scanner::new(&config);

        // Should have reasonable defaults
        assert_eq!(scanner.config.batch_size, 50);
        assert!(!scanner.config.follow_symlinks);
    }

    #[tokio::test]
    async fn test_scan_empty_directory() {
        let temp_dir = TempDir::new().unwrap();
        let config = AppConfig::default();
        let scanner = Scanner::new(&config);

        let files = scanner.scan_directory(temp_dir.path()).await.unwrap();
        assert!(files.is_empty());
    }

    #[tokio::test]
    async fn test_scan_nonexistent_directory() {
        let config = AppConfig::default();
        let scanner = Scanner::new(&config);

        let result = scanner.scan_directory("/nonexistent/path").await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_count_audio_files() {
        let temp_dir = TempDir::new().unwrap();
        let config = AppConfig::default();
        let scanner = Scanner::new(&config);

        // Create some test files
        fs::write(temp_dir.path().join("song1.mp3"), b"fake mp3")
            .await
            .unwrap();
        fs::write(temp_dir.path().join("song2.flac"), b"fake flac")
            .await
            .unwrap();
        fs::write(temp_dir.path().join("readme.txt"), b"not audio")
            .await
            .unwrap();

        let count = scanner.count_audio_files(temp_dir.path()).await.unwrap();
        assert_eq!(count, 2); // Should find mp3 and flac
    }

    #[tokio::test]
    async fn test_custom_extensions() {
        let temp_dir = TempDir::new().unwrap();
        let config = AppConfig::default();

        let scanner_config = ScannerConfig {
            include_extensions: vec!["mp3".to_string()],
            ..Default::default()
        };
        let scanner = Scanner::with_config(&config, scanner_config);

        // Create test files
        fs::write(temp_dir.path().join("song1.mp3"), b"fake mp3")
            .await
            .unwrap();
        fs::write(temp_dir.path().join("song2.flac"), b"fake flac")
            .await
            .unwrap();

        let files = scanner.scan_directory(temp_dir.path()).await.unwrap();
        assert_eq!(files.len(), 1); // Should only find mp3
        assert!(files[0]
            .file_name()
            .unwrap()
            .to_str()
            .unwrap()
            .ends_with(".mp3"));
    }

    #[tokio::test]
    async fn test_exclude_extensions() {
        let temp_dir = TempDir::new().unwrap();
        let config = AppConfig::default();

        let scanner_config = ScannerConfig {
            exclude_extensions: vec!["tmp".to_string()],
            ..Default::default()
        };
        let scanner = Scanner::with_config(&config, scanner_config);

        // Create test files
        fs::write(temp_dir.path().join("song1.mp3"), b"fake mp3")
            .await
            .unwrap();
        fs::write(temp_dir.path().join("temp.tmp"), b"temp file")
            .await
            .unwrap();

        let files = scanner.scan_directory(temp_dir.path()).await.unwrap();
        assert_eq!(files.len(), 1); // Should exclude .tmp file
        assert!(files[0]
            .file_name()
            .unwrap()
            .to_str()
            .unwrap()
            .ends_with(".mp3"));
    }

    #[test]
    fn test_progress_reporter() {
        let mut progress = ConsoleScanProgress::new(10);

        // Should not report until interval is reached
        progress.on_file_processed(Path::new("/test/file1.mp3"), 5);

        // Should report at interval
        progress.on_file_processed(Path::new("/test/file2.mp3"), 10);

        // Complete scan
        progress.on_scan_complete(15);
    }
}
