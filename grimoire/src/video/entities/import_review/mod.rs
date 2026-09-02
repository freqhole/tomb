//! video import review entity - tracks review state for video blobs
//! arriving via import jobs (mirrors `crate::music::entities::import_review`,
//! grouped by detected series instead of album).

pub mod models;
pub mod repository;

pub use models::*;
