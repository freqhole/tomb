//! allmusic models.
//!
//! based on the public openapi sketch at
//! <https://apify.com/lexis-solutions/allmusic-scraper/api/openapi>. the
//! actual returned shape can drift; every field is optional and additional
//! keys are tolerated (`#[serde(default)]` on the struct).

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct AllMusicAlbum {
    pub url: Option<String>,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub release_date: Option<String>,
    pub label: Option<String>,
    pub duration: Option<String>,
    pub genres: Vec<String>,
    pub styles: Vec<String>,
    /// allmusic's curated mood vocabulary — the one structured field
    /// none of musicbrainz/last.fm/audiodb give us at this fidelity.
    pub moods: Vec<String>,
    pub themes: Vec<String>,
    /// editorial rating, typically 0..5 in half-star increments.
    pub rating: Option<f32>,
    pub review: Option<AllMusicReview>,
    pub credits: Vec<AllMusicCredit>,
    pub tracks: Vec<AllMusicTrack>,
    pub similar_albums: Vec<AllMusicSimilarAlbum>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct AllMusicReview {
    pub author: Option<String>,
    pub text: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct AllMusicCredit {
    pub name: Option<String>,
    pub role: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct AllMusicTrack {
    pub position: Option<u32>,
    pub title: Option<String>,
    pub duration: Option<String>,
    pub composer: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct AllMusicSimilarAlbum {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub url: Option<String>,
}

/// input payload accepted by the `lexis-solutions/allmusic-scraper` actor.
/// kept generic so we can experiment with input shapes without breaking
/// the wider codebase.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AllMusicScraperInput {
    /// list of album urls or `artist - album` strings to scrape.
    pub queries: Vec<String>,
    /// optional max items the actor should produce.
    #[serde(rename = "maxItems", skip_serializing_if = "Option::is_none")]
    pub max_items: Option<u32>,
}
