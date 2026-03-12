//! blob_data service module
//!
//! provides binary data storage for media blobs (thumbnails, waveforms, etc.)
//! raw blob data is stored separately from metadata for performance

mod helpers;
mod purge;
mod service;
mod thumbnails;

pub use helpers::{
    clear_scan_cache, collect_song_images, convert_to_webp, create_audio_thumbnail_blob,
    create_audio_waveform_blob, create_image_blob_from_webp_data, create_media_blob_from_file,
    CollectedImages,
};
pub use purge::{
    cleanup_orphaned_media_blobs, find_orphaned_media_blobs, OrphanedBlob, OrphanedBlobSummary,
};
pub use service::{blob_data_exists, delete_blob_data, get_blob_data, store_blob_data};
pub use thumbnails::{
    backfill_thumbnails, count_blobs_needing_thumbnails, find_existing_thumbnail,
    generate_sized_thumbnails, get_or_generate_thumbnail, get_thumbnail_sizes,
    is_on_demand_enabled, is_valid_size, BackfillResult, GeneratedThumbnail, ResizeMode,
    DEFAULT_THUMBNAIL_SIZES,
};
