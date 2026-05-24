//! media blob domain module
//!
//! provides simple api for creating and querying media blobs
//! encapsulates all database logic internally

mod access;
mod atlas;
mod cleanup;
mod models;
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
pub use service::{
    count_blobs_needing_blake3, create_media_blob, delete_media_blob, find_present_blake3s,
    find_present_sha256s, get_media_blob, get_media_blob_by_blake3, get_media_blob_by_sha256,
    get_media_blob_with_data, list_blobs_needing_blake3, list_media_blobs, update_blob_blake3,
    update_blob_local_path,
};
