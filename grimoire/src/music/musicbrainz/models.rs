//! MusicBrainz data models
//!
//! Provides structures for MusicBrainz API responses including recordings,
//! releases, artists, and cover art metadata.

use serde::{Deserialize, Deserializer, Serialize};
use uuid::Uuid;

/// MusicBrainz recording (track/song)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Recording {
    /// MusicBrainz recording id
    pub id: Uuid,

    /// Recording title
    pub title: String,

    /// Track length in milliseconds
    pub length: Option<u32>,

    /// Artist credit information
    #[serde(rename = "artist-credit")]
    pub artist_credit: Option<Vec<ArtistCredit>>,

    /// Releases this recording appears on
    pub releases: Option<Vec<Release>>,

    /// Tags associated with this recording
    pub tags: Option<Vec<Tag>>,

    /// MusicBrainz score (relevance in search results)
    pub score: Option<u32>,

    /// Disambiguation comment
    pub disambiguation: Option<String>,

    /// Aliases for this recording
    pub aliases: Option<Vec<Alias>>,
}

/// MusicBrainz release (album/single)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Release {
    /// MusicBrainz release id
    pub id: Uuid,

    /// Release title
    pub title: String,

    /// Release date (can be partial)
    pub date: Option<String>,

    /// Country of release
    pub country: Option<String>,

    /// Artist credit information
    #[serde(rename = "artist-credit")]
    pub artist_credit: Option<Vec<ArtistCredit>>,

    /// Media (discs/tracks) in this release
    pub media: Option<Vec<Medium>>,

    /// Cover art archive information
    #[serde(rename = "cover-art-archive")]
    pub cover_art_archive: Option<CoverArtArchiveInfo>,

    /// MusicBrainz score (relevance in search results)
    pub score: Option<u32>,

    /// Release status (official, promotion, bootleg, etc.)
    pub status: Option<String>,

    /// Packaging type
    pub packaging: Option<String>,

    /// Text representation of the release
    #[serde(rename = "text-representation")]
    pub text_representation: Option<TextRepresentation>,

    /// Release group this belongs to
    #[serde(rename = "release-group")]
    pub release_group: Option<ReleaseGroup>,
}

/// MusicBrainz release group
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReleaseGroup {
    /// MusicBrainz release group id
    pub id: Uuid,

    /// Release group title
    pub title: String,

    /// Primary type (album, single, ep, etc.)
    #[serde(rename = "primary-type")]
    pub primary_type: Option<String>,

    /// Secondary types
    #[serde(rename = "secondary-types")]
    pub secondary_types: Option<Vec<String>>,

    /// First release date
    #[serde(rename = "first-release-date")]
    pub first_release_date: Option<String>,

    /// Artist credit information
    #[serde(rename = "artist-credit")]
    pub artist_credit: Option<Vec<ArtistCredit>>,

    /// MusicBrainz score (relevance in search results)
    pub score: Option<u32>,
}

/// Artist credit entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArtistCredit {
    /// Artist information
    pub artist: Option<Artist>,

    /// Name as credited on this release/recording
    pub name: String,

    /// Join phrase (e.g., " feat. ", " & ")
    pub joinphrase: Option<String>,
}

/// MusicBrainz artist
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Artist {
    /// MusicBrainz artist id
    pub id: Uuid,

    /// Artist name
    pub name: String,

    /// Sort name for alphabetical ordering
    #[serde(rename = "sort-name")]
    pub sort_name: String,

    /// Disambiguation comment
    pub disambiguation: Option<String>,

    /// Artist type (person, group, etc.)
    #[serde(rename = "type")]
    pub artist_type: Option<String>,
}

/// Medium (disc/cassette/etc.)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Medium {
    /// Position of this medium in the release
    pub position: Option<u32>,

    /// Title of this medium
    pub title: Option<String>,

    /// Format (cd, vinyl, digital, etc.)
    pub format: Option<String>,

    /// Track list
    pub tracks: Option<Vec<Track>>,

    /// Number of tracks
    #[serde(rename = "track-count")]
    pub track_count: Option<u32>,
}

/// Track on a medium
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Track {
    /// Track id
    pub id: Option<Uuid>,

    /// Position on the medium
    pub position: Option<u32>,

    /// Track title
    pub title: String,

    /// Track length in milliseconds
    pub length: Option<u32>,

    /// Recording this track represents
    pub recording: Option<Recording>,
}

/// Tag information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tag {
    /// Tag name
    pub name: String,

    /// Vote count for this tag
    pub count: Option<u32>,
}

/// Alias information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Alias {
    /// Alias name
    pub name: String,

    /// Sort name for this alias
    #[serde(rename = "sort-name")]
    pub sort_name: Option<String>,

    /// Alias type
    #[serde(rename = "type")]
    pub alias_type: Option<String>,

    /// Whether this is the primary alias
    pub primary: Option<bool>,
}

