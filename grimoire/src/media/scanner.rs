//! Unified media scanner for all media types
//!
//! This module provides a unified scanning interface that can handle multiple
//! media domains (music, photos, videos) through a common interface while
//! delegating to domain-specific scanners for actual processing.

use crate::media::traits::{ScanConfig, ScannedFile};
use async_trait::async_trait;
use std::collections::HashMap;
use std::path::Path;
use time::OffsetDateTime;
use tokio::fs;
use walkdir::WalkDir;

/// Unified scanner that can handle multiple media types
pub struct UnifiedMediaScanner {
    /// Domain-specific scanners
    scanners: HashMap<String, Box<dyn DomainScanner>>,
    /// Configuration for scanning
    config: ScanConfig,
}

/// Trait for domain-specific scanners
#[async_trait]
pub trait DomainScanner: Send + Sync {
    /// Get the media type this scanner handles
    fn media_type(&self) -> &'static str;

    /// Check if a file should be handled by this scanner
    fn should_handle(&self, file_path: &Path) -> bool;

    /// Get the priority of this scanner (higher = preferred)
    fn priority(&self) -> i32;

    /// Process a file and return scan result
    async fn process_file(&self, file: &ScannedFile) -> Result<ScanResult, ScanError>;
}

/// Result of scanning a file
#[derive(Debug, Clone)]
pub struct ScanResult {
    /// The file that was scanned
    pub file: ScannedFile,
    /// Media type detected
    pub media_type: String,
    /// Whether the file was successfully processed
    pub success: bool,
    /// Error message if processing failed
    pub error: Option<String>,
    /// Additional metadata extracted
    pub metadata: serde_json::Value,
}

/// Error type for scanning operations
#[derive(Debug, thiserror::Error)]
pub enum ScanError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("File not supported: {0}")]
    UnsupportedFile(String),
    #[error("File too large: {size} bytes (max: {max_size})")]
    FileTooLarge { size: u64, max_size: u64 },
    #[error("Metadata extraction failed: {0}")]
    MetadataExtraction(String),
    #[error("Domain scanner error: {0}")]
    DomainScanner(String),
}

/// Statistics for a scan session
#[derive(Debug, Clone, Default)]
pub struct ScanStats {
    /// Total files discovered
    pub total_files: u64,
    /// Files processed successfully
    pub processed_files: u64,
    /// Files skipped
    pub skipped_files: u64,
    /// Files that failed processing
    pub failed_files: u64,
    /// Files by media type
    pub files_by_type: HashMap<String, u64>,
    /// Total size of processed files
    pub total_size: u64,
    /// Time taken for scan
    pub duration: std::time::Duration,
}

impl UnifiedMediaScanner {
    /// Create a new unified scanner
    pub fn new(config: ScanConfig) -> Self {
        Self {
            scanners: HashMap::new(),
            config,
        }
    }

