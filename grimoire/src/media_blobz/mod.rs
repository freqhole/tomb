//! media blob domain module
//!
//! provides simple api for creating and querying media blobs
//! encapsulates all database logic internally

mod models;
mod service;

// re-export public types
pub use models::{CreateMediaBlobRequest, MediaBlob};
pub use service::{create_media_blob, get_media_blob, list_media_blobs};
