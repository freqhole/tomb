//! music-related job processors
//!
//! all music domain job processing logic:
//! - scan_processor: directory scanning for audio files
//! - file_processor: audio file import and metadata extraction
//! - fetch_processor: downloading from external sources (YouTube, etc.)
//! - upload_processors: user upload handling (WebP conversion, music import)
//! - models: music-specific job parameters and results

mod fetch_processor;
mod file_processor;
mod models;
mod rescan_processor;
mod scan_processor;
mod scanned_directories;
mod upload_processors;

// re-export public processor functions
pub use fetch_processor::process_fetch_media_job;
pub use file_processor::process_file_job;
pub use rescan_processor::process_rescan_directories_job;
pub use scan_processor::process_scan_directory_job;
pub use upload_processors::{process_convert_webp_job, process_import_music_job};

// re-export music job models
pub use models::{
    ProcessFileParams, ProcessFileResult, ProcessJobCreatedResponse, ScanDirectoryParams,
    ScanDirectoryResult, ScanJobCreatedResponse,
};

// re-export scanned directories
pub use scanned_directories::{
    get_deduplicated_directories, list_scanned_directories, record_scanned_directory,
    remove_scanned_directory, ScannedDirectory,
};