    /// Register a domain scanner
    pub fn register_scanner<T: DomainScanner + 'static>(&mut self, scanner: T) {
        let media_type = scanner.media_type().to_string();
        self.scanners.insert(media_type, Box::new(scanner));
    }

    /// Scan a directory for all media types
    pub async fn scan_directory(&self, directory: &Path) -> Result<Vec<ScanResult>, ScanError> {
        let mut results = Vec::new();
        let mut stats = ScanStats::default();
        let start_time = std::time::Instant::now();

        // Discover all files
        let files = self.discover_files(directory).await?;
        stats.total_files = files.len() as u64;

        // Process files in batches
        for batch in files.chunks(self.config.batch_size) {
            let batch_results = self.process_batch(batch).await?;

            for result in batch_results {
                // Update stats
                if result.success {
                    stats.processed_files += 1;
                    *stats
                        .files_by_type
                        .entry(result.media_type.clone())
                        .or_insert(0) += 1;
                    stats.total_size += result.file.size;
                } else {
                    stats.failed_files += 1;
                }

                results.push(result);
            }
        }

        stats.duration = start_time.elapsed();
        tracing::info!("Scan completed: {:?}", stats);

        Ok(results)
    }

    /// Discover all files in a directory
    async fn discover_files(&self, directory: &Path) -> Result<Vec<ScannedFile>, ScanError> {
        let mut files = Vec::new();
        let walker = WalkDir::new(directory)
            .follow_links(self.config.follow_symlinks)
            .max_depth(self.config.max_depth.unwrap_or(usize::MAX));

        for entry in walker {
            let entry = entry.map_err(|e| ScanError::Io(e.into()))?;
            let path = entry.path();

            // Skip directories
            if path.is_dir() {
                continue;
            }

            // Skip if in excluded directories
            if self.should_skip_directory(path) {
                continue;
            }

            // Check file size
            let metadata = fs::metadata(path).await?;
            let size = metadata.len();

            if let Some(max_size) = self.config.max_file_size {
                if size > max_size {
                    tracing::warn!(
                        "Skipping file (too large): {} ({} bytes)",
                        path.display(),
                        size
                    );
                    continue;
                }
            }

            // Check if any scanner can handle this file
            if !self.can_handle_file(path) {
                continue;
            }

            let modified = OffsetDateTime::from(metadata.modified()?);
            let extension = path
                .extension()
                .and_then(|ext| ext.to_str())
                .unwrap_or("")
                .to_lowercase();

            // Detect MIME type
            let mime_type = self.detect_mime_type(path).await;

            files.push(ScannedFile {
                path: path.to_path_buf(),
                size,
                modified,
                extension,
                mime_type,
            });
        }

        Ok(files)
    }

    /// Process a batch of files
    async fn process_batch(&self, files: &[ScannedFile]) -> Result<Vec<ScanResult>, ScanError> {
        let mut results = Vec::new();

        for file in files {
            let result = self.process_file(file).await;
            results.push(result);
        }

        Ok(results)
    }

    /// Process a single file
    async fn process_file(&self, file: &ScannedFile) -> ScanResult {
        // Find the best scanner for this file
        let scanner = match self.find_best_scanner(&file.path) {
            Some(scanner) => scanner,
            None => {
                return ScanResult {
                    file: file.clone(),
                    media_type: "unknown".to_string(),
                    success: false,
                    error: Some("No scanner available for this file type".to_string()),
                    metadata: serde_json::Value::Null,
                };
            }
        };

        // Process the file
        match scanner.process_file(file).await {
            Ok(result) => result,
            Err(e) => ScanResult {
                file: file.clone(),
                media_type: scanner.media_type().to_string(),
                success: false,
                error: Some(e.to_string()),
                metadata: serde_json::Value::Null,
            },
        }
    }

    /// Find the best scanner for a file
    fn find_best_scanner(&self, file_path: &Path) -> Option<&Box<dyn DomainScanner>> {
        let mut best_scanner = None;
        let mut best_priority = i32::MIN;

        for scanner in self.scanners.values() {
            if scanner.should_handle(file_path) {
                let priority = scanner.priority();
                if priority > best_priority {
                    best_priority = priority;
                    best_scanner = Some(scanner);
                }
            }
        }

        best_scanner
    }

    /// Check if any scanner can handle a file
    fn can_handle_file(&self, file_path: &Path) -> bool {
        self.scanners
            .values()
            .any(|scanner| scanner.should_handle(file_path))
    }

    /// Check if a directory should be skipped
    fn should_skip_directory(&self, file_path: &Path) -> bool {
        if let Some(parent) = file_path.parent() {
            let parent_name = parent
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("");

            return self
                .config
                .skip_directories
                .contains(&parent_name.to_string());
        }
        false
    }

    /// Detect MIME type of a file
    async fn detect_mime_type(&self, file_path: &Path) -> Option<String> {
        // Try to detect based on file extension first
        if let Some(ext) = file_path.extension().and_then(|ext| ext.to_str()) {
            match ext.to_lowercase().as_str() {
                // Audio formats
                "mp3" => return Some("audio/mpeg".to_string()),
                "flac" => return Some("audio/flac".to_string()),
                "wav" => return Some("audio/wav".to_string()),
                "ogg" => return Some("audio/ogg".to_string()),
                "m4a" | "aac" => return Some("audio/mp4".to_string()),

                // Image formats
                "jpg" | "jpeg" => return Some("image/jpeg".to_string()),
                "png" => return Some("image/png".to_string()),
                "gif" => return Some("image/gif".to_string()),
                "webp" => return Some("image/webp".to_string()),
                "heic" => return Some("image/heic".to_string()),
                "avif" => return Some("image/avif".to_string()),

                // Video formats
                "mp4" => return Some("video/mp4".to_string()),
                "mkv" => return Some("video/x-matroska".to_string()),
                "avi" => return Some("video/x-msvideo".to_string()),
                "mov" => return Some("video/quicktime".to_string()),
                "webm" => return Some("video/webm".to_string()),

                _ => {}
            }
        }

        // Could add more sophisticated MIME detection here
        None
    }

    /// Get supported file extensions for all registered scanners
    pub fn get_supported_extensions(&self) -> Vec<String> {
        let mut extensions = Vec::new();

        for scanner in self.scanners.values() {
            // This would need to be implemented by each scanner
            // For now, we'll provide common extensions
            match scanner.media_type() {
                "music" => {
                    extensions.extend_from_slice(&[
                        "mp3", "flac", "wav", "ogg", "m4a", "aac", "wma", "opus",
                    ]);
                }
                "photos" => {
                    extensions.extend_from_slice(&[
                        "jpg", "jpeg", "png", "gif", "webp", "heic", "avif", "bmp", "tiff",
                    ]);
                }
                "videos" => {
                    extensions.extend_from_slice(&[
                        "mp4", "mkv", "avi", "mov", "webm", "flv", "wmv", "m4v",
                    ]);
                }
                _ => {}
            }
        }

        extensions.into_iter().map(|s| s.to_string()).collect()
    }
}

/// Builder for creating a unified scanner with multiple domain scanners
pub struct UnifiedScannerBuilder {
    config: ScanConfig,
    scanners: Vec<Box<dyn DomainScanner>>,
}

