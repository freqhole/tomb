//! music file scanner and discovery module
//! handles filesystem traversal and audio file detection

mod models;
mod service;

// re-export public types
pub use models::{
    AudioFileInfo, ScanRequest, ScannerConfig, ScannerError, ScannerProgress, ScannerResult,
};
pub use service::{
    extract_metadata, get_scan_progress, scan_directory, scan_file, validate_audio_file,
};

// placeholder for future scanner functionality
// TODO: migrate from legacylib/src/music/scanner.rs
// - directory traversal with configurable depth
// - audio file type detection
// - metadata extraction (artist, album, title, etc.)
// - batch processing for large directories
// - progress reporting for long scans
// - file validation and error handling
