//! musicbrainz data models
//!
//! provides structures for musicbrainz api responses including recordings,
//! releases, artists, and cover art metadata.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use uuid::Uuid;

/// musicbrainz recording (track/song)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Recording {
    /// musicbrainz recording id
    pub id: Uuid,

    /// recording title
    pub title: String,

    /// track length in milliseconds
    pub length: Option<u32>,

    /// artist credit information
    #[serde(rename = "artist-credit")]
    pub artist_credit: Option<Vec<ArtistCredit>>,

    /// releases this recording appears on
    pub releases: Option<Vec<Release>>,

    /// tags associated with this recording
    pub tags: Option<Vec<Tag>>,

    /// musicbrainz score (relevance in search results)
    pub score: Option<u32>,

    /// disambiguation comment
    pub disambiguation: Option<String>,

    /// aliases for this recording
    pub aliases: Option<Vec<Alias>>,
}

/// musicbrainz release (album/single)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Release {
    /// musicbrainz release id
    pub id: Uuid,

    /// release title
    pub title: String,

    /// release date (can be partial)
    pub date: Option<String>,

    /// country of release
    pub country: Option<String>,

    /// artist credit information
    #[serde(rename = "artist-credit")]
    pub artist_credit: Option<Vec<ArtistCredit>>,

    /// media (discs/tracks) in this release
    pub media: Option<Vec<Medium>>,

    /// cover art archive information
    #[serde(rename = "cover-art-archive")]
    pub cover_art_archive: Option<CoverArtArchiveInfo>,

    /// musicbrainz score (relevance in search results)
    pub score: Option<u32>,

    /// release status (official, promotion, bootleg, etc.)
    pub status: Option<String>,

    /// packaging type
    pub packaging: Option<String>,

    /// text representation of the release
    #[serde(rename = "text-representation")]
    pub text_representation: Option<TextRepresentation>,

    /// release group this belongs to
    #[serde(rename = "release-group")]
    pub release_group: Option<ReleaseGroup>,
}

/// musicbrainz release group
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReleaseGroup {
    /// musicbrainz release group id
    pub id: Uuid,

    /// release group title
    pub title: String,

    /// primary type (album, single, ep, etc.)
    #[serde(rename = "primary-type")]
    pub primary_type: Option<String>,

    /// secondary types
    #[serde(rename = "secondary-types")]
    pub secondary_types: Option<Vec<String>>,

    /// first release date
    #[serde(rename = "first-release-date")]
    pub first_release_date: Option<String>,

    /// artist credit information
    #[serde(rename = "artist-credit")]
    pub artist_credit: Option<Vec<ArtistCredit>>,

    /// musicbrainz score (relevance in search results)
    pub score: Option<u32>,
}

/// artist credit entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArtistCredit {
    /// artist information
    pub artist: Option<Artist>,

    /// name as credited on this release/recording
    pub name: String,

    /// join phrase (e.g., " feat. ", " & ")
    pub joinphrase: Option<String>,
}

/// musicbrainz artist
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Artist {
    /// musicbrainz artist id
    pub id: Uuid,

    /// artist name
    pub name: String,

    /// sort name for alphabetical ordering
    #[serde(rename = "sort-name")]
    pub sort_name: String,

    /// disambiguation comment
    pub disambiguation: Option<String>,

    /// artist type (person, group, etc.)
    #[serde(rename = "type")]
    pub artist_type: Option<String>,
}

/// medium (disc/cassette/etc.)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Medium {
    /// position of this medium in the release
    pub position: Option<u32>,

    /// title of this medium
    pub title: Option<String>,

    /// format (cd, vinyl, digital, etc.)
    pub format: Option<String>,

    /// track list
    pub tracks: Option<Vec<Track>>,

    /// number of tracks
    #[serde(rename = "track-count")]
    pub track_count: Option<u32>,
}

/// track on a medium
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Track {
    /// track id
    pub id: Option<Uuid>,

    /// position on the medium
    pub position: Option<u32>,

    /// track title
    pub title: String,

    /// track length in milliseconds
    pub length: Option<u32>,

    /// recording this track represents
    pub recording: Option<Recording>,
}

/// tag information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tag {
    /// tag name
    pub name: String,

    /// vote count for this tag
    pub count: Option<u32>,
}

