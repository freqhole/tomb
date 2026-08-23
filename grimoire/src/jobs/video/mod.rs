//! video-specific job processors
//!
//! - transcode_processor: `TranscodeVideo` - produces rendition MediaBlob rows
//! - upload_processor: `ImportVideo` - upload-specific entry point, mirrors
//!   music's `process_import_music_job`

mod transcode_processor;
mod upload_processor;

pub use transcode_processor::process_transcode_video_job;
pub use upload_processor::process_import_video_job;
