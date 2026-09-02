//! shared entity-type identifier for domain-agnostic polymorphic tables
//!
//! `entity_taxonz` and `playlist_itemz` (see `crate::video::crud`) store
//! `entity_type` as plain TEXT with no SQL CHECK constraint - sqlite can't
//! express a polymorphic foreign key across multiple tables. this enum is
//! the single place every domain's entity kind gets a variant, so handlers
//! validating an incoming `entity_type` string have one shared allowlist
//! instead of re-inventing it per route.

use std::fmt;

use serde::{Deserialize, Serialize};
use zod_gen::ZodSchema as ZodSchemaTrait;

use crate::error::GrimoireError;

/// every `entity_type`/`target_type` string a polymorphic table accepts
/// today, across every domain.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaggableEntity {
    Song,
    Album,
    Artist,
    Playlist,
    Taxon,
    Video,
    VideoSeries,
    VideoSeason,
}

impl TaggableEntity {
    pub fn as_str(&self) -> &'static str {
        match self {
            TaggableEntity::Song => "song",
            TaggableEntity::Album => "album",
            TaggableEntity::Artist => "artist",
            TaggableEntity::Playlist => "playlist",
            TaggableEntity::Taxon => "taxon",
            TaggableEntity::Video => "video",
            TaggableEntity::VideoSeries => "video_series",
            TaggableEntity::VideoSeason => "video_season",
        }
    }

    /// parse a wire-format `entity_type` string, rejecting anything not in
    /// the shared allowlist above.
    pub fn parse(s: &str) -> Result<Self, GrimoireError> {
        match s {
            "song" => Ok(TaggableEntity::Song),
            "album" => Ok(TaggableEntity::Album),
            "artist" => Ok(TaggableEntity::Artist),
            "playlist" => Ok(TaggableEntity::Playlist),
            "taxon" | "genre" => Ok(TaggableEntity::Taxon),
            "video" => Ok(TaggableEntity::Video),
            "video_series" => Ok(TaggableEntity::VideoSeries),
            "video_season" => Ok(TaggableEntity::VideoSeason),
            other => Err(GrimoireError::InvalidEntityType {
                entity_type: other.to_string(),
            }),
        }
    }
}

impl fmt::Display for TaggableEntity {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

impl ZodSchemaTrait for TaggableEntity {
    fn zod_schema() -> String {
        r#"z.union([z.literal("song"), z.literal("album"), z.literal("artist"), z.literal("playlist"), z.literal("taxon"), z.literal("video"), z.literal("video_series"), z.literal("video_season")])"#.to_string()
    }
}