impl UnifiedScannerBuilder {
    /// Create a new builder
    pub fn new() -> Self {
        Self {
            config: ScanConfig::default(),
            scanners: Vec::new(),
        }
    }

    /// Set the scan configuration
    pub fn with_config(mut self, config: ScanConfig) -> Self {
        self.config = config;
        self
    }

    /// Add a domain scanner
    pub fn add_scanner<T: DomainScanner + 'static>(mut self, scanner: T) -> Self {
        self.scanners.push(Box::new(scanner));
        self
    }

    /// Build the unified scanner
    pub fn build(self) -> UnifiedMediaScanner {
        let mut scanner = UnifiedMediaScanner::new(self.config);

        for domain_scanner in self.scanners {
            let media_type = domain_scanner.media_type().to_string();
            scanner.scanners.insert(media_type, domain_scanner);
        }

        scanner
    }
}

impl Default for UnifiedScannerBuilder {
    fn default() -> Self {
        Self::new()
    }
}

/// Progress callback for scanning operations
pub trait ScanProgress: Send + Sync {
    /// Called when a file is being processed
    fn on_file_processing(&self, file: &ScannedFile, current: usize, total: usize);

    /// Called when a file has been processed
    fn on_file_processed(&self, file: &ScannedFile, result: &ScanResult);

    /// Called when scanning is complete
    fn on_scan_complete(&self, stats: &ScanStats);
}

/// Console-based progress reporter
pub struct ConsoleScanProgress {
    report_interval: usize,
    last_reported: std::sync::atomic::AtomicUsize,
}

impl ConsoleScanProgress {
    /// Create a new console progress reporter
    pub fn new(report_interval: usize) -> Self {
        Self {
            report_interval,
            last_reported: std::sync::atomic::AtomicUsize::new(0),
        }
    }
}

impl ScanProgress for ConsoleScanProgress {
    fn on_file_processing(&self, file: &ScannedFile, current: usize, total: usize) {
        let last = self
            .last_reported
            .load(std::sync::atomic::Ordering::Relaxed);
        if current.saturating_sub(last) >= self.report_interval {
            println!(
                "Processing file {}/{}: {}",
                current,
                total,
                file.path.display()
            );
            self.last_reported
                .store(current, std::sync::atomic::Ordering::Relaxed);
        }
    }

    fn on_file_processed(&self, _file: &ScannedFile, _result: &ScanResult) {
        // Could add more detailed logging here
    }

    fn on_scan_complete(&self, stats: &ScanStats) {
        println!("Scan complete!");
        println!("  Total files: {}", stats.total_files);
        println!("  Processed: {}", stats.processed_files);
        println!("  Skipped: {}", stats.skipped_files);
        println!("  Failed: {}", stats.failed_files);
        println!("  Duration: {:?}", stats.duration);
        println!("  Total size: {} bytes", stats.total_size);

        if !stats.files_by_type.is_empty() {
            println!("  Files by type:");
            for (media_type, count) in &stats.files_by_type {
                println!("    {}: {}", media_type, count);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    struct TestScanner {
        media_type: String,
        extensions: Vec<String>,
    }

    impl TestScanner {
        fn new(media_type: &str, extensions: &[&str]) -> Self {
            Self {
                media_type: media_type.to_string(),
                extensions: extensions.iter().map(|s| s.to_string()).collect(),
            }
        }
    }

    #[async_trait]
    impl DomainScanner for TestScanner {
        fn media_type(&self) -> &'static str {
            // This is a limitation of the trait - we need to return a static str
            // In practice, each domain scanner would return its own constant
            "test"
        }

        fn should_handle(&self, file_path: &Path) -> bool {
            if let Some(ext) = file_path.extension().and_then(|ext| ext.to_str()) {
                self.extensions.contains(&ext.to_lowercase())
            } else {
                false
            }
        }

        fn priority(&self) -> i32 {
            0
        }

        async fn process_file(&self, file: &ScannedFile) -> Result<ScanResult, ScanError> {
            Ok(ScanResult {
                file: file.clone(),
                media_type: self.media_type.clone(),
                success: true,
                error: None,
                metadata: serde_json::json!({"test": true}),
            })
        }
    }

    #[tokio::test]
    async fn test_unified_scanner_builder() {
        let scanner = UnifiedScannerBuilder::new()
            .add_scanner(TestScanner::new("music", &["mp3", "flac"]))
            .add_scanner(TestScanner::new("photos", &["jpg", "png"]))
            .build();

        assert_eq!(scanner.scanners.len(), 2);
        assert!(scanner.scanners.contains_key("music"));
        assert!(scanner.scanners.contains_key("photos"));
    }

    #[test]
    fn test_scan_config_default() {
        let config = ScanConfig::default();
        assert_eq!(config.max_depth, Some(10));
        assert_eq!(config.max_file_size, Some(500 * 1024 * 1024));
        assert_eq!(config.batch_size, 100);
        assert!(!config.follow_symlinks);
    }
}
