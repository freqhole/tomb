//! artist-level enrichment metadata blob.
//!
//! parallels `albums::metadata::AlbumMetadata`. lives in its own module so
//! `artistz.metadata` (added in migration 040) has a typed read/write surface
//! to feed the phase 15 artist enrichment pipeline.
//!
//! the structured snapshot types (`LastFmArtistSnapshot`,
//! `AudioDbArtistSnapshot`) already live alongside their album siblings in
//! [`crate::music::entities::albums::metadata`]; we re-use them rather than
//! redefining identical structs.

use serde::{Deserialize, Serialize};
use zod_gen_derive::ZodSchema;

use crate::music::entities::albums::metadata::{
    AudioDbArtistSnapshot, EnrichmentLogEntry, LastFmArtistSnapshot,
};

/// versioned blob persisted as json in `artistz.metadata`.
///
/// `None` fields skip serialization so legacy rows with empty metadata stay
/// compact and round-trip cleanly.
#[derive(Debug, Clone, Default, Serialize, Deserialize, ZodSchema, PartialEq)]
#[serde(default)]
pub struct ArtistMetadata {
    /// schema version (bump when fields move/rename).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<i32>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub lastfm: Option<ArtistLastFmMetadata>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub audiodb: Option<ArtistAudioDbMetadata>,

    /// chronological log of enrichment attempts (success + failure).
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub log: Vec<EnrichmentLogEntry>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, ZodSchema, PartialEq)]
#[serde(default)]
pub struct ArtistLastFmMetadata {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artist: Option<LastFmArtistSnapshot>,
    /// unix timestamp when this data was fetched.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fetched_at: Option<i64>,
    /// last.fm api error envelope, when the call failed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, ZodSchema, PartialEq)]
#[serde(default)]
pub struct ArtistAudioDbMetadata {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artist: Option<AudioDbArtistSnapshot>,
    /// unix timestamp when this data was fetched.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fetched_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl ArtistMetadata {
    /// parse a json string from the `artistz.metadata` column.
    /// returns `Default::default()` on null/empty/parse-error so callers
    /// can treat the blob as always present.
    pub fn parse(raw: Option<&str>) -> Self {
        match raw {
            None => Self::default(),
            Some(s) if s.trim().is_empty() => Self::default(),
            Some(s) => serde_json::from_str(s).unwrap_or_default(),
        }
    }

    /// serialize for write-back. `None` if the blob is empty (so callers can
    /// store NULL rather than `{}`).
    pub fn to_storage(&self) -> Option<String> {
        if self.is_empty() {
            return None;
        }
        serde_json::to_string(self).ok()
    }

    fn is_empty(&self) -> bool {
        self.version.is_none()
            && self.lastfm.is_none()
            && self.audiodb.is_none()
            && self.log.is_empty()
    }
}
