//! music file scanner and discovery module
//! handles filesystem traversal, audio file detection, and import

mod directory;
mod filename_parser;
mod import;
mod models;
mod service;

// re-export public types from models
pub use models::{
    AudioFileInfo, ScanRequest, ScannerConfig, ScannerError, ScannerProgress, ScannerResult,
};

// re-export public service functions
pub use service::{import_audio_file, is_supported_audio_file, scan_directory};

// re-export directory scanning utilities
pub use directory::{is_audio_file, scan_directory_and_create_jobs};

// re-export import functions
pub use import::{extract_and_import, import_basic, ImportResult};

// re-export filename parser
pub use filename_parser::{parse_filename, ParsedFilename};
