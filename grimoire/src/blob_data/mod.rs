//! blob_data service module
//!
//! provides binary data storage for media blobs (thumbnails, waveforms, etc.)
//! raw blob data is stored separately from metadata for performance

mod helpers;
mod purge;
mod service;

pub use helpers::{
    convert_to_webp, create_audio_thumbnail_blob, create_audio_waveform_blob,
    create_image_blob_from_webp_data,
};
pub use purge::{
    cleanup_orphaned_media_blobs, find_orphaned_media_blobs, OrphanedBlob, OrphanedBlobSummary,
};
pub use service::{get_blob_data, store_blob_data};