/// alias information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Alias {
    /// alias name
    pub name: String,

    /// sort name for this alias
    #[serde(rename = "sort-name")]
    pub sort_name: Option<String>,

    /// alias type
    #[serde(rename = "type")]
    pub alias_type: Option<String>,

    /// whether this is the primary alias
    pub primary: Option<bool>,
}

/// cover art archive information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CoverArtArchiveInfo {
    /// whether cover art exists
    pub artwork: bool,

    /// number of cover art images
    pub count: u32,

    /// whether front cover exists
    pub front: bool,

    /// whether back cover exists
    pub back: bool,
}

/// text representation info
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TextRepresentation {
    /// language code
    pub language: Option<String>,

    /// script code
    pub script: Option<String>,
}

/// cover art image from cover art archive
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CoverArt {
    /// unique image id
    pub id: String,

    /// image url (full size)
    pub image_url: String,

    /// thumbnail url (250px)
    pub thumbnail_url: String,

    /// image types (front, back, booklet, etc.)
    pub types: Vec<String>,

    /// whether this image is approved
    pub approved: bool,

    /// whether this is the front cover
    pub front: bool,

    /// whether this is the back cover
    pub back: bool,

    /// edit id that added this image
    pub edit: Option<u32>,

    /// comment about this image
    pub comment: Option<String>,
}

/// search result wrapper
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult<T> {
    /// search results
    #[serde(rename = "recordings", alias = "releases", alias = "release-groups")]
    pub results: Vec<T>,

    /// total number of results available
    pub count: u32,

    /// offset of these results
    pub offset: u32,
}

/// musicbrainz match with confidence scoring
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MusicBrainzMatch {
    /// matched recording
    pub recording: Recording,

    /// matched release (if available)
    pub release: Option<Release>,

    /// confidence score (0-100)
    pub confidence_score: f32,

    /// reasons for this match
    pub match_reasons: Vec<String>,
}

/// metadata preview for applying changes
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetadataPreview {
    /// song id being updated
    pub song_id: String,

    /// current metadata
    pub current_metadata: HashMap<String, serde_json::Value>,

    /// proposed metadata changes
    pub proposed_metadata: HashMap<String, serde_json::Value>,

    /// list of changes being made
    pub changes: Vec<MetadataChange>,

    /// available cover art options
    pub cover_art_options: Vec<CoverArt>,
}

/// individual metadata change
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetadataChange {
    /// field being changed
    pub field: String,

    /// old value
    pub old_value: Option<serde_json::Value>,

    /// new value
    pub new_value: serde_json::Value,

    /// confidence in this change (0-100)
    pub confidence: f32,
}

impl Recording {
    /// get primary artist name
    pub fn primary_artist_name(&self) -> Option<String> {
        self.artist_credit
            .as_ref()?
            .first()
            .map(|credit| credit.name.clone())
    }

    /// get all artist names joined
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

    /// get duration in seconds
    pub fn duration_seconds(&self) -> Option<u32> {
        self.length.map(|ms| ms / 1000)
    }
}

impl Release {
    /// get primary artist name
    pub fn primary_artist_name(&self) -> Option<String> {
        self.artist_credit
            .as_ref()?
            .first()
            .map(|credit| credit.name.clone())
    }

    /// get total track count across all media
    pub fn total_track_count(&self) -> u32 {
        self.media
            .as_ref()
            .map(|media| media.iter().filter_map(|m| m.track_count).sum())
            .unwrap_or(0)
    }

    /// check if cover art is available
    pub fn has_cover_art(&self) -> bool {
        self.cover_art_archive
            .as_ref()
            .map(|caa| caa.artwork)
            .unwrap_or(false)
    }
}

impl MusicBrainzMatch {
    /// create a new match with basic scoring
    pub fn new(recording: Recording, release: Option<Release>) -> Self {
        Self {
            recording,
            release,
            confidence_score: 0.0,
            match_reasons: Vec::new(),
        }
    }

    /// add a match reason and adjust confidence
    pub fn add_reason(&mut self, reason: String, confidence_boost: f32) {
        self.match_reasons.push(reason);
        self.confidence_score = (self.confidence_score + confidence_boost).min(100.0);
    }
}
