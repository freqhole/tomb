//! fetch music module - external media fetching
//!
//! provides functionality for fetching music from external sources
//! (youtube, soundcloud, etc.) using configurable external commands.
//!
//! workflow:
//! 1. extract metadata without downloading (precheck)
//! 2. check for existing content (deduplication)
//! 3. download media files
//! 4. create ProcessFile jobs for import

pub mod models;
mod service;

pub use models::{ContentMetadata, DownloadedFile, FetchMediaParams, FetchMediaResult};
pub use service::{check_existing_content, download_media, extract_metadata, fetch_media};
