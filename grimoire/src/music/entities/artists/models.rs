//! artist domain models

use crate::music::crud::{EntityUrl, ImageMetadata};
use crate::JsonVec;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use zod_gen_derive::ZodSchema;

/// artist model (normalized table)
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, PartialEq, FromRow)]
pub struct Artist {
    pub id: String,
    pub name: String,
    pub bio: Option<String>,
    pub images: Option<JsonVec<ImageMetadata>>,
    pub urls: Option<JsonVec<EntityUrl>>,
    pub created_at: i64,         // unix timestamp UTC
    pub updated_at: i64,         // unix timestamp UTC
    pub deleted_at: Option<i64>, // unix timestamp UTC
    pub deleted_by: Option<String>,
    pub created_by: Option<String>,
    pub updated_by: Option<String>,
}

/// request for creating a new artist
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct CreateArtistRequest {
    pub name: String,
    pub created_by: Option<String>,
}

/// request for updating an artist
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct UpdateArtistRequest {
    pub artist_id: String,
    pub name: Option<String>,
    pub bio: Option<String>,
    /// entity URLs (replaces all existing URLs)
    pub entity_urls: Option<Vec<EntityUrl>>,
    pub updated_by: Option<String>,
}

/// request for the dedicated "update artist enrichment metadata" route
/// (phase 14.10). intentionally narrower than `UpdateArtistRequest`:
///
/// * never touches `name` (renames live in the artist detail view)
/// * `bio` is optional; pass `Some(...)` to overwrite, `None` to leave alone
/// * `metadata_patch` carries the typed `ArtistMetadata` JSON blob — fields
///   set to `Some(...)` replace the corresponding source bucket; fields left
///   as `None` are preserved
/// * `force = false` (the default) skips the write when the artist already
///   has both a non-empty `bio` and at least one image, returning
///   `skipped = true`. set `force = true` to override.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct UpdateArtistMetadataRequest {
    pub artist_id: String,
    /// optional bio replacement (typically picked from a lastfm/audiodb diff
    /// in the artist tab UI).
    #[serde(default)]
    pub bio: Option<String>,
    /// optional metadata blob patch. `None` means "leave metadata
    /// untouched"; `Some` merges per-source buckets.
    #[serde(default)]
    pub metadata_patch: Option<crate::music::entities::artists::ArtistMetadata>,
    /// skip-if-complete override (see struct docs).
    #[serde(default)]
    pub force: bool,
    /// authenticated caller; injected by the offal handler.
    #[serde(default)]
    pub updated_by: Option<String>,
}

/// response for `update_artist_metadata`. when `skipped == true` the
/// caller should treat this as a no-op (artist already had bio + image
/// and the caller did not pass `force = true`).
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct UpdateArtistMetadataResponse {
    pub artist_id: String,
    pub skipped: bool,
    /// human-readable reason when `skipped == true` (e.g.
    /// `"already has bio and image"`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}