/// Cover art archive information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CoverArtArchiveInfo {
    /// Whether cover art exists
    pub artwork: bool,

    /// Number of cover art images
    pub count: u32,

    /// Whether front cover exists
    pub front: bool,

    /// Whether back cover exists
    pub back: bool,
}

/// Text representation info
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TextRepresentation {
    /// Language code
    pub language: Option<String>,

    /// Script code
    pub script: Option<String>,
}

/// Cover art archive response wrapper
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CoverArtResponse {
    /// Array of cover art images
    pub images: Vec<CoverArt>,

    /// Release url
    pub release: String,
}

/// Cover art image from cover art archive
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CoverArt {
    /// Unique image id (can be string or number from MusicBrainz)
    #[serde(deserialize_with = "deserialize_id_as_string")]
    pub id: String,

    /// Image url (full size)
    #[serde(rename = "image")]
    pub image_url: String,

    /// Thumbnail urls
    pub thumbnails: Option<CoverArtThumbnails>,

    /// Image types (front, back, booklet, etc.)
    pub types: Vec<String>,

    /// Whether this image is approved
    pub approved: bool,

    /// Whether this is the front cover
    pub front: bool,

    /// Whether this is the back cover
    pub back: bool,

    /// Edit id that added this image
    pub edit: Option<u32>,

    /// Comment about this image
    pub comment: Option<String>,
}

/// Cover art thumbnail urls
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CoverArtThumbnails {
    /// Small thumbnail (250px)
    pub small: Option<String>,

    /// Large thumbnail (500px)
    pub large: Option<String>,

    /// 250px thumbnail (alternative key)
    #[serde(rename = "250")]
    pub thumb_250: Option<String>,

    /// 500px thumbnail (alternative key)
    #[serde(rename = "500")]
    pub thumb_500: Option<String>,

    /// 1200px thumbnail
    #[serde(rename = "1200")]
    pub thumb_1200: Option<String>,
}

impl CoverArt {
    /// Get best thumbnail url (preferring smaller sizes for preview)
    pub fn thumbnail_url(&self) -> String {
        if let Some(ref thumbnails) = self.thumbnails {
            if let Some(ref small) = thumbnails.small {
                return small.clone();
            }
            if let Some(ref thumb_250) = thumbnails.thumb_250 {
                return thumb_250.clone();
            }
            if let Some(ref large) = thumbnails.large {
                return large.clone();
            }
            if let Some(ref thumb_500) = thumbnails.thumb_500 {
                return thumb_500.clone();
            }
        }
        // Fallback to main image url
        self.image_url.clone()
    }

    /// Get largest available thumbnail url (for high quality preview)
    pub fn large_thumbnail_url(&self) -> String {
        if let Some(ref thumbnails) = self.thumbnails {
            if let Some(ref thumb_1200) = thumbnails.thumb_1200 {
                return thumb_1200.clone();
            }
            if let Some(ref thumb_500) = thumbnails.thumb_500 {
                return thumb_500.clone();
            }
            if let Some(ref large) = thumbnails.large {
                return large.clone();
            }
            if let Some(ref thumb_250) = thumbnails.thumb_250 {
                return thumb_250.clone();
            }
            if let Some(ref small) = thumbnails.small {
                return small.clone();
            }
        }
        // Fallback to main image url
        self.image_url.clone()
    }

    /// Check if this is a front cover
    pub fn is_front(&self) -> bool {
        self.front || self.types.iter().any(|t| t == "Front")
    }

    /// Check if this is a back cover
    pub fn is_back(&self) -> bool {
        self.back || self.types.iter().any(|t| t == "Back")
    }
}

/// Search result wrapper
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult<T> {
    /// Search results
    #[serde(alias = "recordings", alias = "releases", alias = "release-groups")]
    pub results: Vec<T>,

    /// Total number of results available
    pub count: u32,

    /// Offset of these results
    pub offset: u32,
}

/// MusicBrainz match with confidence scoring
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MusicBrainzMatch {
    /// Matched recording
    pub recording: Recording,

    /// Matched release (if available)
    pub release: Option<Release>,

    /// Confidence score (0-100)
    pub confidence_score: f32,

    /// Reasons for this match
    pub match_reasons: Vec<String>,
}

impl MusicBrainzMatch {
    /// Create a new match with basic scoring
    pub fn new(recording: Recording, release: Option<Release>) -> Self {
        Self {
            recording,
            release,
            confidence_score: 0.0,
            match_reasons: Vec::new(),
        }
    }

    /// Add a match reason and adjust confidence
    pub fn add_reason(&mut self, reason: String, confidence_boost: f32) {
        self.match_reasons.push(reason);
        self.confidence_score = (self.confidence_score + confidence_boost).min(100.0);
    }
}

impl Recording {
    /// Get primary artist name
    pub fn primary_artist_name(&self) -> Option<String> {
        self.artist_credit
            .as_ref()?
            .first()
            .map(|credit| credit.name.clone())
    }

