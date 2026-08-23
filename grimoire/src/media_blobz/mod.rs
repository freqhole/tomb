//! media blob domain module
//!
//! provides simple api for creating and querying media blobs
//! encapsulates all database logic internally

mod access;
mod atlas;
mod cleanup;
pub mod ffmpeg_runner;
mod models;
mod reliquary_mirror;
mod service;

// re-export public types
pub use access::{
    build_blob_data_response, build_blob_path_response, build_blob_response,
    build_blob_thumbnail_response,
};
pub use atlas::{
    build_atlas_response, AtlasEntry, AtlasManifest, AtlasResponse, BuildAtlasRequest,
    MAX_IDS_PER_ATLAS, MAX_PAGE_DIM,
};
pub use cleanup::{
    can_delete_media_blob, delete_media_blob_if_unused, find_media_blob_references,
    MediaBlobReferences,
};
pub use models::{BlobMetadataResponse, BlobType, CreateMediaBlobRequest, MediaBlob};
// dual-write mirror into reliquary's blob store: crate-internal only, not
// part of this module's public api. only the functions needed by sibling
// modules (the music scanner, upload job processors, orphan cleanup) are
// re-exported here; service.rs calls the rest directly through the
// reliquary_mirror module path.
pub(crate) use reliquary_mirror::{
    mirror_hard_delete, mirror_insert_bytes, mirror_register_local_path, mirror_update_path,
};
pub use service::{
    count_blake3_backfill_status, count_blobs_needing_blake3, create_media_blob, delete_media_blob,
    find_present_blake3s, find_present_sha256s, get_media_blob, get_media_blob_by_blake3,
    get_media_blob_by_sha256, get_media_blob_stream_source, get_media_blob_with_data,
    list_blobs_needing_blake3, list_media_blobs, update_blob_blake3, update_blob_content,
    update_blob_local_path, BlobStreamSource,
};
