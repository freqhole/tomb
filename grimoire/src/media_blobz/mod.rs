//! media blob domain module
//!
//! provides simple api for creating and querying media blobs
//! encapsulates all database logic internally

mod cleanup;
mod models;
mod service;

// re-export public types
pub use cleanup::{
    can_delete_media_blob, delete_media_blob_if_unused, find_media_blob_references,
    MediaBlobReferences,
};
pub use models::{CreateMediaBlobRequest, MediaBlob};
pub use service::{
    create_media_blob, delete_media_blob, get_media_blob, get_media_blob_with_data,
    list_media_blobs,
};