    /// Get all artist names joined
    pub fn all_artist_names(&self) -> String {
        self.artist_credit
            .as_ref()
            .map(|credits| {
                credits
                    .iter()
                    .map(|credit| {
                        format!(
                            "{}{}",
                            credit.name,
                            credit.joinphrase.as_deref().unwrap_or("")
                        )
                    })
                    .collect::<String>()
                    .trim()
                    .to_string()
            })
            .unwrap_or_default()
    }

    /// Get duration in seconds
    pub fn duration_seconds(&self) -> Option<u32> {
        self.length.map(|ms| ms / 1000)
    }
}

impl Release {
    /// Get primary artist name
    pub fn primary_artist_name(&self) -> Option<String> {
        self.artist_credit
            .as_ref()?
            .first()
            .map(|credit| credit.name.clone())
    }

    /// Get all artist names joined
    pub fn all_artist_names(&self) -> String {
        self.artist_credit
            .as_ref()
            .map(|credits| {
                credits
                    .iter()
                    .map(|credit| {
                        format!(
                            "{}{}",
                            credit.name,
                            credit.joinphrase.as_deref().unwrap_or("")
                        )
                    })
                    .collect::<String>()
                    .trim()
                    .to_string()
            })
            .unwrap_or_default()
    }

    /// Get total track count across all media
    pub fn total_track_count(&self) -> u32 {
        self.media
            .as_ref()
            .map(|media| media.iter().filter_map(|m| m.track_count).sum())
            .unwrap_or(0)
    }

    /// Check if cover art is available
    pub fn has_cover_art(&self) -> bool {
        self.cover_art_archive
            .as_ref()
            .map(|caa| caa.artwork)
            .unwrap_or(false)
    }

    /// Get cover art count
    pub fn cover_art_count(&self) -> u32 {
        self.cover_art_archive
            .as_ref()
            .map(|caa| caa.count)
            .unwrap_or(0)
    }

    /// Check if front cover is available
    pub fn has_front_cover(&self) -> bool {
        self.cover_art_archive
            .as_ref()
            .map(|caa| caa.front)
            .unwrap_or(false)
    }
}

/// Custom deserializer to handle ID fields that can be either string or integer
fn deserialize_id_as_string<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: Deserializer<'de>,
{
    use serde_json::Value;
    let value = Value::deserialize(deserializer)?;
    match value {
        Value::String(s) => Ok(s),
        Value::Number(n) => Ok(n.to_string()),
        _ => Err(serde::de::Error::custom("expected string or number")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cover_art_thumbnail_urls() {
        let cover_art = CoverArt {
            id: "123".to_string(),
            image_url: "http://example.com/full.jpg".to_string(),
            thumbnails: Some(CoverArtThumbnails {
                small: Some("http://example.com/small.jpg".to_string()),
                large: Some("http://example.com/large.jpg".to_string()),
                thumb_250: None,
                thumb_500: None,
                thumb_1200: Some("http://example.com/1200.jpg".to_string()),
            }),
            types: vec!["Front".to_string()],
            approved: true,
            front: true,
            back: false,
            edit: None,
            comment: None,
        };

        assert_eq!(cover_art.thumbnail_url(), "http://example.com/small.jpg");
        assert_eq!(
            cover_art.large_thumbnail_url(),
            "http://example.com/1200.jpg"
        );
        assert!(cover_art.is_front());
        assert!(!cover_art.is_back());
    }

    #[test]
    fn test_cover_art_fallback() {
        let cover_art = CoverArt {
            id: "123".to_string(),
            image_url: "http://example.com/full.jpg".to_string(),
            thumbnails: None,
            types: vec![],
            approved: true,
            front: false,
            back: false,
            edit: None,
            comment: None,
        };

        assert_eq!(cover_art.thumbnail_url(), "http://example.com/full.jpg");
        assert_eq!(
            cover_art.large_thumbnail_url(),
            "http://example.com/full.jpg"
        );
    }

    #[test]
    fn test_release_cover_art_helpers() {
        let release_with_art = Release {
            id: Uuid::new_v4(),
            title: "Test Album".to_string(),
            date: None,
            country: None,
            artist_credit: None,
            media: None,
            cover_art_archive: Some(CoverArtArchiveInfo {
                artwork: true,
                count: 3,
                front: true,
                back: false,
            }),
            score: None,
            status: None,
            packaging: None,
            text_representation: None,
            release_group: None,
        };

        assert!(release_with_art.has_cover_art());
        assert_eq!(release_with_art.cover_art_count(), 3);
        assert!(release_with_art.has_front_cover());

        let release_without_art = Release {
            id: Uuid::new_v4(),
            title: "Test Album".to_string(),
            date: None,
            country: None,
            artist_credit: None,
            media: None,
            cover_art_archive: None,
            score: None,
            status: None,
            packaging: None,
            text_representation: None,
            release_group: None,
        };

        assert!(!release_without_art.has_cover_art());
        assert_eq!(release_without_art.cover_art_count(), 0);
        assert!(!release_without_art.has_front_cover());
    }
}
