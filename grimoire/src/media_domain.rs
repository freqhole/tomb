//! media domain: which media pipeline a job/file belongs to.
//!
//! deliberately separate from `api_registry::Domain` (route-metadata grouping
//! for codegen) and the polymorphic `entity_type`/`target_type` strings used
//! by `user_favoritez`/`entity_taxonz`/`playlist_itemz`. this is a small
//! runtime enum that job processors branch on.

use crate::config::GrimoireConfig;
use serde::{Deserialize, Serialize};
use zod_gen::ZodSchema as ZodSchemaTrait;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MediaDomain {
    Music,
    Video,
}

// `zod_gen_derive`'s `#[derive(ZodSchema)]` doesn't respect `#[serde(rename_all
// = "snake_case")]` on enums - it emits the raw (PascalCase) variant names,
// which would generate `z.literal('Music')`/`z.literal('Video')` while serde
// actually serializes/deserializes lowercase `"music"`/`"video"` on the wire.
// hand-roll the impl instead, matching the same workaround already used by
// `SearchField`/`SuggestionType` in `search/models.rs`.
impl ZodSchemaTrait for MediaDomain {
    fn zod_schema() -> String {
        r#"z.union([z.literal("music"), z.literal("video")])"#.to_string()
    }
}

impl MediaDomain {
    pub fn as_str(&self) -> &'static str {
        match self {
            MediaDomain::Music => "music",
            MediaDomain::Video => "video",
        }
    }
}

impl std::fmt::Display for MediaDomain {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

impl std::str::FromStr for MediaDomain {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "music" => Ok(MediaDomain::Music),
            "video" => Ok(MediaDomain::Video),
            _ => Err(format!("invalid media domain: {}", s)),
        }
    }
}

/// serde default helper: existing callers that don't know about
/// `MediaDomain` yet (fetch requests sent before this field existed) fall
/// back to music, preserving today's behavior unchanged.
pub fn default_music_domain() -> MediaDomain {
    MediaDomain::Music
}

/// detect a file's media domain from its extension, checking
/// `supported_audio_formats` first, then `supported_video_formats`.
/// returns `None` for extensions that match neither list (junk files
/// found alongside real media in a `domain: None` directory scan).
pub fn detect_media_domain_from_extension(
    file_path: &str,
    config: &GrimoireConfig,
) -> Option<MediaDomain> {
    let ext = std::path::Path::new(file_path)
        .extension()
        .and_then(|e| e.to_str())?
        .to_lowercase();

    if config
        .media
        .supported_audio_formats
        .iter()
        .any(|e| e.eq_ignore_ascii_case(&ext))
    {
        Some(MediaDomain::Music)
    } else if config
        .media
        .supported_video_formats
        .iter()
        .any(|e| e.eq_ignore_ascii_case(&ext))
    {
        Some(MediaDomain::Video)
    } else {
        None
    }
}
